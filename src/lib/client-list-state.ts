/** Estado da lista de Clientes (busca, situação e rolagem) para a volta da página do cliente. */
export const CLIENT_SORTS = ["nome", "mrr", "atraso", "vencimento", "renovacao", "saude"] as const;
export type ClientSort = (typeof CLIENT_SORTS)[number];
export type ClientListSearch = { q?: string; situacao?: string; ordem?: ClientSort; filtro?: "atrasados" | "risco"; visao?: "quadro" };

export function parseClientListSearch(s: Record<string, unknown>): ClientListSearch {
  const q = typeof s.q === "string" && s.q.trim() ? s.q.slice(0, 200) : undefined;
  const situacao = typeof s.situacao === "string" && s.situacao && s.situacao !== "todos" ? s.situacao : undefined;
  const out: ClientListSearch = { q, situacao };
  // Campos novos só entram quando presentes, para manter o formato antigo da URL e do estado salvo.
  if (typeof s.ordem === "string" && (CLIENT_SORTS as readonly string[]).includes(s.ordem) && s.ordem !== "nome") out.ordem = s.ordem as ClientSort;
  if (s.filtro === "atrasados" || s.filtro === "risco") out.filtro = s.filtro;
  if (s.visao === "quadro") out.visao = "quadro";
  return out;
}

const KEY = "pipeflow:clientes:lista";
type Stored = ClientListSearch & { scrollY?: number };

export function saveClientListState(state: Stored) {
  try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage bloqueado */ }
}

export function readClientListState(): Stored | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return { ...parseClientListSearch(v ?? {}), scrollY: typeof v?.scrollY === "number" && v.scrollY >= 0 ? v.scrollY : undefined };
  } catch { return null; }
}

export function clearClientListScroll() {
  const s = readClientListState();
  if (s) saveClientListState({ q: s.q, situacao: s.situacao, ordem: s.ordem, filtro: s.filtro, visao: s.visao });
}
