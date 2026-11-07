import { b2bDb, requireB2bAccess } from "./b2b-prospecting.server";
import {
  activationIssues, compileAutomation, runBlocker, isRunToken, landingWithUtms, safeLandingUrl, saveAutomationInput, slugify,
  type AutomationGraph, type AutomationState, type CompiledAutomation, type RunEventKind,
} from "./automations";
import { aiApproved, type EmailFlow, type EnrollmentStatus } from "./email-flows";

type Db = Awaited<ReturnType<typeof b2bDb>>;
async function db() { await requireB2bAccess(); return b2bDb(); }

const rpcMessage = (raw: string | undefined, fallback: string) => {
  const r = raw ?? "";
  if (r.includes("stale_automation") || r.includes("stale_flow")) return "A automação foi alterada em outra aba. Atualize a página e tente de novo.";
  if (r.includes("pause_first")) return "Pause a automação antes de editar o desenho.";
  if (r.includes("ai_not_approved")) return "Confirme a aprovação da Gravon IA para ligar esta automação.";
  if (r.includes("landing_required")) return "Informe o endereço https:// da landing page do diagnóstico.";
  if (r.includes("tests_required")) return "Adicione ao menos um e-mail de teste.";
  if (r.includes("not_ready")) return "Corrija o desenho e escolha o funil do gatilho antes de ligar.";
  if (r.includes("invalid_pipeline")) return "Funil do gatilho não encontrado.";
  if (r.includes("invalid_steps")) return "Cada e-mail precisa de assunto e mensagem.";
  if (r.includes("suppressed_contact")) return "Este contato pediu para não receber e-mails ou está bloqueado.";
  return fallback;
};

export type AutomationRow = {
  id: string; name: string; state: AutomationState; graph: AutomationGraph; compiled: Partial<CompiledAutomation>; compile_ok: boolean;
  trigger_pipeline_id: string | null; flow_id: string | null; landing_url: string; test_contacts: string[]; slug: string;
  revision: number; activated_at: string | null; created_at: string; updated_at: string;
};

async function pipelines(d: Db) {
  const p = await d.from("sales_pipelines").select("id,name,stages,archived").eq("archived", false).order("created_at");
  return (p.data ?? []).map((x) => ({ id: x.id as string, name: x.name as string, stages: (Array.isArray(x.stages) ? x.stages : []) as { id: string; title: string }[] }));
}

export async function automationsOverview() {
  const d = await db();
  const [list, runs, runner] = await Promise.all([
    d.from("crm_automations").select("*").neq("state", "archived").order("created_at"),
    d.from("crm_automation_runs").select("automation_id,reply_at,form_at,clicks,finished_at,cancelled_at"),
    d.from("crm_email_flow_runner").select("agent_enabled,last_run_at,gmail_checked_at").eq("id", true).maybeSingle(),
  ]);
  if (list.error) throw new Error("Automações indisponíveis.");
  const stats = new Map<string, { runs: number; replies: number; forms: number; clicks: number; finished: number }>();
  for (const r of runs.data ?? []) {
    const s = stats.get(r.automation_id) ?? { runs: 0, replies: 0, forms: 0, clicks: 0, finished: 0 };
    s.runs++; if (r.reply_at) s.replies++; if (r.form_at) s.forms++; if (r.clicks > 0) s.clicks++; if (r.finished_at) s.finished++;
    stats.set(r.automation_id, s);
  }
  return {
    automations: ((list.data ?? []) as AutomationRow[]).map((a) => ({ ...a, stats: stats.get(a.id) ?? { runs: 0, replies: 0, forms: 0, clicks: 0, finished: 0 } })),
    pipelines: await pipelines(d),
    agentEnabled: runner.data?.agent_enabled === true,
    lastRunAt: (runner.data?.last_run_at ?? null) as string | null,
  };
}

