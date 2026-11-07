// Etiquetas automáticas do funil Outbound: derivadas na leitura dos eventos reais (Central de Automações,
// envios aceitos pelo Brevo, diagnóstico recebido). Nunca são gravadas no card nem editadas à mão.
export const AUTO_TAGS = [
  { id: "auto:automacao-ativa", label: "Automação ativa" },
  { id: "auto:email-enviado", label: "E-mail enviado" },
  { id: "auto:formulario-preenchido", label: "Formulário preenchido" },
] as const;
export type AutoTagId = (typeof AUTO_TAGS)[number]["id"];

export type AutoTagInputs = {
  leadIds: string[];
  runs: { leadId: string; source: string; finishedAt: string | null; cancelledAt: string | null; automationState: string; enrollmentStatus: string | null; formAt: string | null }[];
  /** Leads com algum e-mail aceito pelo Brevo (messageId registrado). */
  emailed: string[];
  /** Leads com formulário de diagnóstico recebido e vinculado ao card. */
  formLeads: string[];
};

export function outboundAutoTags(i: AutoTagInputs): Record<string, AutoTagId[]> {
  const allowed = new Set(i.leadIds);
  const tags = new Map<string, Set<AutoTagId>>();
  const add = (leadId: string, t: AutoTagId) => { if (!allowed.has(leadId)) return; const s = tags.get(leadId) ?? new Set(); s.add(t); tags.set(leadId, s); };
  for (const r of i.runs) {
    if (r.source === "test") continue;
    if (!r.finishedAt && !r.cancelledAt && r.automationState === "active" && (r.enrollmentStatus === null || r.enrollmentStatus === "active")) add(r.leadId, "auto:automacao-ativa");
    if (r.formAt) add(r.leadId, "auto:formulario-preenchido");
  }
  for (const id of i.emailed) add(id, "auto:email-enviado");
  for (const id of i.formLeads) add(id, "auto:formulario-preenchido");
  const order = AUTO_TAGS.map((t) => t.id);
  return Object.fromEntries([...tags].map(([k, s]) => [k, order.filter((t) => s.has(t))]));
}
