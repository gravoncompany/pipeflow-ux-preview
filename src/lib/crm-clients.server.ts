// Somente servidor: portão de sessão e ator do módulo Contatos/Clientes.

export const CLIENTS_ACTOR = "Gestor comercial";

export async function requireClientsSession() {
  const { requireCrmLeadSession } = await import("./crm-leads.server");
  const level = await requireCrmLeadSession(process.env.CRM_SESSION_SECRET);
  if (level !== "full") throw new Error("A gestão de clientes exige o acesso completo.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}
