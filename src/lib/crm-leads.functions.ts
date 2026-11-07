import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { assertCrmAdmin, assertCrmLeadWrite, crmLeadId, crmLeadInput, zapierDestination } from "./crm-leads-access";
import { TEAM_STAGE_IDS } from "./crm-permissions";
import { leadToRow, rowToLead } from "./lead-mapper";

export const listCrmLeads = createServerFn({ method: "GET" }).handler(async () => {
  const { requireCrmLeadSession } = await import("./crm-leads.server");
  const level = await requireCrmLeadSession(process.env.CRM_SESSION_SECRET);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const rows = [];
  // Explicit pages avoid silently truncating the CRM at the Data API row limit.
  for (let offset = 0; ; offset += 500) {
    let query = supabaseAdmin.from("leads").select("*").order("created_at", { ascending: false }).order("id").range(offset, offset + 499);
    if (level === "limited") query = query.in("stage", [...TEAM_STAGE_IDS]).is("pipeline_id", null);
    const { data, error } = await query;
    if (error) throw new Error("Não foi possível carregar os leads.");
    rows.push(...(data ?? []));
    if (!data || data.length < 500) break;
  }
  return rows.map(rowToLead);
});

export const saveCrmLead = createServerFn({ method: "POST" })
  .inputValidator(input => z.object({ lead: crmLeadInput, isNew: z.boolean().optional() }).strict().parse(input))
  .handler(async ({ data }) => {
    const { requireCrmLeadSession } = await import("./crm-leads.server");
    const level = await requireCrmLeadSession(process.env.CRM_SESSION_SECRET);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: old, error: readError } = await supabaseAdmin.from("leads").select("stage,pipeline_id").eq("id", data.lead.id).maybeSingle();
    if (readError) throw new Error("Não foi possível verificar o lead.");
    assertCrmLeadWrite(level, old, data.lead);
    const row = leadToRow(data.lead);
    let write;
    if (old) {
      const query = supabaseAdmin.from("leads").update(row).eq("id", data.lead.id).eq("stage", old.stage);
      write = old.pipeline_id === null ? query.is("pipeline_id", null) : query.eq("pipeline_id", old.pipeline_id);
    } else write = supabaseAdmin.from("leads").insert(row);
    const { data: saved, error } = await write.select("id").maybeSingle();
    if (error || !saved) throw new Error(error?.code === "40001" ? "O lead mudou pelo WhatsApp. Reabra a ficha antes de salvar." : "Não foi possível salvar; reabra a ficha e tente novamente.");
    if (!old && data.isNew) {
      const { data: settings } = await supabaseAdmin.from("crm_settings").select("zapier_webhook_url").eq("id", 1).maybeSingle();
      const url = zapierDestination.safeParse(settings?.zapier_webhook_url ?? "");
      if (url.success && url.data) {
        const { fetchWithoutRedirects } = await import("./no-redirect-fetch.server");
        try { await fetchWithoutRedirects(url.data, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "lead.created", timestamp: new Date().toISOString(), lead: data.lead }), signal: AbortSignal.timeout(10000) }); }
        catch { console.error("crm_outbound_notification_failed"); }
      }
    }
    return { ok: true };
  });

export const moveCrmLead = createServerFn({ method: "POST" })
  .inputValidator(input => z.object({ id: crmLeadId, stage: z.string().min(1).max(100) }).strict().parse(input))
  .handler(async ({ data }) => {
    const { requireCrmLeadSession } = await import("./crm-leads.server");
    const level = await requireCrmLeadSession(process.env.CRM_SESSION_SECRET);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: old, error: readError } = await supabaseAdmin.from("leads").select("stage,pipeline_id").eq("id", data.id).maybeSingle();
    if (readError || !old) throw new Error("Lead indisponível.");
    assertCrmLeadWrite(level, old, { stage: data.stage, pipelineId: old.pipeline_id });
    let query = supabaseAdmin.from("leads").update({ stage: data.stage }).eq("id", data.id).eq("stage", old.stage);
    if (level === "limited") query = query.is("pipeline_id", null);
    const { data: saved, error } = await query.select("id").maybeSingle();
    if (error || !saved) throw new Error("Não foi possível mover o lead. Reabra a ficha.");
    return { ok: true };
  });

export const deleteCrmLeads = createServerFn({ method: "POST" })
  .inputValidator(input => z.object({ ids: z.array(crmLeadId).min(1).max(1000) }).strict().parse(input))
  .handler(async ({ data }) => {
    const { requireCrmLeadSession } = await import("./crm-leads.server");
    assertCrmAdmin(await requireCrmLeadSession(process.env.CRM_SESSION_SECRET));
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("leads").delete().in("id", data.ids);
    if (error) throw new Error("Não foi possível excluir os leads.");
    return { ok: true };
  });

