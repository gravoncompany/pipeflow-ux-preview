import { hasFullCrmSession } from "./crm-session.server";
import { internalKnowledgeActor } from "./commercial-knowledge.server";

/** Same gate as HyperCash: full CRM session + verified administrative account. */
export async function integrationsAdmin(scope: string) {
  const secret = process.env["CRM_SESSION_SECRET"];
  if (!secret || !(await hasFullCrmSession(secret))) throw new Error("Entre com a senha de acesso completo do CRM.");
  const actor = await internalKnowledgeActor(`integrations:${scope}`, "menu");
  if (!actor || actor.company !== "crm:1") throw new Error("Entre com sua conta administrativa para configurar integrações.");
  await actor.authorize().catch(() => { throw new Error("Sua conta não tem permissão de administrador."); });
  return actor;
}
export async function integrationsDb() { return (await import("@/integrations/supabase/client.server")).supabaseAdmin; }
