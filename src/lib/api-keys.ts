import { z } from "zod";
import { diagnosisConsent } from "./diagnosis-automation";

/** Chaves de API do Pipeflow: "pfk_" + 43 caracteres base64url (32 bytes aleatórios). */
export const API_KEY_PATTERN = /^pfk_[A-Za-z0-9_-]{43}$/;
export const API_KEY_MAX_ACTIVE = 20;
export const DIAGNOSIS_ENDPOINT_PATH = "/api/public/v1/forms/diagnosis";
export const PUBLIC_BASE_URL = "https://crm.gravoncompany.com";

export const apiKeyNameSchema = z.string().trim().min(2, "Dê um nome com pelo menos 2 letras.").max(80);

export function newApiKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return "pfk_" + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export const apiKeyPrefix = (key: string) => key.slice(0, 12);

export async function hashApiKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Lê a chave de "Authorization: Bearer <chave>" ou "X-API-Key". Nunca aceita na URL. */
export function apiKeyFromHeaders(headers: Headers): string | null {
  const auth = headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(\S+)$/i.exec(auth.trim())?.[1];
  const key = bearer ?? headers.get("x-api-key")?.trim() ?? "";
  return API_KEY_PATTERN.test(key) ? key : null;
}

const ALIASES: Record<string, string[]> = {
  name: ["name", "nome", "fullname", "nomecompleto"],
  company: ["company", "empresa", "nomedaempresa"],
  email: ["email", "e-mail", "mail"],
  whatsapp: ["whatsapp", "telefone", "phone", "celular"],
  objective: ["objective", "objetivo", "objetivocomercial", "commercialobjective", "objetivo_comercial"],
  event_id: ["eventid", "event_id", "id_evento"],
  utm_content: ["utmcontent", "utm_content"],
};
const norm = (k: string) => k.toLowerCase().replace(/[\s_-]/g, "");

export const diagnosisSchema = z.object({
  name: z.string().trim().max(160).default(""),
  company: z.string().trim().max(160).default(""),
  email: z.union([z.literal(""), z.string().trim().toLowerCase().email().max(254)]).default(""),
  whatsapp: z.string().trim().max(60).default(""),
  objective: z.string().trim().max(4000).default(""),
  event_id: z.string().trim().min(1, "event_id é obrigatório").max(200),
  utm_content: z.string().trim().max(200).default(""),
  whatsapp_consent: diagnosisConsent.nullable().optional(),
});
export type DiagnosisPayload = z.infer<typeof diagnosisSchema>;

/** Aceita chaves em português/inglês, com ou sem objeto "data" (formato comum no Zapier). */
export function normalizeDiagnosis(raw: unknown) {
  const top = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const inner = top.data && typeof top.data === "object" ? (top.data as Record<string, unknown>) : {};
  const flat: Record<string, string> = {};
  for (const src of [inner, top]) for (const [k, v] of Object.entries(src)) {
    if (v === null || v === undefined || typeof v === "object") continue;
    const s = String(v).trim();
    if (s) flat[norm(k)] = s;
  }
  const out: Record<string, string> = {};
  for (const [field, keys] of Object.entries(ALIASES)) {
    const hit = keys.map(norm).find((k) => flat[k] !== undefined);
    if (hit) out[field] = flat[hit];
  }
  const evidence = top.whatsapp_consent ?? inner.whatsapp_consent;
  let consent: unknown = evidence;
  if (typeof evidence === "string") {
    try { consent = JSON.parse(evidence); } catch { consent = evidence; }
  }
  return diagnosisSchema.safeParse({ ...out, ...(evidence === undefined ? {} : { whatsapp_consent: consent }) });
}

export const DIAGNOSIS_OUTCOME_LABEL: Record<string, string> = {
  received: "Recebido",
  matched: "Contato localizado",
  ambiguous: "Identificação ambígua · nada pausado",
  not_found: "Contato não encontrado no Outbound",
  no_outbound: "Funil Outbound indisponível",
};
