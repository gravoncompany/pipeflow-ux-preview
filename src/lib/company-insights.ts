import { z } from "zod";
import { instagramProfile } from "./business-links";

/** Shared, browser-safe rules for the "Análise de site e Instagram" of B2B companies. */
export const igUserIdSchema = z.string().trim().regex(/^\d{6,25}$/, "O ID da conta do Instagram tem só números (6 a 25 dígitos).");
export const igTokenSchema = z.string().trim().min(40, "Token curto demais. Copie o token completo.").max(2000).regex(/^[A-Za-z0-9_\-|.]+$/, "O token tem caracteres inválidos.");
export const saveIgResearchInput = z.object({ igUserId: igUserIdSchema, token: igTokenSchema.optional(), revision: z.number().int().positive().nullable() }).strict();

/** Instagram handle from an exact profile URL or a bare @handle; never from posts/reels/other hosts. */
export function instagramHandle(value: string): string {
  const v = value.trim();
  if (!v) return "";
  const bare = v.replace(/^@/, "");
  if (/^[a-z0-9._]{1,30}$/i.test(bare) && !bare.includes("..")) return bare.toLowerCase();
  const profile = instagramProfile(v.startsWith("http") ? v : `https://www.instagram.com/${bare.replace(/^(www\.)?instagram\.com\//i, "")}`);
  return profile ? profile.split("/").filter(Boolean).pop() ?? "" : "";
}

/** Visible text of an HTML page: title, meta description and body without scripts/styles/tags. */
export function htmlToText(html: string, max = 4000): string {
  const title = html.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i)?.[1] ?? "";
  const desc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{0,500})["']/i)?.[1] ?? "";
  const body = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|section|br)>/gi, "\n").replace(/<[^>]+>/g, " ");
  const decode = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  const text = decode([title, desc, body].join("\n")).replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  return text.slice(0, max);
}