export async function automationDetail(id: string) {
  const d = await db();
  const a = await d.from("crm_automations").select("*").eq("id", id).maybeSingle();
  if (a.error || !a.data) throw new Error("Automação não encontrada.");
  const row = a.data as AutomationRow;
  const [flow, runs, events, pl, runner] = await Promise.all([
    row.flow_id ? d.from("crm_email_flows").select("*").eq("id", row.flow_id).maybeSingle() : Promise.resolve({ data: null }),
    d.from("crm_automation_runs").select("*").eq("automation_id", id).order("created_at", { ascending: false }).limit(200),
    d.from("crm_automation_events").select("id,run_id,lead_id,kind,detail,created_at").eq("automation_id", id).order("created_at", { ascending: false }).limit(200),
    pipelines(d),
    d.from("crm_email_flow_runner").select("agent_enabled").eq("id", true).maybeSingle(),
  ]);
  const agentEnabled = runner.data?.agent_enabled === true;
  const stageTitle = (pid: string | null, sid: string) => pl.find((p) => p.id === pid)?.stages.find((s) => s.id === sid)?.title ?? sid;
  const runRows = runs.data ?? [];
  const [enr, leads, msgs] = await Promise.all([
    runRows.length ? d.from("crm_email_flow_enrollments").select("id,status,next_step,next_send_at,last_sent_at,reason").in("id", runRows.map((r) => r.enrollment_id).filter(Boolean)) : Promise.resolve({ data: [] }),
    runRows.length ? d.from("leads").select("id,name,company,stage,pipeline_id").in("id", runRows.map((r) => r.lead_id)) : Promise.resolve({ data: [] }),
    runRows.length ? d.from("crm_email_flow_messages").select("enrollment_id,state").eq("direction", "out").eq("kind", "sequence").in("enrollment_id", runRows.map((r) => r.enrollment_id).filter(Boolean)) : Promise.resolve({ data: [] }),
  ]);
  const eMap = new Map((enr.data ?? []).map((e) => [e.id as string, e]));
  const lMap = new Map((leads.data ?? []).map((l) => [l.id as string, l]));
  const f = flow.data as EmailFlow | null;
  return {
    automation: row,
    flow: f ? { state: f.state, aiApproved: aiApproved(f), aiEnabled: f.ai_enabled, sendDays: f.send_days, sendStart: f.send_start, sendEnd: f.send_end, steps: f.steps.length } : null,
    pipelines: pl,
    runs: runRows.map((r) => {
      const e = r.enrollment_id ? eMap.get(r.enrollment_id) : undefined, l = lMap.get(r.lead_id);
      return {
        id: r.id as string, leadId: r.lead_id as string, leadName: (l?.name as string) || (l?.company as string) || "Card", company: (l?.company as string) ?? "",
        contact: r.contact as string, source: r.source as "trigger" | "manual" | "test", clicks: r.clicks as number,
        replyAt: r.reply_at as string | null, formAt: r.form_at as string | null, finishedAt: r.finished_at as string | null, cancelledAt: r.cancelled_at as string | null,
        createdAt: r.created_at as string, status: (e?.status ?? "stopped") as EnrollmentStatus, nextStep: (e?.next_step as number) ?? 0,
        nextSendAt: (e?.next_send_at as string | null) ?? null, lastSentAt: (e?.last_sent_at as string | null) ?? null, reason: (e?.reason as string) ?? "",
        sent: (msgs.data ?? []).filter((m) => m.enrollment_id === r.enrollment_id && m.state === "accepted").length,
        stage: l ? stageTitle(l.pipeline_id as string | null, l.stage as string) : "",
        blocker: runBlocker({ automationState: row.state, flowState: f?.state ?? null, agentEnabled, status: (e?.status as string) ?? "stopped", nextSendAt: (e?.next_send_at as string | null) ?? null }),
      };
    }),
    events: (events.data ?? []) as { id: string; run_id: string | null; lead_id: string | null; kind: RunEventKind; detail: string; created_at: string }[],
  };
}

