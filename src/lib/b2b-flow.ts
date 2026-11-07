/** Etapas da Prospecção B2B: Buscar → Revisar selecionadas → Primeiro contato. */
export const B2B_STEPS = [
  { id: "buscar", label: "Buscar empresas", short: "Buscar" },
  { id: "revisar", label: "Revisar selecionadas", short: "Revisar" },
  { id: "contato", label: "Primeiro contato", short: "Contato" },
] as const;
export type B2bStep = (typeof B2B_STEPS)[number]["id"];
export const parseB2bStep = (v: unknown): B2bStep | undefined =>
  v === "revisar" || v === "contato" ? v : undefined;

/** Registro manual de abordagem: texto fixo no histórico do lead, para reconhecer depois. */
export const FIRST_CONTACT_PREFIX = "Primeiro contato B2B";
export const FIRST_CONTACT_CHANNELS = { email: "E-mail", whatsapp: "WhatsApp", ligacao: "Ligação", outro: "Outro canal" } as const;
export type FirstContactChannel = keyof typeof FIRST_CONTACT_CHANNELS;

export function firstContactNote(channel: FirstContactChannel, note: string) {
  const extra = note.trim();
  return `${FIRST_CONTACT_PREFIX} · ${FIRST_CONTACT_CHANNELS[channel]}${extra ? `\n${extra}` : ""}`;
}

/** Última abordagem registrada no histórico do lead (null se nunca foi abordado por este registro). */
export function latestFirstContact(history: unknown): { date: string; channel: string } | null {
  if (!Array.isArray(history)) return null;
  let best: { date: string; channel: string } | null = null;
  for (const h of history) {
    if (!h || typeof h !== "object") continue;
    const { text, date } = h as { text?: unknown; date?: unknown };
    if (typeof text !== "string" || typeof date !== "string" || !text.startsWith(`${FIRST_CONTACT_PREFIX} · `)) continue;
    if (!Number.isFinite(new Date(date).getTime())) continue;
    const channel = text.slice(FIRST_CONTACT_PREFIX.length + 3).split("\n")[0].trim();
    if (!best || new Date(date) > new Date(best.date)) best = { date, channel };
  }
  return best;
}

export type ContactStage = "abordada" | "revisada" | "preparada" | "aguardando";
export const CONTACT_STAGE_LABEL: Record<ContactStage, string> = {
  abordada: "Abordada",
  revisada: "Mensagem revisada",
  preparada: "Mensagem preparada",
  aguardando: "Aguardando primeiro contato",
};

/** Situação de cada empresa cadastrada no funil de prospecção; abordagem registrada vence rascunhos. */
export function contactStage(leadId: string, drafts: readonly { lead_id: string; state: string }[], approached: ReadonlySet<string>): ContactStage {
  if (approached.has(leadId)) return "abordada";
  const own = drafts.filter((d) => d.lead_id === leadId);
  if (own.some((d) => d.state === "reviewed")) return "revisada";
  return own.length ? "preparada" : "aguardando";
}

/** Remove itens da seleção sem mexer nos cadastros já preparados. */
export function removeSelected(selected: readonly string[], ids: readonly string[]) {
  const drop = new Set(ids);
  return selected.filter((id) => !drop.has(id));
}

/** Every consumer (counter, bulk research, review/import) shares the same current-search scope. */
export function currentB2bSelection(selected: readonly string[], places: readonly { id: string }[], prepared: Record<string, { placeId?: string; cnpj?: string }>, enriched: Record<string, { placeId?: string; cnpj?: string }> = {}) {
  const allowed = new Set(places.map((p) => p.id));
  for (const [key, company] of Object.entries(prepared)) {
    if (key.startsWith("manual-") && !company.placeId) allowed.add(key);
  }
  for (const [key, company] of Object.entries({ ...enriched, ...prepared })) {
    if (key === `receita-${company.cnpj}` && company.cnpj && !company.placeId) allowed.add(key);
    if (key.startsWith("instagram-") && !company.placeId) allowed.add(key);
  }
  return [...new Set(selected)].filter((id) => allowed.has(id));
}

/** Reset only transient search data; keep filters, display mode and already-created CRM references. */
export function freshB2bSearch<P, C, S, E>(state: B2bSessionState<P, C, S, E>, query: S): B2bSessionState<P, C, S, E> {
  return { ...state, searched: query, places: [], cursor: null, selected: [], prepared: {}, enriched: {}, cnpjStatus: {} };
}

/** Estado da busca guardado na aba do navegador para não perder seleção ao trocar de etapa ou de página. */
export const B2B_SESSION_KEY = "pipeflow:b2b:sessao";
export type B2bSessionState<P, C, S, E = C> = {
  v: 1;
  filters: S;
  searched: S | null;
  places: P[];
  cursor: string | null;
  selected: string[];
  prepared: Record<string, C>;
  enriched: Record<string, E>;
  cnpjStatus: Record<string, string>;
  view: "cards" | "list";
  imported: number;
  /** Leads criados nesta sessão, destacados em Primeiro contato. */
  leadIds: string[];
};

export function parseB2bSession<P, C, S, E = C>(raw: string | null): B2bSessionState<P, C, S, E> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<B2bSessionState<P, C, S, E>>;
    if (!v || v.v !== 1 || !Array.isArray(v.places) || !Array.isArray(v.selected) || !v.filters) return null;
    const obj = (x: unknown) => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, never>) : {});
    return {
      v: 1,
      filters: v.filters,
      searched: v.searched ?? null,
      places: v.places,
      cursor: typeof v.cursor === "string" ? v.cursor : null,
      selected: v.selected.filter((s): s is string => typeof s === "string"),
      prepared: obj(v.prepared),
      enriched: obj(v.enriched),
      cnpjStatus: obj(v.cnpjStatus),
      view: v.view === "list" ? "list" : "cards",
      imported: typeof v.imported === "number" && v.imported >= 0 ? v.imported : 0,
      leadIds: Array.isArray(v.leadIds) ? v.leadIds.filter((s): s is string => typeof s === "string") : [],
    };
  } catch {
    return null;
  }
}