/** Same-host HTTPS links to "sobre/serviços/tratamentos" pages (max 3). */
export function insightLinks(html: string, base: string): string[] {
  const baseUrl = new URL(base), out = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    const label = `${m[1]} ${m[2].replace(/<[^>]+>/g, " ")}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (!/servic|tratament|procediment|especialidad|sobre|quem-somos|quem somos|about|solucoes|produtos/.test(label)) continue;
    try { const u = new URL(m[1], baseUrl); if (u.protocol === "https:" && u.host === baseUrl.host && u.href !== baseUrl.href) out.add(u.href.split("#")[0]); } catch { /* invalid link */ }
    if (out.size >= 3) break;
  }
  return [...out];
}

export const discoveryPostSchema = z.object({
  caption: z.string().optional(), timestamp: z.string().optional(), media_type: z.string().optional(),
  permalink: z.string().optional(), like_count: z.number().optional(), comments_count: z.number().optional(),
}).passthrough();
export const discoverySchema = z.object({
  business_discovery: z.object({
    username: z.string(), name: z.string().optional(), biography: z.string().optional(), website: z.string().optional(),
    followers_count: z.number().optional(), media_count: z.number().optional(),
    media: z.object({ data: z.array(discoveryPostSchema) }).optional(),
  }).passthrough(),
}).passthrough();
export type InstagramPublic = {
  username: string; name: string; biography: string; website: string; followers: number | null; posts: number | null;
  recent: { caption: string; date: string; type: string; permalink: string; likes: number | null; comments: number | null }[];
};
export function parseDiscovery(body: unknown): InstagramPublic | null {
  const p = discoverySchema.safeParse(body);
  if (!p.success) return null;
  const d = p.data.business_discovery;
  return {
    username: d.username.slice(0, 60), name: (d.name ?? "").slice(0, 200), biography: (d.biography ?? "").slice(0, 600), website: (d.website ?? "").slice(0, 300),
    followers: d.followers_count ?? null, posts: d.media_count ?? null,
    recent: (d.media?.data ?? []).slice(0, 8).map((m) => ({
      caption: (m.caption ?? "").slice(0, 500), date: (m.timestamp ?? "").slice(0, 25), type: (m.media_type ?? "").slice(0, 30),
      permalink: m.permalink?.startsWith("https://www.instagram.com/") ? m.permalink.slice(0, 300) : "",
      likes: m.like_count ?? null, comments: m.comments_count ?? null,
    })),
  };
}

/** What the AI must return; every list item names where it came from. */
export const insightSchema = z.object({
  summary: z.string().trim().min(10).max(800),
  services: z.array(z.object({ name: z.string().trim().min(2).max(160), source: z.enum(["site", "instagram"]) }).strict()).max(12),
  positioning: z.string().trim().max(600),
  recentPosts: z.string().trim().max(800),
  opportunities: z.array(z.string().trim().min(5).max(300)).max(6),
  emailAngle: z.string().trim().max(500),
}).strict();
export type CompanyInsight = z.infer<typeof insightSchema>;
export const insightJsonSchema = {
  type: "object", additionalProperties: false,
  required: ["summary", "services", "positioning", "recentPosts", "opportunities", "emailAngle"],
  properties: {
    summary: { type: "string" },
    services: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "source"], properties: { name: { type: "string" }, source: { type: "string", enum: ["site", "instagram"] } } } },
    positioning: { type: "string" }, recentPosts: { type: "string" },
    opportunities: { type: "array", items: { type: "string" } }, emailAngle: { type: "string" },
  },
} as const;

export type InsightSource = { name: "Site" | "Instagram"; url: string; outcome: string };
export type InsightView = { status: "running" | "done" | "error"; insight: CompanyInsight | null; sources: InsightSource[]; error: string | null; analyzedAt: string | null };

/** Compact text the e-mail AI receives; facts only, each tagged with its public source. */
export function insightForEmail(i: CompanyInsight | null | undefined): string {
  if (!i) return "";
  return [
    `Resumo: ${i.summary}`,
    i.services.length ? `Serviços: ${i.services.map((s) => `${s.name} (${s.source})`).join("; ")}` : "",
    i.positioning ? `Posicionamento: ${i.positioning}` : "",
    i.recentPosts ? `Publicações recentes: ${i.recentPosts}` : "",
    i.opportunities.length ? `Oportunidades de marketing: ${i.opportunities.join("; ")}` : "",
    i.emailAngle ? `Ângulo sugerido: ${i.emailAngle}` : "",
  ].filter(Boolean).join("\n").slice(0, 3000);
}

export function insightErrorText(code: string | null): string {
  switch (code) {
    case "no_sources": return "Sem site HTTPS público nem Instagram cadastrados neste card.";
    case "nothing_read": return "Nem o site nem o Instagram puderam ser lidos agora. Nada foi alterado.";
    case "ai_credits": return "Créditos de IA esgotados. Nada foi alterado.";
    case "ai_blocked": return "O acesso à IA está bloqueado neste espaço de trabalho.";
    case "ai_rate": return "Limite de uso da IA atingido. Tente de novo em alguns minutos.";
    case "ai_invalid": return "A IA não retornou uma análise válida. Tente de novo.";
    default: return "A análise não foi concluída. Nada foi alterado no card.";
  }
}

/** Short explanation of an Instagram Business Discovery failure, never echoing provider text. */
export function discoveryFailureText(code: string): string {
  if (code === "not_configured") return "Instagram não lido: a conexão de pesquisa da Meta ainda não foi configurada.";
  if (code === "timeout" || code === "network") return "Instagram não lido: a Meta não respondeu agora.";
  if (code === "190" || code.startsWith("190:")) return "Instagram não lido: o token da Meta expirou ou foi revogado.";
  if (["10", "200", "294"].some((p) => code === p || code.startsWith(`${p}:`))) return "Instagram não lido: o token não tem as permissões necessárias.";
  if (code === "110" || code.startsWith("110:") || code === "100" || code.startsWith("100:")) return "Instagram não lido: perfil não encontrado ou não é uma conta comercial/criador.";
  if (["4", "17", "32", "613"].includes(code) || code.startsWith("80")) return "Instagram não lido: limite de consultas da Meta atingido.";
  return "Instagram não lido: a Meta recusou a consulta.";
}
