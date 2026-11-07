/** Why an admin-only CRM settings read was refused; the UI asks only for the missing piece. */
export type AdminAccessReason = "crm_session" | "admin_account";

/** /auth?redirect= only returns to internal CRM paths (no protocol-relative or external URLs). */
export function safeReturnPath(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 200) return undefined;
  if (!/^\/[A-Za-z0-9/_-]*$/.test(value) || value.startsWith("//")) return undefined;
  return value;
}

/** PostgREST/Postgres codes for a table, column or RPC that does not exist yet (migration not applied). */
const MISSING_SCHEMA = new Set(["PGRST205", "PGRST202", "42P01", "42883", "42703"]);
export function isMissingSchema(error: { code?: string | null; message?: string | null } | null | undefined) {
  if (!error) return false;
  if (error.code && MISSING_SCHEMA.has(error.code)) return true;
  return /could not find the (table|function)|schema cache|does not exist/i.test(error.message ?? "");
}
export const MIGRATIONS_PENDING = "O banco ainda não tem as migrações 0083/0084 (Mensagens de Referência e Agente Comercial). Peça ao Lovable para aplicá-las; nenhum dado foi alterado.";

/** Pure decision used by crmAdmin: which piece of access is missing, if any. */
export function adminAccessProblem(sessionLevel: "full" | "limited" | null, account: { authorized: boolean } | null): { reason: AdminAccessReason; message: string } | null {
  if (sessionLevel !== "full") return { reason: "crm_session", message: "Entre com a senha de acesso completo do CRM para continuar." };
  if (!account) return { reason: "admin_account", message: "Entre com sua conta administrativa individual para continuar." };
  if (!account.authorized) return { reason: "admin_account", message: "Sua conta está conectada, mas a permissão administrativa ainda não foi liberada." };
  return null;
}

/** Only this CRM's (crm:1) channels are offered to the agent; other companies' channels are ignored, never blocking. */
export function crmChannels(rows: { instance: string; canonical_phone: string; company_key: string }[], digits: (p: string) => string) {
  const out: { instance: string; phone: string }[] = [];
  for (const c of rows) if (c.company_key === "crm:1" && !out.some((x) => x.instance === c.instance)) out.push({ instance: c.instance, phone: digits(c.canonical_phone) });
  return out;
}