export async function saveAutomation(raw: unknown) {
  const input = saveAutomationInput.parse(raw);
  const d = await db();
  const graph = input.graph as AutomationGraph;
  const result = compileAutomation(graph);
  const landing = input.landingUrl ? safeLandingUrl(input.landingUrl) : "";
  if (input.landingUrl && !landing) throw new Error("A landing page precisa ser um endereço https:// válido.");
  const trigger = graph.nodes.find((n) => n.kind === "trigger");
  const pipelineId = trigger?.kind === "trigger" ? trigger.data.pipelineId : null;
  if (result.ok) {
    const pl = (await pipelines(d)).find((p) => p.id === pipelineId);
    const stageIds = new Set(pl?.stages.map((s) => s.id) ?? []);
    for (const acts of [result.compiled.onReply, result.compiled.onForm, result.compiled.onFinish, ...result.compiled.stepActions.map((x) => x.actions)]) {
      if (acts?.stage && (!stageIds.has(acts.stage) || acts.stage === "fechado")) throw new Error("Uma ação “Atualizar card” usa uma etapa que não existe no funil do gatilho (ou “Fechado”, que não é permitido).");
    }
  }
  const r = await d.rpc("save_crm_automation", {
    p_id: input.id, p_revision: input.revision, p_name: input.name, p_graph: graph,
    p_compiled: result.ok ? result.compiled : {}, p_compile_ok: result.ok, p_pipeline: pipelineId,
    p_landing: landing || "", p_tests: [...new Set(input.testContacts)], p_slug: slugify(input.name),
  });
  if (r.error) throw new Error(rpcMessage(r.error.message, "Não foi possível salvar a automação."));
  return { automation: r.data as AutomationRow, errors: result.ok ? [] : result.errors };
}

export async function setAutomationState(input: { id: string; revision: number; state: "test" | "active" | "paused" | "archived"; approveAi: boolean }) {
  const d = await db();
  if (input.state === "test" || input.state === "active") {
    const a = await d.from("crm_automations").select("*").eq("id", input.id).maybeSingle();
    const row = a.data as AutomationRow | null;
    if (!row) throw new Error("Automação não encontrada.");
    const c = compileAutomation(row.graph);
    if (!c.ok) throw new Error(c.errors[0]);
    const issues = activationIssues(c.compiled, { landingUrl: row.landing_url, testContacts: row.test_contacts }, input.state);
    if (issues.length) throw new Error(issues.join(" "));
  }
  const r = await d.rpc("set_crm_automation_state", { p_id: input.id, p_revision: input.revision, p_state: input.state, p_approve_ai: input.approveAi });
  if (r.error) throw new Error(rpcMessage(r.error.message, "Não foi possível mudar o estado."));
  return r.data as AutomationRow;
}

export async function startAutomationRun(input: { automationId: string; leadId: string; source: "manual" | "test" }) {
  const d = await db();
  const r = await d.rpc("start_crm_automation_run", { p_automation: input.automationId, p_lead: input.leadId, p_source: input.source });
  if (r.error) throw new Error(rpcMessage(r.error.message, "Não foi possível incluir o card."));
  return r.data as { ok: boolean; reason?: string; run?: string };
}

export async function automationRunAction(input: { runId: string; action: "pause" | "resume" | "cancel" | "send_now" }) {
  const d = await db();
  const r = await d.rpc("set_crm_automation_run", { p_run: input.runId, p_action: input.action });
  if (r.error) throw new Error(rpcMessage(r.error.message, "Ação indisponível."));
  if (r.data !== true) throw new Error("Esta ação não se aplica à situação atual do card.");
  return { ok: true };
}

/** Automações de início manual ligadas (teste ou ativa) para o funil dos cards selecionados. */
export async function manualAutomations(input: { pipelineId: string | null }) {
  const d = await db();
  let sel = d.from("crm_automations").select("id,name,state,test_contacts,trigger_pipeline_id,compiled").eq("trigger_mode", "manual").in("state", ["test", "active"]).order("created_at");
  if (input.pipelineId) sel = sel.eq("trigger_pipeline_id", input.pipelineId);
  const r = await sel;
  if (r.error) throw new Error("Automações indisponíveis.");
  return (r.data ?? []).map((a) => ({
    id: a.id as string, name: a.name as string, state: a.state as "test" | "active", testContacts: (a.test_contacts as string[]).length,
    emails: Array.isArray((a.compiled as { steps?: unknown[] })?.steps) ? (a.compiled as { steps: unknown[] }).steps.length : 0,
  }));
}

