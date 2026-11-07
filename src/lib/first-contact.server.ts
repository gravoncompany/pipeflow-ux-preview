import { z } from "zod";
import { getPortalAccount } from "./gravon-portal-admin.server";
import { hasFullCrmSession } from "./crm-session.server";
import { supabaseAdmin as db } from "@/integrations/supabase/client.server";
import { firstContactClaimSchema, executeFirstContactStep, firstContactTestSchema, type FirstContactOutcome } from "./first-contact";
import { phoneDigits, sameWhatsAppNumber } from "./phone";
import { openInstances, normalizeAcceptedMessage } from "./whatsapp-message-sync";
import { evolutionSendText } from "./evolution-text.server";
import { EVOLUTION_BASE_URL } from "./evolution.functions";
import { fetchWithoutRedirects } from "./no-redirect-fetch.server";
import { boundedJson } from "./gravon-portal.server";

async function actor() {
  const secret = process.env.CRM_SESSION_SECRET;
  if (!secret || !await hasFullCrmSession(secret)) throw new Error("Entre com acesso completo ao CRM.");
  const account = await getPortalAccount();
  if (!account?.authorized) throw new Error("Entre também com sua conta administrativa individual.");
  const { data: channels, error } = await db.from("portal_admin_channels").select("instance,canonical_phone,company_key").eq("user_id", account.userId);
  if (error || !channels?.length || channels.some(c => c.company_key !== "crm:1")) throw new Error("Empresa ou canal sem autorização verificável.");
  return { userId: account.userId, channels };
}
export async function firstContactOverview() {
  const a = await actor();
  const { data: settings, error } = await db.from("first_contact_settings").select("enabled,instance,sender_phone,interval_seconds,stop_on_reply,revision,runtime_ready").eq("company_key", "crm:1").maybeSingle();
  const { data: sequences, error: sequenceError } = await db.from("first_contact_sequences").select("id,lead_name,phone,state,reason,started_at,completed_at,moved_at,next_step").eq("company_key", "crm:1").order("started_at", { ascending: false }).limit(50);
  if (error || sequenceError) throw new Error("Não foi possível carregar a automação.");
  const ids = sequences?.map(q => q.id) ?? [];
  const attempts = ids.length ? await db.from("first_contact_attempts").select("sequence_id,step,body,state,provider_id,attempted_at,accepted_at,error_code").in("sequence_id", ids).order("step") : { data: [], error: null };
  if (attempts.error) throw new Error("Não foi possível carregar os envios.");
  const uniqueChannels = a.channels.filter((c, i, all) => all.findIndex(x => x.instance === c.instance && x.canonical_phone === c.canonical_phone) === i);
  const controlledTest = await controlledTestResult(a.userId);
  const fullTest = await fullControlledTestResult(a.userId);
  return { settings: settings ?? { enabled: false, instance: "", sender_phone: "", interval_seconds: 10, stop_on_reply: true, revision: "00000000-0000-0000-0000-000000000000", runtime_ready: false }, channels: uniqueChannels, sequences: sequences ?? [], attempts: attempts.data ?? [], controlledTest, fullTest };
}

async function fullControlledTestResult(author: string) {
  const stale = await db.from("first_contact_full_tests").update({ state: "unknown", reason: "test_execution_expired", completed_at: new Date().toISOString() }).eq("author", author).eq("state", "running").lt("started_at", new Date(Date.now() - 300000).toISOString());
  if (stale.error) throw new Error("Não foi possível verificar o estado do teste.");
  const { data: run, error } = await db.from("first_contact_full_tests").select("id,instance,phone,first_name,state,next_step,started_at,due_at,completed_at,reason").eq("author", author).eq("company_key", "crm:1").maybeSingle();
  if (error) throw new Error("Não foi possível conferir a sequência de teste.");
  if (!run) return null;
  const { data: attempts, error: readError } = await db.from("first_contact_full_test_attempts").select("step,body,state,attempted_at,accepted_at,provider_id,remote_jid,persisted_at,error_code").eq("test_id", run.id).order("step");
  if (readError) throw new Error("Não foi possível conferir as mensagens de teste.");
  // Recover only durable accepted receipts, never resend a message.
  for (const a of attempts ?? []) {
    if (a.provider_id && a.remote_jid && a.accepted_at && !a.persisted_at) {
      const result = await db.rpc("finish_full_first_contact_test_step", { p_id: run.id, p_step: a.step, p_state: "accepted", p_provider: a.provider_id, p_jid: a.remote_jid, p_at: a.accepted_at, p_error: "" });
      if (result.error || result.data !== true) throw new Error("Aceite registrado; histórico pendente. Não repita o teste.");
    }
  }
  return { ...run, attempts: (attempts ?? []).map(a => ({ ...a, historySaved: Boolean(a.persisted_at) })) };
}

