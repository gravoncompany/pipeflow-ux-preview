import { z } from "zod";
import { EVOLUTION_BASE_URL } from "./evolution.functions";
import { sameWhatsAppNumber } from "./phone";
import { selectTestInstance } from "./whatsapp-message-sync";
import { boundedJson, type PortalIdentity } from "./gravon-portal.server";
import { PortalIdentityError, type PortalIdentityDiagnostic } from "./portal-identity-diagnostics";
import { fetchWithoutRedirects, UpstreamRedirectError } from "./no-redirect-fetch.server";

export type PortalInboundReference = { inboundId: string; instance: string; remoteJid: string };
export function evolutionConnectionDiagnostic(error: unknown, aborted: boolean, elapsedMs: number) {
  // Never return exception messages/causes: transports can include credentials or response bodies.
  const timeout = aborted || (error instanceof Error && error.name === "TimeoutError");
  const errorType = error instanceof Error && ["TimeoutError", "AbortError", "TypeError"].includes(error.name)
    ? error.name : "TransportError";
  return {
    code: timeout ? "evolution_timeout" : "evolution_connection_failed",
    message: timeout
      ? "A Evolution não respondeu dentro de 10 segundos. A verificação foi interrompida por tempo limite."
      : "A conexão do servidor com a Evolution falhou antes da confirmação da instância; não é um tempo limite confirmado. Verifique DNS, TLS, bloqueios de rede ou redirecionamento no endereço configurado.",
    checks: { configuredOrigin: EVOLUTION_BASE_URL, timeoutSeconds: "10", elapsedMs: String(Math.max(0, Math.round(elapsedMs))),
      timeoutConfirmed: timeout, transportErrorType: errorType, redirectsAllowed: false },
  };
}
export function portalMessageQuery(ref: PortalInboundReference) {
  // Provider message ID, not Evolution's database row ID. LID records retain the phone as an alias.
  return { where: { key: { id: ref.inboundId } }, page: 1, offset: 20 };
}
const reference = z
  .object({
    inboundId: z.string().min(1).max(200),
    instance: z.string().min(1).max(160),
    remoteJid: z.string().regex(/^\d{10,15}@s\.whatsapp\.net$/),
  })
  .strict();

/** Canonical full Brazilian mobile number; only the optional leading ninth digit is removed. */
export function canonicalPortalNumber(jid: string): string {
  const number = jid.replace(/@s\.whatsapp\.net$/, "");
  if (!/^\d{10,15}$/.test(number)) throw new Error("identity_unverified");
  return /^55[1-9]\d9[6-9]\d{7}$/.test(number) ? `${number.slice(0, 4)}${number.slice(5)}` : number;
}

