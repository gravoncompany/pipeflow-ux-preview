import { z } from "zod";
import { DEFAULT_STAGES, type Stage } from "./crm-types";

export const REFERENCE_SOURCES = { google_ads: "Google Ads", meta_ads: "Meta Ads" } as const;
export type ReferenceSource = keyof typeof REFERENCE_SOURCES;
export const REFERENCE_MODES = { exact: "Mensagem exata", contains: "Contém na mensagem" } as const;
export type ReferenceMode = keyof typeof REFERENCE_MODES;
export const REFERENCE_TAGS: Record<ReferenceSource, string> = { google_ads: "google-ads", meta_ads: "meta-ads" };
export const MAX_REFERENCE_MESSAGES = 50;
export const MAIN_PIPELINE_ID = null;

export type ReferenceMessage = {
  id: string; body: string; match_mode: ReferenceMode; source: ReferenceSource; pipeline_id: string | null;
  stage_id: string; active: boolean; revision: number; updated_at: string;
};
export type ReferencePipeline = { id: string | null; name: string; stages: Stage[] };

/** Mirrors public.crm_normalize_reference: trim, collapse spaces, lowercase, drop Portuguese accents. */
export function normalizeReference(text: string) {
  const from = "áàâãäéèêëíìîïóòôõöúùûüç", to = "aaaaaeeeeiiiiooooouuuuc";
  return [...text.trim().replace(/\s+/g, " ").toLowerCase()].map((c) => { const i = from.indexOf(c); return i >= 0 ? to[i] : c; }).join("");
}

/** Same precedence as the capture RPC: exact first, then the longest "contains"; ties with different targets are ambiguous. */
export function matchReference<T extends Pick<ReferenceMessage, "body" | "match_mode" | "active" | "pipeline_id" | "stage_id" | "source">>(body: string, refs: T[]) {
  const n = normalizeReference(body);
  if (!n) return { status: "none" as const };
  const exact = refs.find((r) => r.active && r.match_mode === "exact" && normalizeReference(r.body) === n);
  if (exact) return { status: "matched" as const, reference: exact };
  const contains = refs.filter((r) => r.active && r.match_mode === "contains" && n.includes(normalizeReference(r.body)));
  if (!contains.length) return { status: "none" as const };
  const best = Math.max(...contains.map((r) => normalizeReference(r.body).length));
  const top = contains.filter((r) => normalizeReference(r.body).length === best);
  const targets = new Set(top.map((r) => `${r.pipeline_id ?? "main"}|${r.stage_id}|${r.source}`));
  return targets.size > 1 ? { status: "ambiguous" as const } : { status: "matched" as const, reference: top[0]! };
}

export const referenceInput = z.object({
  id: z.string().uuid().nullable(),
  revision: z.number().int().nonnegative(),
  body: z.string().trim().min(5, "Mínimo de 5 caracteres.").max(1000),
  matchMode: z.enum(["exact", "contains"]),
  source: z.enum(["google_ads", "meta_ads"]),
  pipelineId: z.string().uuid().nullable(),
  stageId: z.string().min(1).max(80),
  active: z.boolean(),
}).strict();
export type ReferenceInput = z.infer<typeof referenceInput>;

/** The main funnel keeps browser-stored stage titles; the server accepts only the built-in stage ids. */
export function mainFunnelStages(): Stage[] { return DEFAULT_STAGES.map((s) => ({ ...s })); }

export const REFERENCE_ERRORS: Record<string, string> = {
  unknown_stage: "A etapa escolhida não existe nesse funil.",
  unknown_pipeline: "O funil escolhido não existe ou foi arquivado.",
  limit_reached: `Limite de ${MAX_REFERENCE_MESSAGES} mensagens de referência atingido.`,
  reference_changed: "A mensagem foi alterada por outra pessoa. Atualize a tela antes de salvar.",
  invalid_reference: "Confira o texto, o tipo de correspondência, a origem e a etapa.",
  duplicate: "Essa mensagem já está cadastrada com o mesmo tipo de correspondência.",
};
export function referenceError(error: { message?: string; code?: string } | null | undefined) {
  if (error?.code === "23505") return REFERENCE_ERRORS.duplicate;
  const key = Object.keys(REFERENCE_ERRORS).find((k) => error?.message?.includes(k));
  return key ? REFERENCE_ERRORS[key]! : "Não foi possível salvar a mensagem de referência.";
}