/** One durable, exclusive full test; the normal automation and all leads remain untouched. */
export async function controlledFullFirstContactTest(input: z.infer<typeof firstContactTestSchema>) {
  const data = firstContactTestSchema.parse(input);
  const a = await actor();
  const channels = a.channels.filter(c => c.instance === data.instance);
  const channel = channels[0];
  if (channels.length !== 1 || !channel) throw new Error("Escolha um canal autorizado sem ambiguidade.");
  const sender = phoneDigits(channel.canonical_phone);
  await liveInstance(channel.instance, sender);
  const { data: raw, error } = await db.rpc("start_full_first_contact_test", { p_author: a.userId, p_instance: channel.instance, p_sender: sender, p_phone: data.phone, p_first: data.firstName });
  if (error) throw new Error("Teste bloqueado: confira sua autorização, teste anterior e automação desligada.");
  const reservation = z.object({ id: z.string().uuid(), claimed: z.boolean() }).parse(raw);
  if (!reservation.claimed) return fullControlledTestResult(a.userId);
  for (let step = 1; step <= 4; step++) {
    if (step > 1) {
      const { data: timing, error: timingError } = await db.from("first_contact_full_tests").select("due_at").eq("id", reservation.id).single();
      if (timingError || !timing) throw new Error("Não foi possível conferir o intervalo; não repita o teste.");
      const deadline = new Date(timing.due_at).getTime();
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, Math.min(1000, deadline - Date.now())));
        const fresh = await actor();
        if (fresh.userId !== a.userId) throw new Error("Sessão alterada; teste interrompido.");
        const check = await db.rpc("revalidate_full_first_contact_test", { p_id: reservation.id, p_author: a.userId });
        if (check.error) throw new Error("Verificação indisponível; nenhum novo envio autorizado.");
        if (check.data !== true) return fullControlledTestResult(a.userId);
      }
    }
    const key = await liveInstance(channel.instance, sender);
    const fresh = await actor();
    if (fresh.userId !== a.userId) throw new Error("Sessão alterada; teste interrompido.");
    const claimed = await db.rpc("claim_full_first_contact_test_step", { p_id: reservation.id, p_author: a.userId });
    if (claimed.error) throw new Error("Reserva indisponível; não repita o teste.");
    if (!claimed.data) return fullControlledTestResult(a.userId);
    const claim = firstContactClaimSchema.parse(claimed.data);
    let jid = "";
    await executeFirstContactStep(claim, {
      authorize: async () => {
        const fresh = await actor();
        if (fresh.userId !== a.userId || fresh.channels.filter(c => c.instance === channel.instance && sameWhatsAppNumber(c.canonical_phone, sender)).length !== 1) return false;
        const check = await db.rpc("revalidate_full_first_contact_test", { p_id: reservation.id, p_author: a.userId });
        if (check.error) throw new Error("test_authorization_unavailable");
        return check.data === true;
      },
      send: () => evolutionSendText(key, claim.instance, claim.phone, claim.body),
      receipt: async response => {
        const receipt = normalizeAcceptedMessage(await boundedJson(response, 1024 * 1024), { instance: claim.instance, number: claim.phone, body: claim.body, acceptedAt: new Date().toISOString() });
        if (!receipt) return null;
        jid = receipt.remoteJid;
        const write = await db.from("first_contact_full_test_attempts").update({ provider_id: receipt.messageId, remote_jid: jid, accepted_at: receipt.acceptedAt }).eq("test_id", claim.id).eq("step", claim.step).eq("state", "sending");
        if (write.error) throw new Error("test_receipt_write_failed");
        return { id: receipt.messageId, at: receipt.acceptedAt };
      },
      persist: async outcome => {
        const result = await db.rpc("finish_full_first_contact_test_step", { p_id: claim.id, p_step: claim.step, p_state: outcome.state, p_provider: outcome.provider ?? "", p_jid: jid, p_at: outcome.at ?? new Date().toISOString(), p_error: outcome.error ?? "" });
        if (result.error || result.data !== true) throw new Error("Resultado pendente; não repita o teste.");
      },
    });
  }
  return fullControlledTestResult(a.userId);
}