export const MANUAL_START_MAX = 50;

/**
 * Inclui os cards selecionados numa automação de início manual. Cada card passa pelas mesmas travas do banco
 * (funil do gatilho, e-mail válido, descadastro, uma vez por card, uma sequência ativa por contato, modo teste).
 */
export async function startSelectedRuns(input: { automationId: string; leadIds: string[] }) {
  const d = await db();
  const a = await d.from("crm_automations").select("id,state,trigger_mode").eq("id", input.automationId).maybeSingle();
  if (!a.data) throw new Error("Automação não encontrada.");
  if (a.data.trigger_mode !== "manual") throw new Error("Esta automação dispara sozinha quando o card entra no funil; escolha uma automação de início manual.");
  if (a.data.state !== "test" && a.data.state !== "active") throw new Error("Ligue a automação (em teste ou ativa) antes de incluir cards.");
  const ids = [...new Set(input.leadIds)].slice(0, MANUAL_START_MAX);
  const results: { leadId: string; ok: boolean; reason: string }[] = [];
  for (const leadId of ids) {
    const r = await d.rpc("start_crm_automation_run", { p_automation: input.automationId, p_lead: leadId, p_source: "manual" });
    const v = r.data as { ok: boolean; reason?: string } | null;
    results.push({ leadId, ok: !r.error && v?.ok === true, reason: r.error ? "Não foi possível incluir agora." : v?.ok ? "" : v?.reason ?? "Não incluído." });
  }
  return { started: results.filter((x) => x.ok).length, results };
}

/** Cards elegíveis para inclusão manual/teste (busca por nome, empresa ou e-mail). */
export async function automationCandidates(input: { automationId: string; query: string }) {
  const d = await db();
  const a = await d.from("crm_automations").select("trigger_pipeline_id,state,test_contacts").eq("id", input.automationId).maybeSingle();
  if (!a.data) throw new Error("Automação não encontrada.");
  const q = input.query.replace(/[%,()]/g, " ").trim().slice(0, 80);
  let sel = d.from("leads").select("id,name,company,email,pipeline_id").neq("email", "").order("created_at", { ascending: false }).limit(20);
  if (a.data.state === "test") sel = sel.in("email", a.data.test_contacts as string[]);
  else if (a.data.trigger_pipeline_id) sel = sel.eq("pipeline_id", a.data.trigger_pipeline_id);
  if (q) sel = sel.or(`name.ilike.%${q}%,company.ilike.%${q}%,email.ilike.%${q}%`);
  const r = await sel;
  return (r.data ?? []).map((l) => ({ id: l.id as string, name: (l.name as string) || (l.company as string), company: l.company as string, email: l.email as string }));
}