export const getCrmZapierSetting = createServerFn({ method: "GET" }).handler(async () => {
  const { requireCrmLeadSession } = await import("./crm-leads.server");
  const level = await requireCrmLeadSession(process.env.CRM_SESSION_SECRET);
  if (level !== "full") return "";
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.from("crm_settings").select("zapier_webhook_url").eq("id", 1).maybeSingle();
  if (error) throw new Error("Não foi possível carregar a configuração.");
  return data?.zapier_webhook_url ?? "";
});

export const saveCrmZapierSetting = createServerFn({ method: "POST" })
  .inputValidator(input => z.object({ url: zapierDestination }).strict().parse(input))
  .handler(async ({ data }) => {
    const { requireCrmLeadSession } = await import("./crm-leads.server");
    assertCrmAdmin(await requireCrmLeadSession(process.env.CRM_SESSION_SECRET));
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("crm_settings").upsert({ id: 1, zapier_webhook_url: data.url, updated_at: new Date().toISOString() });
    if (error) throw new Error("Não foi possível salvar a configuração.");
    return { ok: true };
  });
// Movimentação em massa (até 40 por chamada; a interface envia em lotes). Cada card é atualizado em uma única
// instrução atômica — etapa, funil e uma entrada nova no histórico — condicionada ao estado lido (etapa, funil e
// revisão). Se o card mudou nesse meio-tempo ou a regra de acesso não permite, ele fica como estava e o motivo é
// devolvido. Dados, contatos, etiquetas e históricos anteriores são preservados. "fechado" exige a classificação de
// venda feita no próprio card, por isso não é aceito em massa.
const bulkMoveInput = z.object({
  ids: z.array(crmLeadId).min(1).max(40),
  pipelineId: z.string().uuid().nullable(),
  stage: z.string().min(1).max(100),
  stageTitle: z.string().trim().min(1).max(80),
  pipelineName: z.string().trim().min(1).max(80),
}).strict();
export type { BulkMoveResult } from "./crm-bulk-move";
export const bulkMoveCrmLeads = createServerFn({ method: "POST" })
  .inputValidator(input => bulkMoveInput.parse(input))
  .handler(async ({ data }) => {
    const { requireCrmLeadSession } = await import("./crm-leads.server");
    const level = await requireCrmLeadSession(process.env.CRM_SESSION_SECRET);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runBulkMove } = await import("./crm-bulk-move");
    return runBulkMove({
      pipelineStages: async (id) => {
        const { data: p, error } = await supabaseAdmin.from("sales_pipelines").select("name,stages").eq("id", id).eq("archived", false).maybeSingle();
        if (error || !p) return null;
        const stages = z.array(z.object({ id: z.string(), title: z.string() })).safeParse(p.stages);
        return stages.success ? { name: p.name, stages: stages.data } : null;
      },
      readLeads: async (ids) => {
        const { data: rows, error } = await supabaseAdmin.from("leads").select("id,stage,pipeline_id,history,gravon_change_revision").in("id", ids);
        if (error) throw new Error("Não foi possível ler os cards selecionados.");
        return rows ?? [];
      },
      updateLead: async (old, patch) => {
        let query = supabaseAdmin.from("leads").update(patch as never).eq("id", old.id).eq("stage", old.stage).eq("gravon_change_revision", old.gravon_change_revision);
        query = old.pipeline_id === null ? query.is("pipeline_id", null) : query.eq("pipeline_id", old.pipeline_id);
        const { data: saved, error } = await query.select("id").maybeSingle();
        return !error && Boolean(saved);
      },
    }, level, data);
  });

// Valor fechado: confirmado só com acesso completo e só para cards na etapa Fechado. É gravado à parte do card
// (o salvamento normal do card nunca altera esse valor) e registrado no histórico. Recebimento segue no Financeiro.
export const confirmLeadClosedValue = createServerFn({ method: "POST" })
  .inputValidator(input => z.object({ id: crmLeadId, value: z.number().finite().min(0).max(1_000_000_000) }).strict().parse(input))
  .handler(async ({ data }) => {
    const { requireCrmLeadSession } = await import("./crm-leads.server");
    assertCrmAdmin(await requireCrmLeadSession(process.env.CRM_SESSION_SECRET));
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await supabaseAdmin.rpc("confirm_lead_closed_value", { p_actor: "Gestor comercial", p_lead: data.id, p_value: data.value });
    if (error) {
      if (error.message?.includes("not_closed")) throw new Error("O valor fechado só pode ser confirmado em cards na etapa Fechado.");
      if (error.message?.includes("lead_unavailable")) throw new Error("Lead indisponível.");
      throw new Error("Não foi possível confirmar o valor fechado.");
    }
    return result as { closedValue: number; confirmedAt: string };
  });