async function controlledTestResult(author: string) {
  const { data: row, error } = await db.from("first_contact_tests").select("id,state,instance,phone,body,created_at,accepted_at,persisted_at,provider_id,error_code").eq("company_key", "crm:1").eq("author", author).maybeSingle();
  if (error) throw new Error("Não foi possível conferir o teste.");
  if (!row) return null;
  if (row.state === "accepted" && !row.persisted_at) {
    const { data, error } = await db.rpc("persist_first_contact_test", { p_id: row.id });
    if (error || data !== true) return { ...row, historySaved: false, delivery: "accepted" };
  }
  const message = row.provider_id ? await db.from("whatsapp_messages").select("instance,body,phone,send_state,delivered_at,read_at").eq("message_id", row.provider_id).maybeSingle() : { data: null, error: null };
  if (message.error) throw new Error("Não foi possível conferir o histórico do teste.");
  const m = message.data;
  const historySaved = Boolean(m && m.instance === row.instance && m.body === row.body && sameWhatsAppNumber(m.phone, row.phone));
  return { ...row, historySaved, delivery: historySaved && m?.read_at ? "read" : historySaved && m?.delivered_at ? "delivered" : row.state };
}

export async function controlledFirstContactTest(input: z.infer<typeof firstContactTestSchema>) {
  const data = firstContactTestSchema.parse(input);
  const a = await actor();
  const channels = a.channels.filter(c => c.instance === data.instance);
  const channel = channels[0];
  if (channels.length !== 1 || !channel) throw new Error("Escolha um canal autorizado sem ambiguidade.");
  const sender = phoneDigits(channel.canonical_phone);
  // Network validation happens before a durable one-shot claim, never by selecting any open instance.
  const key = await liveInstance(channel.instance, sender);
  const { data: reservation, error } = await db.rpc("claim_first_contact_test", { p_author: a.userId, p_instance: channel.instance, p_sender: sender, p_phone: data.phone, p_first: data.firstName });
  if (error) throw new Error("Teste bloqueado: confira a autorização e mantenha a automação geral desligada.");
  const claim = z.object({ id: z.string().uuid(), claimed: z.boolean() }).parse(reservation);
  if (!claim.claimed) return controlledTestResult(a.userId);
  const { data: row, error: readError } = await db.from("first_contact_tests").select("body").eq("id", claim.id).single();
  if (readError || !row) throw new Error("Reserva não confirmada; nenhum envio foi realizado.");
  await executeFirstContactStep({ id: claim.id, step: 1, body: row.body, phone: data.phone, instance: channel.instance, senderPhone: sender }, {
    authorize: async () => {
      const fresh = await actor();
      if (fresh.userId !== a.userId || fresh.channels.filter(c => c.instance === channel.instance && sameWhatsAppNumber(c.canonical_phone, sender)).length !== 1) return false;
      const { data: settings, error } = await db.from("first_contact_settings").select("enabled,runtime_ready").eq("company_key", "crm:1").single();
      if (error) throw new Error("test_settings_unavailable");
      const { data: pending, error: queueError } = await db.from("first_contact_sequences").select("id").in("state", ["pending", "sending"]).limit(1);
      if (queueError) throw new Error("test_queue_unavailable");
      return settings.enabled === false && settings.runtime_ready === false && pending?.length === 0;
    },
    send: () => evolutionSendText(key, channel.instance, data.phone, row.body),
    receipt: async response => {
      const accepted = normalizeAcceptedMessage(await boundedJson(response, 1024 * 1024), { instance: channel.instance, number: data.phone, body: row.body, acceptedAt: new Date().toISOString() });
      if (!accepted) return null;
      const { error } = await db.from("first_contact_tests").update({ state: "accepted", provider_id: accepted.messageId, remote_jid: accepted.remoteJid, accepted_at: accepted.acceptedAt }).eq("id", claim.id).eq("state", "sending");
      if (error) throw new Error("test_receipt_write_failed");
      return { id: accepted.messageId, at: accepted.acceptedAt };
    },
    persist: async outcome => {
      if (outcome.state === "accepted") {
        const { data, error } = await db.rpc("persist_first_contact_test", { p_id: claim.id });
        if (error || data !== true) throw new Error("Aceite registrado; gravação pendente. Não repita o envio; atualize o histórico.");
      } else {
        const { error } = await db.from("first_contact_tests").update({ state: outcome.state, error_code: outcome.error }).eq("id", claim.id).eq("state", "sending");
        if (error) throw new Error("Resultado incerto; não repita o envio.");
      }
    },
  });
  return controlledTestResult(a.userId);
}
export async function updateFirstContactSettings(input: { enabled: boolean; instance: string; interval: number; stopOnReply: boolean; revision: string }) {
  const a = await actor();
  const matches = a.channels.filter(c => c.instance === input.instance);
  if (matches.length !== 1 || !matches[0]) throw new Error("Escolha uma instância autorizada sem ambiguidade.");
  const { data: current, error: currentError } = await db.from("first_contact_settings").select("revision").eq("company_key", "crm:1").maybeSingle();
  if (currentError) throw new Error("Não foi possível verificar a configuração.");
  let revision = input.revision;
  if (!current) {
    const { data: initial, error } = await db.from("first_contact_settings").insert({ company_key: "crm:1" }).select("revision").single();
    if (error || !initial) throw new Error("Configuração criada por outra sessão; atualize a página.");
    revision = initial.revision;
  }
  const { data, error } = await db.rpc("save_first_contact_options", { p_author: a.userId, p_enabled: input.enabled, p_instance: input.instance, p_phone: phoneDigits(matches[0].canonical_phone), p_interval: input.interval, p_revision: revision, p_stop_on_reply: input.stopOnReply });
  if (error) throw new Error(input.enabled ? "Ativação indisponível: publicação e preparação do agendamento privado ainda pendentes." : "Não foi possível salvar a configuração.");
  if (!data) throw new Error("Configuração alterada em outra sessão; atualize antes de salvar.");
  return { ok: true };
}