/** Histórico das automações de um card (aba de e-mails do card). */
export async function leadAutomations(leadId: string) {
  const d = await db();
  const runs = await d.from("crm_automation_runs").select("*").eq("lead_id", leadId).order("created_at", { ascending: false });
  const rows = runs.data ?? [];
  if (!rows.length) return [];
  const [autos, enr, events, runner, lead, pl] = await Promise.all([
    d.from("crm_automations").select("id,name,state").in("id", rows.map((r) => r.automation_id)),
    d.from("crm_email_flow_enrollments").select("id,status,next_step,next_send_at,last_sent_at,reason,flow_id").in("id", rows.map((r) => r.enrollment_id).filter(Boolean)),
    d.from("crm_automation_events").select("id,run_id,kind,detail,created_at").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(100),
    d.from("crm_email_flow_runner").select("agent_enabled").eq("id", true).maybeSingle(),
    d.from("leads").select("name,company,stage,pipeline_id").eq("id", leadId).maybeSingle(),
    pipelines(d),
  ]);
  const ld = lead.data;
  const stage = ld ? pl.find((p) => p.id === ld.pipeline_id)?.stages.find((s) => s.id === ld.stage)?.title ?? (ld.stage as string) : "";
  const msgs = (enr.data ?? []).length ? await d.from("crm_email_flow_messages").select("enrollment_id,state").eq("direction", "out").eq("kind", "sequence").in("enrollment_id", (enr.data ?? []).map((e) => e.id)) : { data: [] };
  const flows = (enr.data ?? []).length ? await d.from("crm_email_flows").select("id,steps,max_messages,state").in("id", (enr.data ?? []).map((e) => e.flow_id)) : { data: [] };
  const aMap = new Map((autos.data ?? []).map((a) => [a.id as string, a]));
  const eMap = new Map((enr.data ?? []).map((e) => [e.id as string, e]));
  const fMap = new Map((flows.data ?? []).map((f) => [f.id as string, f]));
  return rows.map((r) => {
    const e = r.enrollment_id ? eMap.get(r.enrollment_id) : undefined;
    const f = e ? fMap.get(e.flow_id) : undefined;
    return {
      id: r.id as string, automationId: r.automation_id as string, name: (aMap.get(r.automation_id)?.name as string) ?? "Automação",
      source: r.source as string, status: (e?.status ?? "stopped") as EnrollmentStatus, reason: (e?.reason as string) ?? "",
      nextStep: (e?.next_step as number) ?? 0, totalSteps: f ? Math.min((f.steps as unknown[]).length, f.max_messages as number) : 0,
      nextSendAt: (e?.next_send_at as string | null) ?? null, lastSentAt: (e?.last_sent_at as string | null) ?? null,
      clicks: r.clicks as number, replyAt: r.reply_at as string | null, formAt: r.form_at as string | null, cancelledAt: r.cancelled_at as string | null,
      events: (events.data ?? []).filter((x) => x.run_id === r.id) as { id: string; kind: RunEventKind; detail: string; created_at: string }[],
      contactName: (ld?.name as string) ?? "", company: (ld?.company as string) ?? "", stage, contact: r.contact as string,
      sent: (msgs.data ?? []).filter((m) => m.enrollment_id === r.enrollment_id && m.state === "accepted").length,
      blocker: runBlocker({ automationState: (aMap.get(r.automation_id)?.state as string) ?? "", flowState: (f?.state as string) ?? null,
        agentEnabled: runner.data?.agent_enabled === true, status: (e?.status as string) ?? "stopped", nextSendAt: (e?.next_send_at as string | null) ?? null }),
    };
  });
}

/* ------------------------- Execução (agendador) ------------------------- */

/** Antes dos envios: inscreve cards do gatilho e encerra quem preencheu o formulário. */
export async function automationPreSend(d: Db, notes: string[]) {
  const entries = await d.rpc("process_crm_automation_entries", { p_limit: 50 });
  if (entries.error) notes.push("Automações: entradas de cards não processadas nesta execução.");
  const forms = await d.rpc("detect_crm_automation_forms");
  if (forms.error) { notes.push("Automações: verificação de formulários indisponível; envios das automações suspensos."); return false; }
  return true;
}

/** Depois de ler as respostas: registra respostas e conclusões e aplica as ações do desenho. */
export async function automationPostReplies(d: Db, notes: string[]) {
  const s = await d.rpc("settle_crm_automation_runs");
  if (s.error) notes.push("Automações: respostas/conclusões serão registradas na próxima execução.");
}

export type AutomationSendContext = { automationFlow: true; token: string | null; landingOk: boolean; segment: string; city: string };

