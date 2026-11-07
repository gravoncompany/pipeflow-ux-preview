import { z } from "zod";

export const PRIORITY_ORDER = { urgente: 0, alta: 1, media: 2, baixa: 3 } as const;
export type TaskPriority = keyof typeof PRIORITY_ORDER;

export const suggestionSchema = z.object({
  title: z.string().trim().min(2).max(300),
  description: z.string().max(5000),
  reason: z.string().max(1000).default(""),
  priority: z.enum(["urgente", "alta", "media", "baixa"]),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  dueEvidence: z.string().max(500).nullable(),
  status: z.enum(["pendente", "em_andamento"]),
  kind: z.enum(["solicitacao", "problema", "compromisso", "pendencia"]),
  resolved: z.boolean(),
  sourceMessageId: z.string().min(1).max(200),
  quote: z.string().min(1).max(1000),
});
export type TaskSuggestion = z.infer<typeof suggestionSchema>;

export const normalizeTitle = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** Mesma tarefa = mesmo título normalizado, ou um contém o outro com pelo menos 12 caracteres. */
export function sameTask(a: string, b: string) {
  const x = normalizeTitle(a), y = normalizeTitle(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [s, l] = x.length < y.length ? [x, y] : [y, x];
  return s.length >= 12 && l.includes(s);
}

export const dedupeKey = (sourceMessageId: string, title: string) => `${sourceMessageId}:${normalizeTitle(title)}`.slice(0, 400);

type Msg = { id: string; body: string };
type Existing = { title: string; source_message_id?: string | null; dedupe_key?: string | null };

/**
 * Mantém só sugestões com citação literal da mensagem indicada, descarta resolvidas,
 * remove prazos sem evidência literal e tarefas já existentes (abertas ou concluídas) ou repetidas.
 */
export function validateSuggestions(raw: unknown[], messages: Msg[], existing: Existing[]) {
  const byId = new Map(messages.map((m) => [m.id, m.body]));
  const all = messages.map((m) => m.body).join("\n");
  const out: TaskSuggestion[] = [];
  let duplicates = 0, resolved = 0, invalid = 0;
  for (const r of raw) {
    const p = suggestionSchema.safeParse(r);
    if (!p.success) { invalid++; continue; }
    const s = { ...p.data };
    const body = byId.get(s.sourceMessageId);
    if (!body || !body.includes(s.quote.trim())) { invalid++; continue; }
    if (s.resolved) { resolved++; continue; }
    if (s.dueDate && (!s.dueEvidence || !all.includes(s.dueEvidence.trim()))) { s.dueDate = null; s.dueEvidence = null; }
    const key = dedupeKey(s.sourceMessageId, s.title);
    if (existing.some((e) => e.dedupe_key === key || sameTask(e.title, s.title)) || out.some((o) => sameTask(o.title, s.title))) { duplicates++; continue; }
    out.push(s);
  }
  return { suggestions: out, duplicates, resolved, invalid };
}

export function isOverdue(t: { due_date: string | null; status: string }, today = new Date().toISOString().slice(0, 10)) {
  return !!t.due_date && t.status !== "concluida" && t.due_date < today;
}
