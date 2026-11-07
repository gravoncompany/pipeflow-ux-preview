/**
 * Histórico da página do cliente: junta as atividades já registradas na ficha
 * (registros, tarefas, documentos, conhecimento, versões do planejamento,
 * pagamentos e reuniões já realizadas) em uma única lista, da mais recente
 * para a mais antiga. Somente leitura — nada aqui grava dados.
 */
export type ClientHistoryItem = { id: string; at: string; kind: string; title: string; detail?: string };

type Row = Record<string, any>;
export type ClientHistorySource = {
  client: Row;
  records?: Row[];
  tasks?: Row[];
  documents?: Row[];
  knowledge?: Row[];
  versions?: Row[];
  payments?: Row[];
  charges?: Row[];
  appointments?: Row[];
};

const valid = (d: unknown): d is string => typeof d === "string" && !Number.isNaN(new Date(d.length === 10 ? `${d}T12:00:00` : d).getTime());
const time = (d: string) => new Date(d.length === 10 ? `${d}T12:00:00` : d).getTime();

export function buildClientHistory(src: ClientHistorySource, labels: { record?: Record<string, string> } = {}, now = new Date()): ClientHistoryItem[] {
  const out: ClientHistoryItem[] = [];
  const push = (item: ClientHistoryItem) => { if (valid(item.at)) out.push(item); };
  for (const r of src.records ?? []) push({ id: `rec-${r.id}`, at: r.created_at, kind: labels.record?.[r.kind] ?? "Registro", title: r.description ?? "", detail: r.author || undefined });
  for (const t of src.tasks ?? []) push({ id: `task-${t.id}`, at: t.created_at, kind: "Tarefa", title: `Tarefa criada: ${t.title}`, detail: t.responsible || undefined });
  for (const d of src.documents ?? []) push({ id: `doc-${d.id}`, at: d.created_at, kind: "Documento", title: `Documento enviado: ${d.name}` });
  for (const k of src.knowledge ?? []) push({ id: `kn-${k.id}`, at: k.created_at, kind: k.kind === "resumo" ? "Resumo da IA" : "Conhecimento", title: k.title || (k.kind === "resumo" ? "Resumo inteligente atualizado" : "Conhecimento registrado"), detail: k.source || undefined });
  for (const v of src.versions ?? []) push({ id: `plan-${v.id}`, at: v.created_at, kind: "Planejamento", title: `Planejamento versão ${v.version} ${v.origin === "ia" ? "gerada pela IA" : "salva"}` });
  const chargeName = new Map((src.charges ?? []).map((c) => [c.id, c.description]));
  for (const p of src.payments ?? []) push({ id: `pay-${p.id}`, at: p.created_at ?? p.paid_at, kind: "Pagamento", title: `Pagamento registrado${chargeName.get(p.charge_id) ? `: ${chargeName.get(p.charge_id)}` : ""}`, detail: p.method || undefined });
  for (const a of src.appointments ?? []) {
    if (!valid(a.starts_at) || time(a.starts_at) > now.getTime()) continue;
    push({ id: `appt-${a.id}`, at: a.starts_at, kind: "Reunião", title: a.summary || "Reunião", detail: a.status === "cancelled" ? "cancelada" : undefined });
  }
  push({ id: `client-${src.client.id}`, at: src.client.created_at, kind: "Cadastro", title: "Cliente cadastrado" });
  return out.sort((a, b) => time(b.at) - time(a.at));
}