async function liveInstance(instance: string, sender: string) {
  const key = process.env.EVOLUTION_API_KEY;
  if (!key) throw new Error("evolution_not_configured");
  const response = await fetchWithoutRedirects(`${EVOLUTION_BASE_URL}/instance/fetchInstances`, { headers: { apikey: key }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("instance_verification_failed");
  const matches = openInstances(await boundedJson(response, 1024 * 1024)).filter(i => i.name === instance && sameWhatsAppNumber(i.number, sender));
  if (matches.length !== 1) throw new Error("instance_identity_failed");
  return key;
}

export async function firstContactJob(request: Request) {
  const provided = request.headers.get("authorization") ?? "";
  // Reject empty/oversized headers before private credential lookup.
  if (!provided.startsWith("Bearer ") || provided.length > 256) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { data: s, error } = await db.from("first_contact_settings").select("job_secret,enabled,runtime_ready").eq("company_key", "crm:1").maybeSingle();
  const expected = s?.job_secret ? `Bearer ${s.job_secret}` : "";
  let diff = provided.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  if (error || !expected || diff) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!z.object({}).strict().safeParse(await request.json().catch(() => null)).success) return Response.json({ error: "Invalid input" }, { status: 400 });
  if (!s?.runtime_ready) return Response.json({ ok: true, paused: true });
  const workerLease = crypto.randomUUID();
  const worker = await db.rpc("claim_first_contact_worker", { p_lease: workerLease });
  if (worker.error) throw new Error("worker_claim_failed");
  if (!worker.data) return Response.json({ ok: true, busy: true });
  try {
  // Accepted evidence is recovered before any new sends. Never retry an uncertain provider request.
  await recoverFirstContactReceipts();
  if (!s.enabled) {
    const { error: expired } = await db.from("first_contact_sequences").update({ state: "unknown", reason: "worker_outcome_unknown", completed_at: new Date().toISOString() }).eq("state", "sending").lt("lease_until", new Date().toISOString());
    if (expired) throw new Error("queue_recovery_failed");
    const { error } = await db.rpc("arm_first_contact_queue");
    if (error) throw new Error("queue_schedule_failed");
    return Response.json({ ok: true, paused: true });
  }
  const { error: expired } = await db.from("first_contact_sequences").update({ state: "unknown", reason: "worker_outcome_unknown" }).eq("state", "sending").lt("lease_until", new Date().toISOString());
  if (expired) throw new Error("queue_recovery_failed");
  const { data: pending, error: pendingError } = await db.from("first_contact_sequences").select("id,instance,sender_phone").eq("state", "pending").lte("due_at", new Date().toISOString()).order("due_at").limit(1);
  if (pendingError) throw new Error("queue_read_failed");
  for (const q of pending ?? []) {
    let key: string;
    try { key = await liveInstance(q.instance, q.sender_phone); }
    catch { const { error } = await db.from("first_contact_sequences").update({ state: "failed", reason: "instance_verification_failed", completed_at: new Date().toISOString() }).eq("id", q.id).eq("state", "pending"); if (error) throw new Error("queue_write_failed"); continue; }
    const lease = crypto.randomUUID();
    const { data, error: claimError } = await db.rpc("claim_first_contact", { p_id: q.id, p_lease: lease });
    if (claimError) throw new Error("queue_claim_failed");
    if (!data) continue;
    const claim = firstContactClaimSchema.parse(data);
    await executeFirstContactStep(claim, {
      authorize: async () => { const { data, error } = await db.rpc("revalidate_first_contact", { p_id: q.id, p_lease: lease }); if (error) throw new Error("queue_authorization_failed"); return data === true; },
      send: () => evolutionSendText(key, claim.instance, claim.phone, claim.body),
      receipt: async response => {
        const accepted = normalizeAcceptedMessage(await boundedJson(response, 1024 * 1024), { instance: claim.instance, number: claim.phone, body: claim.body, acceptedAt: new Date().toISOString() });
        return accepted ? { id: accepted.messageId, at: accepted.acceptedAt } : null;
      },
      persist: outcome => persistOutcome(claim.id, lease, claim.step, outcome),
    });
  }
    const { error: armError } = await db.rpc("arm_first_contact_queue");
  if (armError) throw new Error("queue_schedule_failed");
  return Response.json({ ok: true });
  } finally {
    const { error } = await db.from("first_contact_worker_lock").update({ expires_at: new Date().toISOString() }).eq("id", true).eq("lease", workerLease);
    if (error) console.error("first_contact_worker_release_failed");
  }
}
async function persistOutcome(id: string, lease: string, step: number, outcome: FirstContactOutcome) {
  if (outcome.state === "accepted") {
    // Store provider evidence independently so a failed transaction can recover without resending.
    const { error } = await db.from("first_contact_attempts").update({ provider_id: outcome.provider, accepted_at: outcome.at }).eq("sequence_id", id).eq("step", step).eq("state", "sending");
    if (error) throw new Error("receipt_evidence_write_failed");
  }
  const { data, error } = await db.rpc("finish_first_contact", { p_id: id, p_lease: lease, p_state: outcome.state, p_provider: outcome.provider ?? "", p_at: outcome.at ?? new Date().toISOString(), p_error: outcome.error ?? "" });
  if (error || !data) throw new Error("receipt_persistence_failed");
}
async function recoverFirstContactReceipts() {
  const { data: rows, error } = await db.from("first_contact_attempts").select("id,sequence_id,provider_id,accepted_at,recovery_count").eq("state", "sending").not("provider_id", "is", null).or(`recovery_due_at.is.null,recovery_due_at.lte.${new Date().toISOString()}`).order("attempted_at").limit(10);
  if (error) throw new Error("receipt_recovery_read_failed");
  for (const r of rows ?? []) {
    const { data: q, error } = await db.from("first_contact_sequences").select("lease_id").eq("id", r.sequence_id).maybeSingle();
    if (error) throw new Error("receipt_recovery_read_failed");
    const result = q?.lease_id && r.provider_id && r.accepted_at ? await db.rpc("finish_first_contact", { p_id: r.sequence_id, p_lease: q.lease_id, p_state: "accepted", p_provider: r.provider_id, p_at: r.accepted_at, p_error: "" }) : { error: true, data: false };
    if (result.error || !result.data) {
      const count = r.recovery_count + 1;
      const quarantined = count >= 3;
      const { error: attemptError } = await db.from("first_contact_attempts").update({ recovery_count: count, recovery_due_at: new Date(Date.now() + 45000 * count).toISOString(), ...(quarantined ? { state: "unknown", error_code: "receipt_persistence_manual_review" } : {}) }).eq("id", r.id).eq("state", "sending");
      if (attemptError) throw new Error("receipt_recovery_write_failed");
      if (quarantined) {
        const { error: sequenceError } = await db.from("first_contact_sequences").update({ state: "unknown", reason: "receipt_persistence_manual_review", completed_at: new Date().toISOString() }).eq("id", r.sequence_id);
        if (sequenceError) throw new Error("receipt_recovery_write_failed");
      }
    }
  }
}

/** Signed Evolution event; unresolved LID never silently allows remaining sends. */
export async function protectFirstContactLid(instance: string, event: { key?: { id?: unknown; fromMe?: unknown; remoteJid?: unknown; remoteJidAlt?: unknown; addressingMode?: unknown }; messageTimestamp?: unknown }) {
  if (event.key?.fromMe !== false || typeof event.key.remoteJid !== "string" || !event.key.remoteJid.endsWith("@lid")) return;
  const id = typeof event.key.id === "string" ? event.key.id : "";
  if (!instance || !id) return;
  const alt = typeof event.key.remoteJidAlt === "string" ? event.key.remoteJidAlt : "";
  let verified = false;
  if (event.key.addressingMode === "lid" && /^\d{10,15}@s\.whatsapp\.net$/.test(alt)) {
    const key = process.env.EVOLUTION_API_KEY;
    if (key) {
      try {
        const response = await fetchWithoutRedirects(`${EVOLUTION_BASE_URL}/chat/findMessages/${encodeURIComponent(instance)}`, { method: "POST", headers: { apikey: key, "Content-Type": "application/json" }, body: JSON.stringify({ where: { key: { id } }, page: 1, offset: 20 }), signal: AbortSignal.timeout(10000) });
        const parsed = z.object({ messages: z.object({ records: z.array(z.object({ key: z.object({ id: z.string(), fromMe: z.boolean(), remoteJid: z.string(), remoteJidAlt: z.string().optional(), addressingMode: z.string().optional() }) })).max(20) }) }).parse(await boundedJson(response, 1024 * 1024));
        verified = response.ok && parsed.messages.records.filter(r => r.key.id === id && r.key.fromMe === false && r.key.remoteJid === event.key?.remoteJid && r.key.remoteJidAlt === alt && r.key.addressingMode === "lid").length === 1;
      } catch { verified = false; }
    }
  }
  const ts = Number(event.messageTimestamp);
  const at = Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : new Date().toISOString();
  const { error } = await db.rpc("cancel_first_contact", { p_instance: instance, p_phone: verified ? alt.split("@")[0] ?? "" : "", p_id: id, p_at: at, p_ambiguous: !verified });
  if (error) throw new Error("inbound_cancellation_failed");
  if (!verified) {
    const cancelled = await db.from("first_contact_full_tests").update({ state: "cancelled", reason: "ambiguous_inbound_identity", completed_at: new Date().toISOString() }).eq("instance", instance).eq("state", "running");
    if (cancelled.error) throw new Error("test_inbound_cancellation_failed");
  }
  return verified ? alt : undefined;
}