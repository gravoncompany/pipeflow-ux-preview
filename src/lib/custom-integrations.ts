import { z } from "zod";
export const AUTH_METHODS = { none: "Sem autenticação", bearer: "Token Bearer", api_key_header: "Chave em cabeçalho", basic: "Usuário e senha (Basic)" } as const;
export const endpointSchema = z.object({ name: z.string().trim().min(1).max(80), method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]), path: z.string().trim().max(300).regex(/^\/[^\s]*$/, "Caminho deve começar com /") });
export const customIntegrationInput = z.object({
  id: z.string().uuid().nullable(), revision: z.number().int().min(0),
  name: z.string().trim().min(2).max(80), baseUrl: z.string().trim().url().max(300),
  authMethod: z.enum(["none", "bearer", "api_key_header", "basic"]), authHeader: z.string().trim().max(80).regex(/^[A-Za-z0-9-]*$/).default(""),
  credential: z.string().max(2000).optional(), endpoints: z.array(endpointSchema).max(30),
}).strict();
/** Only public HTTPS hosts can be tested (blocks localhost/private ranges). */
export function safeBaseUrl(raw: string) {
  let u: URL; try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "https:" || u.username || u.password) return false;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || /^\[|^(127|10|0)\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  return true;
}
export function integrationTestPath(baseUrl: string, name: string, endpoints: { method: string; path: string }[]) {
  if (baseUrl.replace(/\/+$/, '') === 'https://api.apify.com/v2' && /apify/i.test(name)) return '/acts/apify~instagram-scraper';
  const path = endpoints.find(e => e.method === 'GET')?.path ?? '';
  if (/\{[^}]+\}/.test(path)) throw new Error('O endpoint de teste contém um identificador pendente. Cadastre um GET fixo para testar a conexão.');
  return path;
}
