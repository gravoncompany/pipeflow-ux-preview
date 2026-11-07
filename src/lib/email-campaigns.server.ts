import { campaignDb, reviewCampaign } from "./campaigns.server";
import { brevoCancelScheduled, brevoProviderStatus, brevoSend } from "./brevo.server";
import { getPortalAccount } from "./gravon-portal-admin.server";
import {
  emailReadiness,
  emailContentIssues,
  providerIssues,
  renderEmail,
  emptyEmailSettings,
  TEST_SEND_LIMIT,
  TEST_SEND_WINDOW_MS,
  type EmailSettings,
  type EmailSettingsInput,
  type ProviderStatus,
  type ReadinessIssue,
} from "./email-campaigns";
import type { Campaign, CampaignInput } from "./campaigns";

type Db = Awaited<ReturnType<typeof campaignDb>>;

export async function loadEmailSettings(db: Db): Promise<EmailSettings> {
  const result = await db
    .from("crm_campaign_email_settings")
    .select("sender_email,sender_name,reply_to,timezone,revision,updated_at")
    .eq("id", true)
    .maybeSingle();
  // Sem a migração 0086 o canal fica explicitamente pendente, nunca liberado.
  if (result.error) return { ...emptyEmailSettings, revision: -1 };
  return (result.data as EmailSettings | null) ?? emptyEmailSettings;
}

export async function emailChannelOverview() {
  const db = await campaignDb();
  await db.rpc("settle_crm_campaigns");
  const settings = await loadEmailSettings(db);
  const [tests, permissions, deliveries] = await Promise.all([
    db
      .from("crm_campaign_test_recipients")
      .select("id,email,label,evidence,recorded_by,authorized_at,revoked_at")
      .order("authorized_at", { ascending: false })
      .limit(50),
    db
      .from("crm_campaign_permissions")
      .select("id,lead_id,channel,contact,evidence,granted_at,recorded_at,withdrawn_at")
      .order("recorded_at", { ascending: false })
      .limit(300),
    db.from("crm_campaign_deliveries").select("campaign_id,state").limit(20000),
  ]);
  const summary: Record<string, Record<string, number>> = {};
  for (const d of (deliveries.data ?? []) as { campaign_id: string; state: string }[]) {
    summary[d.campaign_id] ??= {};
    summary[d.campaign_id][d.state] = (summary[d.campaign_id][d.state] ?? 0) + 1;
  }
  return {
    settings,
    migrationReady: settings.revision >= 0,
    testRecipients: (tests.data ?? []) as {
      id: string;
      email: string;
      label: string;
      evidence: string;
      recorded_by: string;
      authorized_at: string;
      revoked_at: string | null;
    }[],
    permissions: (permissions.data ?? []) as {
      id: string;
      lead_id: string;
      channel: "email" | "whatsapp";
      contact: string;
      evidence: string;
      granted_at: string;
      recorded_at: string;
      withdrawn_at: string | null;
    }[],
    deliverySummary: summary,
  };
}

export async function verifyEmailChannel() {
  const db = await campaignDb();
  const settings = await loadEmailSettings(db);
  const status = await brevoProviderStatus(settings);
  return { settings, status, issues: providerIssues(status, settings, "campaign") };
}

export async function saveEmailSettings(input: EmailSettingsInput) {
  const db = await campaignDb();
  const result = await db.rpc("save_crm_campaign_email_settings", {
    p_revision: input.revision,
    p_payload: input,
  });
  if (result.error || !result.data)
    throw new Error(
      result.error?.message?.includes("stale_settings")
        ? "Configuração alterada em outra aba; atualize e tente novamente."
        : "Não foi possível salvar o remetente. Verifique se a migração 0086 foi aplicada.",
    );
  return result.data as EmailSettings;
}

export async function validateEmailCampaign(
  input: Pick<CampaignInput, "leadIds" | "subject" | "body" | "scheduledAt">,
) {
  const db = await campaignDb();
  const [audience, settings] = await Promise.all([
    reviewCampaign(input.leadIds, "email"),
    loadEmailSettings(db),
  ]);
  const status = await brevoProviderStatus(settings);
  return {
    ...emailReadiness(input, status, settings, audience.eligible, Date.now(), audience.provider),
    status,
    timezone: settings.timezone,
    audience,
  };
}

function outcomeMessage(sent: number, scheduled: number, failed: number, unknown: number) {
  const parts = [
    sent && `${sent} aceitos pela Brevo para entrega`,
    scheduled && `${scheduled} agendados na Brevo`,
    failed && `${failed} recusados (não enviados)`,
    unknown && `${unknown} com resultado desconhecido (não serão reenviados automaticamente)`,
  ].filter(Boolean);
  return parts.join(" · ") || "Nenhum destinatário processado.";
}