export async function portalSubject(instance: string, jid: string): Promise<string> {
  z.string().min(1).max(160).parse(instance);
  const identity = JSON.stringify([EVOLUTION_BASE_URL, instance, canonicalPortalNumber(jid)]);
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity)),
  );
  return `crm:evolution:v1:${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function verifyProviderRecord(raw: unknown, ref: PortalInboundReference) {
  const fail = (code: string, message: string, details: Partial<PortalIdentityDiagnostic> = {}): never => {
    throw new PortalIdentityError({ code, stage: "Mensagem Evolution", message,
      instance: ref.instance, messageId: ref.inboundId, expectedPhone: ref.remoteJid, ...details });
  };
  const parsed = z
    .object({
      messages: z.object({
        records: z
          .array(
            z
              .object({
                key: z.object({
                  id: z.string(), remoteJid: z.string(), fromMe: z.boolean(),
                  remoteJidAlt: z.string().optional(), addressingMode: z.string().optional(),
                }),
                messageTimestamp: z.union([z.number(), z.string()]),
              })
              .passthrough(),
          )
          .max(20),
      }),
    })
    .safeParse(raw);
  if (!parsed.success) return fail("invalid_provider_record", "A resposta não corresponde ao formato esperado de messages.records/key/timestamp.");
  const records = parsed.data.messages.records;
  const exact = records.filter((row) => row.key.id === ref.inboundId);
  if (exact.length !== 1) return fail(exact.length > 1 ? "duplicate_message_id" : "message_not_found",
    exact.length > 1 ? "A Evolution retornou mais de um registro com o mesmo ID; identidade ambígua." : "O ID solicitado não foi encontrado nesta instância.", { records: records.length });
  const key = exact[0]?.key;
  if (!key) return fail("message_not_found", "Registro da mensagem ausente.");
  const checks = { exactMessageId: true, fromMe: key.fromMe, addressingMode: key.addressingMode ?? "ausente",
    isLid: /^\d{10,20}@lid$/.test(key.remoteJid), directPhoneMatches: key.remoteJid === ref.remoteJid,
    alternativePhonePresent: Boolean(key.remoteJidAlt), alternativePhoneMatches: key.remoteJidAlt === ref.remoteJid };
  if (!key.fromMe) return fail("not_self_message", "fromMe não é true; a mensagem não comprova a conversa pessoal.", { checks });
  const matched = parsed.data.messages.records.filter(
    (row) =>
      row.key.id === ref.inboundId &&
      (row.key.remoteJid === ref.remoteJid ||
        (row.key.addressingMode === "lid" && /^\d{10,20}@lid$/.test(row.key.remoteJid) &&
          row.key.remoteJidAlt === ref.remoteJid)) &&
      row.key.fromMe === true,
  );
  if (matched.length !== 1) return fail("phone_identity_mismatch", "O número não coincide: LID exige addressingMode=lid e remoteJidAlt exatamente igual ao número autorizado.", { checks });
  const timestamp = Number(matched[0]?.messageTimestamp);
  if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp * 1000 > 8640000000000000) return fail("invalid_message_timestamp", "messageTimestamp inválido.", { checks });
  return new Date(timestamp * 1000).toISOString();
}

/** Only personal self-chat claims are eligible; browser IDs and old log rows alone are not proof. */
export async function resolvePortalIdentity(raw: PortalInboundReference): Promise<
  PortalIdentity & {
    instance: string;
    contact: string;
    eventAt: string;
    verifiedAt: string;
    source: string;
  }
> {
  const ref = reference.parse(raw);
  const fail = (code: string, stage: string, message: string, details: Partial<PortalIdentityDiagnostic> = {}): never => {
    throw new PortalIdentityError({ code, stage, message, instance: ref.instance,
      messageId: ref.inboundId, expectedPhone: ref.remoteJid, ...details });
  };
  const request = async (url: string, init: RequestInit, stage: string) => {
    const started = Date.now();
    try { return await fetchWithoutRedirects(url, init); }
    catch (error) {
      if (error instanceof UpstreamRedirectError)
        return fail("evolution_redirect_rejected", stage, "A Evolution respondeu com redirecionamento; destino não acessado e identidade não liberada.", { httpStatus: error.status,
          checks: { configuredOrigin: EVOLUTION_BASE_URL, redirectsAllowed: false } });
      const diagnostic = evolutionConnectionDiagnostic(error, init.signal?.aborted === true, Date.now() - started);
      console.warn("Portal Evolution connectivity", { stage, ...diagnostic });
      return fail(diagnostic.code, stage, diagnostic.message, { checks: diagnostic.checks });
    }
  };
  const read = async (res: Response, stage: string, limit?: number) => {
    try { return await boundedJson(res, limit); }
    catch { return fail("invalid_evolution_response", stage, "A Evolution retornou JSON inválido ou uma resposta acima do limite permitido.", { httpStatus: res.status }); }
  };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const key = process.env.EVOLUTION_API_KEY;
  if (!key) return fail("evolution_not_configured", "Configuração", "A credencial da Evolution não está configurada no servidor.");
  const authorize = async () => {
    const { data: settings, error } = await supabaseAdmin
      .from("gravon_ai_test_settings")
      .select("enabled,authorized_phone")
      .eq("id", 1)
      .maybeSingle();
    if (error) return fail("settings_unavailable", "Canal pessoal", "Não foi possível ler a autorização do canal pessoal.");
    if (!settings?.enabled) return fail("personal_channel_disabled", "Canal pessoal", "O canal pessoal está desativado.");
    const res = await request(`${EVOLUTION_BASE_URL}/instance/fetchInstances`, {
      headers: { apikey: key },
      signal: AbortSignal.timeout(10000),
    }, "Instância Evolution");
    if (!res.ok) return fail("evolution_instances_http", "Instância Evolution", "A consulta de instâncias foi recusada pela Evolution.", { httpStatus: res.status });
    const connected = selectTestInstance(
      await read(res, "Instância Evolution"),
      ref.instance,
      settings.authorized_phone,
    );
    if (!connected || !sameWhatsAppNumber(ref.remoteJid, connected.number))
      return fail("personal_instance_mismatch", "Instância Evolution", "Não há uma única instância conectada com este nome e o número pessoal autorizado.");
  };
  await authorize();
  const { data: claims, error: claimError } = await supabaseAdmin
    .from("gravon_ai_test_log")
    .select("inbound_id,instance,remote_jid,created_at")
    .eq("event", "inbound")
    .eq("status", "received")
    .eq("inbound_id", ref.inboundId)
    .eq("instance", ref.instance)
    .eq("remote_jid", ref.remoteJid)
    .limit(2);
  if (claimError || claims?.length !== 1) return fail("private_claim_mismatch", "Evento autenticado", "Não foi encontrado um único evento autenticado com este ID, instância e número.");
  const res = await request(
    `${EVOLUTION_BASE_URL}/chat/findMessages/${encodeURIComponent(ref.instance)}`,
    {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify(portalMessageQuery(ref)),
      signal: AbortSignal.timeout(10000),
    }, "Mensagem Evolution",
  );
  if (!res.ok) return fail("evolution_messages_http", "Mensagem Evolution", "A consulta da mensagem foi recusada pela Evolution.", { httpStatus: res.status });
  const eventAt = verifyProviderRecord(await read(res, "Mensagem Evolution", 128 * 1024), ref);
  return {
    subject: await portalSubject(ref.instance, ref.remoteJid),
    authorize,
    instance: ref.instance,
    contact: ref.remoteJid.split("@")[0] ?? "",
    eventAt,
    verifiedAt: new Date().toISOString(),
    source:
      "Evolution: messages.upsert com token + claim privado + findMessages autenticado; key.id/remoteJid/fromMe e instância pessoal conferidos",
  };
}
