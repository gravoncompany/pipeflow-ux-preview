import { getPortalAccount } from "./gravon-portal-admin.server";
import { requireCrmLeadSession } from "./crm-leads.server";
import { assertCrmAdmin } from "./crm-leads-access";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { phoneDigits } from "./phone";
import { adminAccessProblem, crmChannels, type AdminAccessReason } from "./crm-agent-access";

export type AgentChannel = { instance: string; phone: string };
// Generated types predate migrations 0083/0084; the server validates every value read through this handle.
export type AdminDb = { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: any; error: { message: string; code?: string } | null }>; from: (table: string) => any };

export class CrmAdminAccessError extends Error {
  constructor(public reason: AdminAccessReason, message: string) { super(message); this.name = "CrmAdminAccessError"; }
}

/**
 * Reuses the existing boundaries: the CRM full-session cookie (same check as Pipeline/B2B/Campaigns)
 * plus the verified individual admin account (same check as /auth). Each missing piece has its own
 * reason so the page can ask only for what is missing.
 */
export async function crmAdmin() {
  let level: "full" | "limited" | null = null;
  try { level = await requireCrmLeadSession(process.env.CRM_SESSION_SECRET); assertCrmAdmin(level); } catch { level = level === "full" ? level : null; }
  const account = level === "full" ? await getPortalAccount() : null;
  const problem = adminAccessProblem(level, account);
  if (problem || !account) throw new CrmAdminAccessError(problem?.reason ?? "admin_account", problem?.message ?? "Conta administrativa necessária.");
  return { userId: account.userId, db: supabaseAdmin as unknown as AdminDb };
}

/** Commercial Agent: also lists the admin's own WhatsApp channels of this CRM (crm:1); other companies' channels are ignored. */
export async function crmAgentAdmin() {
  const admin = await crmAdmin();
  const { data, error } = await supabaseAdmin.from("portal_admin_channels").select("instance,canonical_phone,company_key").eq("user_id", admin.userId);
  if (error) throw new Error("Não foi possível verificar seus canais autorizados.");
  const channels: AgentChannel[] = crmChannels(data ?? [], phoneDigits);
  return { ...admin, channels };
}

/** Server-function helper: access problems become a typed result instead of a generic failure. */
export async function withAdminAccess<T>(work: () => Promise<T>) {
  try { return { authorized: true as const, ...(await work()) }; }
  catch (error) {
    if (error instanceof CrmAdminAccessError) return { authorized: false as const, reason: error.reason, error: error.message };
    throw error;
  }
}