/** Dados extras do envio de uma etapa gerada por automação. */
export async function automationSendContext(d: Db, enrollmentId: string, leadId: string): Promise<AutomationSendContext> {
  const [run, company] = await Promise.all([
    d.from("crm_automation_runs").select("token,automation_id,form_at,cancelled_at").eq("enrollment_id", enrollmentId).maybeSingle(),
    d.from("b2b_companies").select("profile").eq("lead_id", leadId).maybeSingle(),
  ]);
  const p = (company.data?.profile ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string).slice(0, 120) : "");
  let landingOk = false;
  if (run.data?.automation_id) {
    const a = await d.from("crm_automations").select("landing_url").eq("id", run.data.automation_id).maybeSingle();
    landingOk = Boolean(a.data?.landing_url);
  }
  const blocked = Boolean(run.data?.form_at || run.data?.cancelled_at);
  return { automationFlow: true, token: run.data && !blocked ? (run.data.token as string) : null, landingOk, segment: s("segment"), city: s("city") };
}

/** Clique público: registra e devolve o destino com UTMs, ou null para token desconhecido. */
export async function recordAutomationClick(token: string) {
  if (!isRunToken(token)) return null;
  const d = await b2bDb();
  const r = await d.rpc("record_crm_automation_click", { p_token: token });
  const data = r.data as { url: string; slug: string } | null;
  if (r.error || !data?.url || !safeLandingUrl(data.url)) return null;
  return landingWithUtms(data.url, data.slug, token);
}

/** Indicadores de e-mail do funil (somente leitura): envios reais da sequência, eventos e contatos ativos. */
export async function outboundEmailMetrics(input: { pipelineId: string; from: string; to: string; automationId: string | null; mode: "all" | "manual" | "trigger" }) {
  const { aggregateEmailMetrics, periodBounds } = await import("./outbound-email-metrics");
  const d = await db();
  const { start, end } = periodBounds(input.from, input.to);
  const autos = await d.from("crm_automations").select("id,name,state").eq("trigger_pipeline_id", input.pipelineId).neq("state", "draft").order("created_at");
  if (autos.error) throw new Error("Indicadores de e-mail indisponíveis.");
  const list = (autos.data ?? []).map((a) => ({ id: a.id as string, name: a.name as string, state: a.state as string }));
  const ids = list.filter((a) => !input.automationId || a.id === input.automationId).map((a) => a.id);
  const empty = { automations: list, sent: 0, failed: 0, unknown: 0, clicksTotal: 0, clicksUnique: 0, replies: 0, activeContacts: 0, updatedAt: new Date().toISOString() };
  if (!ids.length) return empty;
  const runs = await d.from("crm_automation_runs").select("id,automation_id,enrollment_id,source,finished_at,cancelled_at").in("automation_id", ids);
  if (runs.error) throw new Error("Indicadores de e-mail indisponíveis.");
  const enrollmentIds = (runs.data ?? []).map((r) => r.enrollment_id).filter(Boolean) as string[];
  const chunks: string[][] = []; for (let i = 0; i < enrollmentIds.length; i += 200) chunks.push(enrollmentIds.slice(i, i + 200));
  const msgs: { id: string; enrollment_id: string; state: string; created_at: string }[] = [];
  const live = new Set<string>();
  for (const c of chunks) {
    const [m, e] = await Promise.all([
      d.from("crm_email_flow_messages").select("id,enrollment_id,state,created_at").in("enrollment_id", c).eq("direction", "out").eq("kind", "sequence").gte("created_at", start).lt("created_at", end),
      d.from("crm_email_flow_enrollments").select("id").in("id", c).in("status", ["active", "awaiting_reply", "in_conversation"]),
    ]);
    if (m.error || e.error) throw new Error("Indicadores de e-mail indisponíveis.");
    msgs.push(...((m.data ?? []) as typeof msgs));
    for (const x of e.data ?? []) live.add(x.id as string);
  }
  const ev = await d.from("crm_automation_events").select("run_id,kind,created_at").in("automation_id", ids).in("kind", ["click", "reply"]).gte("created_at", start).lt("created_at", end);
  if (ev.error) throw new Error("Indicadores de e-mail indisponíveis.");
  const agg = aggregateEmailMetrics({ runs: runs.data ?? [], messages: msgs, events: ev.data ?? [], liveEnrollments: live, automationIds: new Set(ids), mode: input.mode, start, end });
  return { ...empty, ...agg };
}
