import { b2bDb, requireB2bAccess } from "./b2b-prospecting.server";
import { getPortalAccount } from "./gravon-portal-admin.server";
import { campaignChannels } from "./campaign-channels.server";
import { diagnosisOptions } from "./diagnosis-automation";
import { phoneDigits, sameWhatsAppNumber } from "./phone";
import { fetchWithoutRedirects } from "./no-redirect-fetch.server";
import { EVOLUTION_BASE_URL } from "./evolution.functions";
import { boundedJson } from "./gravon-portal.server";
import { openInstances, normalizeAcceptedMessage } from "./whatsapp-message-sync";
import { executeFirstContactStep, firstContactClaimSchema } from "./first-contact";
import { evolutionSendText } from "./evolution-text.server";
import { dispatchNotification } from "./notifications.server";

type Db = Awaited<ReturnType<typeof b2bDb>>;
type ReceiptWork = { id: string; lease: string; provider_id: string | null; remote_jid: string | null; accepted_at: string | null };

async function finish(db: Db, work: ReceiptWork, state: string, code = "") {
  const r = await db.rpc("finish_diagnosis_whatsapp", {
    p_id: work.id, p_lease: work.lease, p_state: work.provider_id && work.remote_jid && work.accepted_at ? "accepted" : state,
    p_provider: work.provider_id ?? "", p_jid: work.remote_jid ?? "", p_at: work.accepted_at, p_error: code,
  });
  if (r.error || r.data !== true) throw new Error("diagnosis_persistence_pending");
}

/** Known receipts recover persistence only. Never repeats an Evolution request. */
export async function recoverDiagnosisReceipts(db: Db) {
  const rows = await db.from("crm_diagnosis_whatsapp").select("id,lease,provider_id,remote_jid,accepted_at")
    .is("persisted_at", null).not("provider_id", "is", null).order("created_at").limit(10);
  if (rows.error) throw new Error("diagnosis_recovery_unavailable");
  for (const row of rows.data ?? []) {
    if (!row.lease || !row.remote_jid || !row.accepted_at) continue;
    await finish(db, row as ReceiptWork, "accepted");
  }
  const expired = await db.from("crm_diagnosis_whatsapp").update({ state: "unknown", error_code: "expired_send_unknown" })
    .eq("state", "sending").is("provider_id", null).lt("lease_until", new Date().toISOString());
  if (expired.error) throw new Error("diagnosis_recovery_unavailable");
}

export async function diagnosisAutomationOverview() {
  await requireB2bAccess();
  const db = await b2bDb();
  await recoverDiagnosisReceipts(db);
  const [settings, sends, channels] = await Promise.all([
    db.from("crm_diagnosis_automation_settings").select("enabled,instance,revision,activated_at").eq("id", true).maybeSingle(),
    db.from("crm_diagnosis_whatsapp").select("id,lead_id,state,error_code,created_at,accepted_at").order("created_at", { ascending: false }).limit(30),
    campaignChannels(),
  ]);
  if (settings.error || sends.error) throw new Error("Não foi possível carregar o atendimento do diagnóstico.");
  return {
    settings: (settings.data ?? { enabled: false, instance: "", revision: 0, activated_at: null }) as { enabled: boolean; instance: string; revision: number; activated_at: string | null },
    channels: channels.instances.filter((c) => c.bindingVerified && c.connection === "open").map((c) => c.reference),
    channelError: channels.error,
    sends: (sends.data ?? []) as { id: string; lead_id: string; state: string; error_code: string; created_at: string; accepted_at: string | null }[],
  };
}

export async function updateDiagnosisAutomation(raw: unknown) {
  const input = diagnosisOptions.parse(raw);
  await requireB2bAccess();
  const account = await getPortalAccount();
  if (!account?.authorized) throw new Error("Entre também com sua conta administrativa individual.");
  const matches = account.channels.filter((c) => c.instance === input.instance);
  const channel = matches[0];
  if (input.enabled && (matches.length !== 1 || !channel)) throw new Error("Escolha um WhatsApp autorizado da Gravon.");
  if (input.enabled) {
    const live = await campaignChannels();
    if (!live.instances.some((c) => c.reference === input.instance && c.bindingVerified && c.connection === "open")) throw new Error(live.error || "Canal desconectado ou sem vínculo exclusivo verificável.");
  }
  const db = await b2bDb();
  const r = await db.rpc("save_diagnosis_automation", {
    p_actor: account.userId, p_enabled: input.enabled, p_instance: input.instance,
    p_sender: channel ? phoneDigits(channel.canonical_phone) : "", p_revision: input.revision,
  });
  if (r.error || r.data !== true) throw new Error("Não foi possível salvar: confira a autorização ou atualize a configuração.");
  return { ok: true };
}