/** Confirmação explícita do rascunho salvo exatamente na revisão revisada pelo usuário. */
export async function dispatchEmailCampaign(id: string, revision: number) {
  const db = await campaignDb();
  const row = await db.from("crm_campaigns").select("*").eq("id", id).single();
  if (row.error || !row.data) throw new Error("Campanha não encontrada; reabra o rascunho salvo.");
  const c = row.data as Campaign;
  if (c.channel !== "email") throw new Error("Use o fluxo do canal correspondente.");
  if (c.state !== "draft")
    return {
      ok: false as const,
      message: "Esta campanha já foi enviada, agendada ou cancelada; nada foi reenviado.",
      issues: [] as ReadinessIssue[],
    };
  if (c.revision !== revision)
    return {
      ok: false as const,
      message: "O rascunho mudou desde a revisão. Reabra a campanha e valide novamente.",
      issues: [] as ReadinessIssue[],
    };
  const validation = await validateEmailCampaign({
    leadIds: c.lead_ids,
    subject: c.subject,
    body: c.body,
    scheduledAt: c.scheduled_at,
  });
  if (!validation.ready)
    return {
      ok: false as const,
      message: "Envio bloqueado. Resolva os itens abaixo e valide novamente.",
      issues: validation.issues,
    };
  const settings = await loadEmailSettings(db);
  const eligible = validation.audience.recipients.filter((r) => r.eligible);
  const batch = crypto.randomUUID();
  const claim = await db.rpc("claim_crm_campaign_email", {
    p_id: c.id,
    p_revision: c.revision,
    p_recipients: eligible.map((r) => ({ lead_id: r.leadId, contact: r.contact })),
    p_scheduled_at: c.scheduled_at,
    p_batch: batch,
  });
  if (claim.error || !Array.isArray(claim.data)) {
    const reason = claim.error?.message ?? "";
    throw new Error(
      reason.includes("stale_or_locked")
        ? "A campanha já foi confirmada em outra aba ou mudou; nada foi reenviado."
        : reason.includes("recipient_not_eligible") || reason.includes("contact_changed")
          ? "Um destinatário perdeu a elegibilidade durante a confirmação. Revise os destinatários e valide novamente; nada foi enviado."
          : reason.includes("duplicate_recipient")
            ? "Endereço repetido na campanha; valide novamente. Nada foi enviado."
          : reason.includes("schedule")
            ? "A data de agendamento mudou ou passou; valide novamente. Nada foi enviado."
            : "Não foi possível reservar os envios; nada foi enviado.",
    );
  }
  const reserved = claim.data as { id: string; lead_id: string; contact: string }[];
  const people = new Map(validation.audience.recipients.map((r) => [r.leadId, r]));
  const counts = { accepted: 0, scheduled: 0, failed: 0, unknown: 0 };
  let persistenceError = false;
  for (let i = 0; i < reserved.length; i += 4) {
    await Promise.all(
      reserved.slice(i, i + 4).map(async (d) => {
        const person = people.get(d.lead_id);
        const content = renderEmail(
          { subject: c.subject, body: c.body },
          { name: person?.name ?? "", company: person?.company ?? "" },
        );
        const outcome = await brevoSend(settings, {
          to: d.contact,
          toName: person?.name ?? "",
          subject: content.subject,
          html: content.html,
          text: content.text,
          scheduledAt: c.scheduled_at,
          batchId: batch,
          tag: `crm-campaign-${c.id}`,
        });
        const state =
          outcome.state === "accepted"
            ? c.scheduled_at
              ? "scheduled"
              : "accepted"
            : outcome.state;
        counts[state]++;
        const saved = await db.rpc("finish_crm_campaign_delivery", {
          p_delivery: d.id,
          p_state: state,
          p_message_id: outcome.state === "accepted" ? outcome.messageId : "",
          p_error: outcome.state === "accepted" ? "" : outcome.code,
        });
        if (saved.error) persistenceError = true;
      }),
    );
  }
  await db.rpc("complete_crm_campaign_dispatch", { p_id: c.id });
  return {
    ok: true as const,
    message: `${outcomeMessage(counts.accepted, counts.scheduled, counts.failed, counts.unknown)}.${persistenceError ? " Alguns resultados não foram gravados; eles serão marcados como desconhecidos e não serão reenviados." : ""}`,
    counts,
    issues: [] as ReadinessIssue[],
  };
}

