import { createServerFn } from "@tanstack/react-start";
import { interactionSchema, manualEntry } from "./lead-interactions";
import type { HistoryEntry } from "./crm-types";

export const saveLeadInteraction = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => interactionSchema.parse(input))
  .handler(async ({ data }): Promise<{ ok: boolean; history?: HistoryEntry[]; error?: string }> => {
    const secret = process.env.CRM_SESSION_SECRET;
    const { hasFullCrmSession } = await import("./crm-session.server");
    if (!secret || !(await hasFullCrmSession(secret))) return { ok: false, error: "Entre com o acesso completo para registrar a interação." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await supabaseAdmin.rpc("persist_lead_interaction", { p_lead: data.leadId, p_entry: JSON.parse(JSON.stringify(manualEntry(data))), p_company: "crm:1" });
    if (error) {
      console.error("lead_interaction_save_failed", { code: error.code });
      return { ok: false, error: "Não foi possível salvar a interação. Seus dados foram mantidos; tente novamente." };
    }
    const saved = result as { ok?: boolean; history?: HistoryEntry[] } | null;
    if (saved?.ok !== true || !Array.isArray(saved.history) || !saved.history.some(h => h.id === data.id)) return { ok: false, error: "Gravação não confirmada. Seus dados foram mantidos." };
    return { ok: true, history: saved.history };
  });