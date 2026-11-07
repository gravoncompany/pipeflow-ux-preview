import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  closingDate,
  countNewCustomers,
  dateKey,
  decideFirstAcquisition,
  inPeriod,
  pipelineKey,
  saleTypeSchema,
  type ClosingRow,
  type SaleReview,
  type SaleType,
} from "./sale-classifications";

const COMPANY = "crm:1";

async function admin() {
  const secret = process.env.CRM_SESSION_SECRET;
  const { hasFullCrmSession } = await import("./crm-session.server");
  if (!secret || !(await hasFullCrmSession(secret)))
    throw new Error("Entre com acesso completo para revisar as vendas.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

type Db = Awaited<ReturnType<typeof admin>>;
type LeadRow = {
  id: string;
  name: string;
  company: string;
  whatsapp: string;
  entry_date: string;
  closed_at: string | null;
  potential_value: number;
};
type ClassRow = {
  lead_id: string;
  customer_key: string;
  sale_type: SaleType;
  first_acquisition: boolean;
  closed_on: string;
  classified_by: string;
  updated_by: string;
  updated_at: string;
  revision: number;
};

async function closedLeads(db: Db, pipeline: string): Promise<LeadRow[]> {
  const base = db
    .from("leads")
    .select("id,name,company,whatsapp,entry_date,closed_at,potential_value")
    .eq("stage", "fechado");
  const q = pipeline === "main" ? base.is("pipeline_id", null) : base.eq("pipeline_id", pipeline);
  const { data, error } = await q;
  if (error) throw new Error("Não foi possível ler os fechamentos do CRM.");
  return (data ?? []) as LeadRow[];
}

async function classificationsFor(db: Db, leadIds: string[]): Promise<ClassRow[]> {
  if (!leadIds.length) return [];
  const { data, error } = await db
    .from("sale_classifications")
    .select(
      "lead_id,customer_key,sale_type,first_acquisition,closed_on,classified_by,updated_by,updated_at,revision",
    )
    .eq("company_key", COMPANY)
    .in("lead_id", leadIds);
  if (error) throw new Error("Não foi possível ler as classificações.");
  return (data ?? []) as ClassRow[];
}

function buildReview(leads: LeadRow[], classes: ClassRow[], from: string, to: string): SaleReview {
  const byLead = new Map(classes.map((c) => [c.lead_id, c]));
  const closings: ClosingRow[] = leads
    .map((l) => {
      const { date, basis } = closingDate(l);
      const c = byLead.get(l.id);
      return {
        leadId: l.id,
        name: l.name,
        company: l.company,
        customerKey: c?.customer_key ?? "",
        entryDate: l.entry_date,
        closedAt: l.closed_at,
        dateBasis: basis,
        potentialValue: Number(l.potential_value) || 0,
        saleType: c?.sale_type ?? null,
        firstAcquisition: c?.first_acquisition ?? null,
        closedOn: c?.closed_on ?? null,
        classifiedBy: c?.classified_by ?? null,
        updatedBy: c?.updated_by ?? null,
        updatedAt: c?.updated_at ?? null,
        revision: c?.revision ?? null,
      } satisfies ClosingRow;
    })
    .filter((r) => inPeriod(r.closedAt ?? r.entryDate, from, to))
    .sort((a, b) => (b.closedAt ?? b.entryDate).localeCompare(a.closedAt ?? a.entryDate));
  const counted = classes.map((c) => ({
    customerKey: c.customer_key,
    saleType: c.sale_type,
    firstAcquisition: c.first_acquisition,
    closedOn: c.closed_on,
  }));
  return {
    closings,
    pending: closings.filter((c) => c.saleType === null).length,
    newCustomers: countNewCustomers(counted, from, to),
  };
}

const rangeInput = z.object({ from: dateKey, to: dateKey, pipeline: pipelineKey });

export const getSaleReview = createServerFn({ method: "POST" })
  .inputValidator((i) => rangeInput.parse(i))
  .handler(async ({ data }) => {
    if (data.from > data.to) throw new Error("Período inválido.");
    const db = await admin();
    const leads = await closedLeads(db, data.pipeline);
    const classes = await classificationsFor(
      db,
      leads.map((l) => l.id),
    );
    return buildReview(leads, classes, data.from, data.to);
  });

const classifyInput = z.object({
  leadId: z.string().uuid(),
  saleType: saleTypeSchema,
  closedOn: dateKey,
  confirmedAfterWarning: z.boolean(),
  updatedBy: z.string().trim().min(1, "Informe quem está classificando.").max(80),
  expectedRevision: z.number().int().positive().nullable(),
  // Optional period context: when present, the fresh review summary is returned.
  from: dateKey.optional(),
  to: dateKey.optional(),
  pipeline: pipelineKey.optional(),
});

export type ClassifyResult =
  | { ok: true; firstAcquisition: boolean; review: SaleReview | null }
  | { ok: false; conflict: true; priorClosedOn: string; priorLeadName: string };

export const classifySale = createServerFn({ method: "POST" })
  .inputValidator((i) => classifyInput.parse(i))
  .handler(async ({ data }): Promise<ClassifyResult> => {
    if (data.from && data.to && data.from > data.to) throw new Error("Período inválido.");
    const today = new Date().toISOString().slice(0, 10);
    if (data.closedOn > today) throw new Error("A data de fechamento não pode estar no futuro.");
    const db = await admin();

    const { data: lead, error: le } = await db
      .from("leads")
      .select("id,name,company,whatsapp,entry_date,closed_at,potential_value,stage")
      .eq("id", data.leadId)
      .maybeSingle();
    if (le || !lead) throw new Error("Oportunidade não encontrada.");
    if (lead.stage !== "fechado")
      throw new Error("Só é possível classificar oportunidades na etapa Fechado.");

    const { phoneKey } = await import("./phone");
    const customerKey = phoneKey(lead.whatsapp);
    if (customerKey.length < 8)
      throw new Error("O WhatsApp do lead é inválido para vincular o cliente. Corrija a ficha antes de classificar.");

    const { data: existing, error: ee } = await db
      .from("sale_classifications")
      .select("id,revision")
      .eq("lead_id", data.leadId)
      .maybeSingle();
    if (ee) throw new Error("Não foi possível ler a classificação atual.");
    if (!existing && data.expectedRevision !== null)
      throw new Error("A classificação foi removida em outro lugar. Recarregue antes de salvar.");
    if (existing && data.expectedRevision !== existing.revision)
      throw new Error("A classificação foi alterada em outro lugar. Recarregue antes de salvar.");

    // Prior confirmed first acquisition for the same customer, in any funnel.
    const { data: priors, error: pe } = await db
      .from("sale_classifications")
      .select("lead_id,closed_on")
      .eq("company_key", COMPANY)
      .eq("customer_key", customerKey)
      .eq("sale_type", "novo")
      .eq("first_acquisition", true)
      .neq("lead_id", data.leadId)
      .order("closed_on")
      .limit(1);
    if (pe) throw new Error("Não foi possível verificar aquisições anteriores.");
    const prior = (priors ?? [])[0] ?? null;

    const decision = decideFirstAcquisition(
      data.saleType,
      prior ? 1 : 0,
      data.confirmedAfterWarning,
    );
    if (decision.conflict) {
      const { data: priorLead } = await db
        .from("leads")
        .select("name")
        .eq("id", prior!.lead_id)
        .maybeSingle();
      return {
        ok: false,
        conflict: true,
        priorClosedOn: prior!.closed_on,
        priorLeadName: priorLead?.name ?? "outra oportunidade",
      };
    }

    const values = {
      customer_key: customerKey,
      sale_type: data.saleType,
      first_acquisition: decision.firstAcquisition,
      closed_on: data.closedOn,
      updated_by: data.updatedBy,
    };
    if (existing) {
      const { error: ue } = await db
        .from("sale_classifications")
        .update({ ...values, revision: existing.revision + 1 })
        .eq("id", existing.id)
        .eq("revision", existing.revision);
      if (ue) throw new Error("Não foi possível salvar a classificação.");
    } else {
      const { error: ie } = await db.from("sale_classifications").insert({
        ...values,
        company_key: COMPANY,
        lead_id: data.leadId,
        classified_by: data.updatedBy,
      });
      if (ie?.code === "23505")
        throw new Error("Esta oportunidade já foi classificada. Recarregue antes de salvar.");
      if (ie) throw new Error("Não foi possível salvar a classificação.");
    }

    let review: SaleReview | null = null;
    if (data.from && data.to && data.pipeline) {
      const leads = await closedLeads(db, data.pipeline);
      const classes = await classificationsFor(
        db,
        leads.map((l) => l.id),
      );
      review = buildReview(leads, classes, data.from, data.to);
    }
    return { ok: true, firstAcquisition: decision.firstAcquisition, review };
  });
