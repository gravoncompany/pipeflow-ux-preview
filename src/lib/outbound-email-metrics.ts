// Agregação pura dos indicadores de e-mail do Outbound (somente leitura, sem efeitos).
export type MetricsMode = "all" | "manual" | "trigger";
export type MetricRun = { id: string; automation_id: string; enrollment_id: string | null; source: string; finished_at: string | null; cancelled_at: string | null };
export type MetricMessage = { id: string; enrollment_id: string; state: string; created_at: string };
export type MetricEvent = { run_id: string | null; kind: string; created_at: string };

/** Data local (YYYY-MM-DD, horário de Brasília) → intervalo ISO [início, fim). */
export function periodBounds(from: string, to: string) {
  const start = new Date(`${from}T00:00:00-03:00`);
  const end = new Date(`${to}T00:00:00-03:00`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function aggregateEmailMetrics(input: {
  runs: MetricRun[]; messages: MetricMessage[]; events: MetricEvent[]; liveEnrollments: Set<string>;
  automationIds: Set<string>; mode: MetricsMode; start: string; end: string;
}) {
  const inPeriod = (t: string) => { const x = Date.parse(t); return x >= Date.parse(input.start) && x < Date.parse(input.end); };
  // Envios de teste nunca entram nos indicadores comerciais.
  const runs = input.runs.filter((r) => input.automationIds.has(r.automation_id) && r.source !== "test" && (input.mode === "all" || r.source === input.mode));
  const byEnrollment = new Map(runs.filter((r) => r.enrollment_id).map((r) => [r.enrollment_id as string, r]));
  const runIds = new Set(runs.map((r) => r.id));
  const seen = new Set<string>();
  let sent = 0, failed = 0, unknown = 0;
  for (const m of input.messages) {
    if (seen.has(m.id) || !byEnrollment.has(m.enrollment_id) || !inPeriod(m.created_at)) continue;
    seen.add(m.id);
    // reserved = pendente/agendado: nunca conta como enviado.
    if (m.state === "accepted") sent++; else if (m.state === "failed") failed++; else if (m.state === "unknown") unknown++;
  }
  const evs = input.events.filter((e) => e.run_id && runIds.has(e.run_id) && inPeriod(e.created_at));
  const clicks = evs.filter((e) => e.kind === "click");
  const replies = new Set(evs.filter((e) => e.kind === "reply").map((e) => e.run_id));
  const active = runs.filter((r) => !r.finished_at && !r.cancelled_at && r.enrollment_id && input.liveEnrollments.has(r.enrollment_id));
  return {
    sent, failed, unknown,
    clicksTotal: clicks.length,
    clicksUnique: new Set(clicks.map((e) => e.run_id)).size,
    replies: replies.size,
    activeContacts: new Set(active.map((r) => r.id)).size,
  };
}