export async function cancelScheduledEmailCampaign(id: string, revision: number) {
  const db = await campaignDb();
  const row = await db
    .from("crm_campaigns")
    .select("id,state,revision,scheduled_at")
    .eq("id", id)
    .single();
  if (row.error || !row.data) throw new Error("Campanha não encontrada.");
  if (row.data.state !== "scheduled" || row.data.revision !== revision)
    throw new Error("Campanha mudou; atualize antes de cancelar.");
  if (row.data.scheduled_at && Date.parse(row.data.scheduled_at) <= Date.now())
    throw new Error(
      "O horário agendado já passou; o envio pode ter ocorrido e não pode mais ser cancelado.",
    );
  const deliveries = await db
    .from("crm_campaign_deliveries")
    .select("id,batch_id,provider_message_id")
    .eq("campaign_id", id)
    .eq("state", "scheduled");
  if (deliveries.error) throw new Error("Não foi possível ler os agendamentos.");
  const rows = (deliveries.data ?? []) as {
    id: string;
    batch_id: string;
    provider_message_id: string | null;
  }[];
  const batches = [...new Set(rows.map((r) => r.batch_id))];
  const cancelled = new Set<string>();
  for (const b of batches)
    if (await brevoCancelScheduled(b))
      rows.filter((r) => r.batch_id === b).forEach((r) => cancelled.add(r.id));
  for (const r of rows)
    if (
      !cancelled.has(r.id) &&
      r.provider_message_id &&
      (await brevoCancelScheduled(r.provider_message_id))
    )
      cancelled.add(r.id);
  const result = await db.rpc("cancel_crm_campaign_schedule", {
    p_id: id,
    p_revision: revision,
    p_cancelled: [...cancelled],
  });
  if (result.error)
    throw new Error(
      "Cancelamento na Brevo processado, mas o CRM não confirmou a gravação. Atualize a página.",
    );
  const remaining = (result.data as { remaining: number }).remaining;
  return {
    ok: remaining === 0,
    message:
      remaining === 0
        ? "Agendamento cancelado na Brevo. Nenhum e-mail desta campanha será enviado."
        : `${remaining} envio(s) não puderam ser cancelados na Brevo. Cancele-os em Brevo › Transacional › E-mails agendados antes do horário.`,
  };
}

export async function registerTestRecipient(email: string, label: string) {
  const db = await campaignDb();
  const account = await getPortalAccount().catch(() => null);
  const by =
    account?.authorized && account.email ? account.email : "Sessão administrativa completa do CRM";
  const evidence =
    `Endereço próprio informado e confirmado no CRM por ${by} em ${new Date().toISOString()} para receber apenas envios de teste.`.slice(
      0,
      500,
    );
  const result = await db.rpc("record_crm_campaign_test_recipient", {
    p_email: email,
    p_label: label,
    p_evidence: evidence,
    p_recorded_by: by.slice(0, 254),
    p_revoke: false,
  });
  if (result.error || result.data !== true)
    throw new Error(
      result.error?.message?.includes("suppressed")
        ? "Este endereço está na lista de bloqueio/descadastro e não pode receber testes."
        : "Não foi possível registrar o endereço de teste.",
    );
  return { ok: true };
}
export async function revokeTestRecipient(email: string) {
  const db = await campaignDb();
  const result = await db.rpc("record_crm_campaign_test_recipient", {
    p_email: email,
    p_label: "revogado",
    p_evidence: "Revogação manual",
    p_recorded_by: "CRM",
    p_revoke: true,
  });
  if (result.error || result.data !== true)
    throw new Error("Endereço de teste não encontrado ou já revogado.");
  return { ok: true };
}

/** Teste para endereço próprio autorizado: não usa leads, não muda a campanha e tem limite atômico. */
export async function sendEmailTest(input: {
  recipientId: string;
  campaignId: string | null;
  subject: string;
  body: string;
}) {
  const db = await campaignDb();
  const settings = await loadEmailSettings(db);
  const content = emailContentIssues(input);
  const status: ProviderStatus = await brevoProviderStatus(settings);
  const issues = [...content, ...providerIssues(status, settings, "test")];
  if (issues.some((i) => i.blocking))
    return { ok: false as const, message: "Teste bloqueado. Resolva os itens abaixo.", issues };
  const reserve = await db.rpc("reserve_crm_campaign_test", {
    p_recipient: input.recipientId,
    p_campaign: input.campaignId,
    p_limit: TEST_SEND_LIMIT,
    p_window_seconds: TEST_SEND_WINDOW_MS / 1000,
  });
  if (reserve.error || typeof reserve.data !== "string") {
    const reason = reserve.error?.message ?? "";
    throw new Error(
      reason.includes("rate_limited")
        ? `Limite de ${TEST_SEND_LIMIT} testes a cada 10 minutos atingido. Aguarde e tente novamente.`
        : reason.includes("suppressed")
          ? "Endereço de teste está bloqueado/descadastrado."
          : "Endereço de teste não autorizado ou revogado.",
    );
  }
  const rendered = renderEmail(input, { name: "Nome de teste", company: "Empresa de teste" }, true);
  const outcome = await brevoSend(settings, {
    to: reserve.data,
    toName: "",
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    scheduledAt: null,
    batchId: crypto.randomUUID(),
    tag: "crm-campaign-test",
  });
  await db.rpc("finish_crm_campaign_test", {
    p_recipient: input.recipientId,
    p_campaign: input.campaignId,
    p_state: outcome.state,
    p_message_id: outcome.state === "accepted" ? outcome.messageId : "",
    p_error: outcome.state === "accepted" ? "" : outcome.code,
  });
  if (outcome.state === "accepted")
    return {
      ok: true as const,
      message: `Teste aceito pela Brevo para ${reserve.data}. Confira a caixa de entrada e o spam.`,
      issues: [] as ReadinessIssue[],
    };
  return {
    ok: false as const,
    message:
      outcome.state === "failed"
        ? `A Brevo recusou o teste (${outcome.code}). Nada foi enviado.`
        : `Resultado do teste desconhecido (${outcome.code}); verifique a caixa de entrada antes de tentar de novo.`,
    issues: [] as ReadinessIssue[],
  };
}