/** Process at most one durable pending send after intake; quiet periods wait for the next form. */
export async function processDiagnosisWhatsApp(db: Db) {
  await recoverDiagnosisReceipts(db);
  const rows = await db.from("crm_diagnosis_whatsapp").select("id,instance,sender_phone").eq("state", "pending").order("created_at").limit(1);
  if (rows.error) throw new Error("diagnosis_queue_unavailable");
  const q = rows.data?.[0];
  if (!q) return;
  const key = process.env.EVOLUTION_API_KEY;
  if (!key) return;
  const response = await fetchWithoutRedirects(`${EVOLUTION_BASE_URL}/instance/fetchInstances`, { headers: { apikey: key }, signal: AbortSignal.timeout(10000) });
  if (!response.ok || openInstances(await boundedJson(response, 1024 * 1024)).filter((i) => i.name === q.instance && sameWhatsAppNumber(i.number, q.sender_phone)).length !== 1) {
    const blocked = await db.from("crm_diagnosis_whatsapp").update({ state: "cancelled", error_code: "instance_identity_failed" }).eq("id", q.id).eq("state", "pending");
    if (blocked.error) throw new Error("diagnosis_queue_write_failed");
    return;
  }
  const lease = crypto.randomUUID();
  const reserved = await db.rpc("claim_diagnosis_whatsapp", { p_id: q.id, p_lease: lease });
  if (reserved.error) throw new Error("diagnosis_claim_failed");
  if (!reserved.data) return;
  const claim = firstContactClaimSchema.parse(reserved.data);
  let receipt: ReceiptWork = { id: claim.id, lease, provider_id: null, remote_jid: null, accepted_at: null };
  await executeFirstContactStep(claim, {
    authorize: async () => {
      const valid = await db.rpc("revalidate_diagnosis_whatsapp", { p_id: claim.id, p_lease: lease });
      if (valid.error) throw new Error("diagnosis_authorization_unavailable");
      return valid.data === true;
    },
    send: () => evolutionSendText(key, claim.instance, claim.phone, claim.body),
    receipt: async (res) => {
      const accepted = normalizeAcceptedMessage(await boundedJson(res, 1024 * 1024), { instance: claim.instance, number: claim.phone, body: claim.body, acceptedAt: new Date().toISOString() });
      if (!accepted) return null;
      receipt = { id: claim.id, lease, provider_id: accepted.messageId, remote_jid: accepted.remoteJid, accepted_at: accepted.acceptedAt };
      const evidence = await db.from("crm_diagnosis_whatsapp").update({ provider_id: accepted.messageId, remote_jid: accepted.remoteJid, accepted_at: accepted.acceptedAt }).eq("id", claim.id).eq("lease", lease).eq("state", "sending");
      if (evidence.error) throw new Error("diagnosis_receipt_write_failed");
      return { id: accepted.messageId, at: accepted.acceptedAt };
    },
    persist: (outcome) => finish(db, receipt, outcome.state, outcome.error ?? ""),
  });
}

export async function notifyDiagnosis(db: Db, submission: { id: string; name: string; company: string; lead_id: string }) {
  // Internal bell already reads the durable diagnosis history. Only the opted-in push channel is used here.
  const pref = await db.from("crm_notification_prefs").select("enabled").eq("event", "diagnosis_received").eq("channel", "push").maybeSingle();
  if (pref.error) throw new Error("diagnosis_notification_unavailable");
  if (!pref.data?.enabled) return;
  await dispatchNotification(db, { event: "diagnosis_received", channel: "push", eventKey: `diagnosis:${submission.id}`,
    message: { title: "Diagnóstico solicitado", body: [submission.company, submission.name].filter(Boolean).join(" · ").slice(0, 300), url: `/?lead=${encodeURIComponent(submission.lead_id)}` } });
}