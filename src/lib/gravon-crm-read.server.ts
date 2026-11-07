import { tool } from "ai";
import {
  crmCountInput,
  crmLookupInput,
  validateCountInput,
  validateLookupInput,
  knownStageTitle,
  type CrmReadGrant,
  type CrmCountInput,
  type CrmLookupInput,
} from "./gravon-crm-read";
import {
  funnelInput,
  financeInput,
  validateFunnelInput,
  validateFinanceInput,
  financeProjection,
  type FinanceGrant,
  type FinanceInput,
  type FunnelInput,
} from "./gravon-financial-read";
import { funnelMetrics } from "./funnel-metrics";
import type { FinanceResponse } from "./finance.server";
import { z } from "zod";

const countsSchema = z.object({
  total: z.number().int().nonnegative(),
  stages: z.array(z.object({ stage: z.string(), count: z.number().int().nonnegative() })),
});
const salesSchema = z.object({
  count: z.number().int().nonnegative(),
  potentialValue: z.number().finite(),
  missing: z.number().int().nonnegative(),
});

export type CrmReadDependencies = {
  authorize: () => Promise<void>;
  count: (input: CrmCountInput) => Promise<unknown>;
  lookup: (input: CrmLookupInput) => Promise<unknown>;
  financial?: {
    authorize: () => Promise<void>;
    finance: (input: FinanceInput) => Promise<FinanceResponse>;
    sales: (input: FunnelInput) => Promise<unknown>;
    closedValue: (input: CrmLookupInput) => Promise<unknown>;
  };
};

export function createCrmReadTools(deps: CrmReadDependencies) {
  let calls = 0;
  let failed = false;
  const guard = async () => {
    if (failed || ++calls > 4) throw new Error("Limite de consultas atingido.");
    await deps.authorize();
  };
  const run = async (query: () => Promise<unknown>) => {
    try {
      await guard();
      return await query();
    } catch {
      failed = true;
      throw new Error("Consulta indisponível; não use valores presumidos.");
    }
  };
  return {
    tools: {
      countLeads: tool({
        description:
          "Conta leads, total e por etapa. stage é ID conhecido ou null para todas; datas YYYY-MM-DD ou null, período pela data de entrada. Não lê registros individuais.",
        inputSchema: crmCountInput,
        execute: (raw) =>
          run(async () => {
            const result = await deps.count(validateCountInput(raw));
            if (
              !result ||
              typeof result !== "object" ||
              !("total" in result) ||
              !("stages" in result) ||
              typeof result.total !== "number" ||
              !Array.isArray(result.stages)
            )
              throw new Error("Invalid count result");
            return {
              total: result.total,
              stages: result.stages.map((row: unknown) => {
                if (
                  !row ||
                  typeof row !== "object" ||
                  !("stage" in row) ||
                  !("count" in row) ||
                  typeof row.stage !== "string" ||
                  typeof row.count !== "number"
                )
                  throw new Error("Invalid stage result");
                return { stage: knownStageTitle(row.stage), count: row.count };
              }),
            };
          }),
      }),
      lookupLead: tool({
        description:
          "Busca EXATA por name, company, phone ou id. Somente campos permitidos. Havendo homônimos, pedir identificação com o id; não escolher por suposição. Nunca lista toda a base.",
        inputSchema: crmLookupInput,
        execute: (raw) =>
          run(async () => {
            const result = await deps.lookup(validateLookupInput(raw));
            if (
              !result ||
              typeof result !== "object" ||
              !("leads" in result) ||
              !Array.isArray(result.leads) ||
              !("ambiguous" in result) ||
              typeof result.ambiguous !== "boolean" ||
              !("hasMore" in result) ||
              typeof result.hasMore !== "boolean"
            )
              throw new Error("Invalid lookup result");
            if (!result.ambiguous && result.leads.length > 1)
              throw new Error("Ambiguous lead result");
            const ambiguous = result.ambiguous === true;
            return {
              ambiguous,
              hasMore: "hasMore" in result && result.hasMore === true,
              leads: result.leads.slice(0, 5).map((row: unknown) => {
                if (!row || typeof row !== "object") throw new Error("Invalid lead result");
                const lead = row as Record<string, unknown>;
                if (["id", "name", "company"].some((key) => typeof lead[key] !== "string"))
                  throw new Error("Invalid lead identity");
                const text = (key: string, limit = 160) =>
                  typeof lead[key] === "string" && lead[key].trim()
                    ? lead[key].slice(0, limit)
                    : "não cadastrado";
                const base = {
                  id: text("id"),
                  name: text("name", 120),
                  company: text("company", 120),
                };
                return ambiguous
                  ? base
                  : {
                      ...base,
                      stage: knownStageTitle(text("stage")),
                      service: text("service"),
                      source: text("source"),
                      nextAction: text("nextAction", 200),
                      nextActionDate: text("nextActionDate"),
                    };
              }),
            };
          }),
      }),
      funnelSummary: tool({
        description:
          "Conversão de leads com entrada entre datas ISO explícitas inclusivas, usando etapas ATUAIS, não histórico nem data de fechamento. Não inclui valores financeiros. Peça datas se não estiverem claras.",
        inputSchema: funnelInput,
        execute: (raw) =>
          run(async () => {
            const input = validateFunnelInput(raw);
            const counts = countsSchema.parse(await deps.count({ stage: null, ...input }));
            if (counts.stages.reduce((sum, row) => sum + row.count, 0) !== counts.total)
              throw new Error("Invalid cohort");
            return {
              ...input,
              basis: "data de entrada, etapas atuais; não histórico de transições",
              total: counts.total,
              steps: funnelMetrics(counts.total, counts.stages).map((s) => ({
                label: s.label,
                count: s.count,
                ofTotal: s.hasTotalBase ? s.ofTotal : null,
                ofPrevious: s.hasPreviousBase ? s.ofPrev : null,
              })),
            };
          }),
      }),
      ...(deps.financial
        ? {
            monthlyFinance: tool({
              description:
                "Receita e investimento em tráfego mensais da planilha Financeiro, somente 2026, meses 1..12 inclusivos. Não é faturamento do cliente nem valor potencial. Não rateie por dia; valores ausentes não são zero, total parcial não é total completo.",
              inputSchema: financeInput,
              execute: (raw) =>
                run(async () => {
                  const input = validateFinanceInput(raw);
                  const financial = deps.financial;
                  if (!financial) throw new Error("Financial permission missing");
                  await financial.authorize();
                  const result = await financial.finance(input);
                  if (result.error || result.needsAuth || !result.updatedAt)
                    throw new Error("Finance unavailable");
                  return {
                    ...input,
                    source: "Financeiro · planilha 2026",
                    currency: "BRL",
                    updatedAt: result.updatedAt,
                    revenue: financeProjection(result.months, input),
                    traffic: financeProjection(result.traffic, input),
                  };
                }),
            }),
            salesSummary: tool({
              description:
                "Quantidade de fechados, soma do VALOR POTENCIAL cadastrado e quantidade sem valor, entre datas de ENTRADA inclusivas. Não é pagamento recebido nem vendas pela data de fechamento.",
              inputSchema: funnelInput,
              execute: (raw) =>
                run(async () => {
                  const input = validateFunnelInput(raw);
                  const financial = deps.financial;
                  if (!financial) throw new Error("Financial permission missing");
                  await financial.authorize();
                  const result = salesSchema.parse(await financial.sales(input));
                  if (result.missing > result.count) throw new Error("Invalid missing count");
                  return {
                    ...input,
                    source: "CRM · valor potencial de fechados por data de entrada",
                    currency: "BRL",
                    ...result,
                    complete: result.missing === 0,
                  };
                }),
            }),
            closedLeadValue: tool({
              description:
                "Valor POTENCIAL de um lead fechado identificado exatamente por name/company/phone/id. Nunca escolher homônimos, nem tratar potencial como receita recebida. Não lista toda a base.",
              inputSchema: crmLookupInput,
              execute: (raw) =>
                run(async () => {
                  const input = validateLookupInput(raw);
                  const financial = deps.financial;
                  if (!financial) throw new Error("Financial permission missing");
                  await financial.authorize();
                  const result = z
                    .object({
                      ambiguous: z.boolean(),
                      hasMore: z.boolean(),
                      leads: z.array(
                        z.object({
                          id: z.string(),
                          name: z.string(),
                          company: z.string(),
                          closed: z.boolean().optional(),
                          potentialValue: z.number().finite().nullable().optional(),
                        }),
                      ),
                    })
                    .parse(await financial.closedValue(input));
                  if (!result.ambiguous && result.leads.length > 1)
                    throw new Error("Ambiguous value");
                  if (
                    !result.ambiguous &&
                    result.leads.some(
                      (lead) =>
                        typeof lead.closed !== "boolean" || lead.potentialValue === undefined,
                    )
                  )
                    throw new Error("Invalid value");
                  return {
                    ambiguous: result.ambiguous,
                    hasMore: result.hasMore,
                    source: "CRM · valor potencial, não pagamento recebido",
                    currency: "BRL",
                    leads: result.leads
                      .slice(0, 5)
                      .map((lead) => ({
                        id: lead.id,
                        name: lead.name.slice(0, 120),
                        company: lead.company.slice(0, 120),
                        ...(!result.ambiguous
                          ? { closed: lead.closed, potentialValue: lead.potentialValue }
                          : {}),
                      })),
                  };
                }),
            }),
          }
        : {}),
    },
    assertSuccessful: () => {
      if (failed) throw new Error("Consulta indisponível.");
    },
  };
}

export async function createDatabaseReadTools(
  grant: CrmReadGrant,
  authorize: () => Promise<void>,
  financeGrant: FinanceGrant | null = null,
  authorizeFinance?: () => Promise<void>,
) {
  // A channel grant is verified before privileged read RPC access; no generic table queries.
  await authorize();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const identity = { p_instance: grant.instance, p_phone: grant.phone, p_revision: grant.revision };
  const financial =
    financeGrant && authorizeFinance
      ? {
          authorize: async () => {
            await authorizeFinance();
            const { error } = await supabaseAdmin.rpc("gravon_require_finance_grant", {
              ...identity,
              p_finance_revision: financeGrant.revision,
            });
            if (error) throw new Error("Autorização financeira indisponível.");
          },
          finance: async () => {
            const { readFinance } = await import("./finance.server");
            return readFinance();
          },
          sales: async (input: FunnelInput) => {
            const { data, error } = await supabaseAdmin.rpc("gravon_sales_summary", {
              ...identity,
              p_finance_revision: financeGrant.revision,
              p_start: input.startDate,
              p_end: input.endDate,
            });
            if (error) throw new Error("Vendas indisponíveis.");
            return data;
          },
          closedValue: async (input: CrmLookupInput) => {
            const { data, error } = await supabaseAdmin.rpc("gravon_closed_value", {
              ...identity,
              p_finance_revision: financeGrant.revision,
              p_field: input.field,
              p_query: input.query,
            });
            if (error) throw new Error("Valor indisponível.");
            return data;
          },
        }
      : undefined;
  return createCrmReadTools({
    authorize,
    financial,
    count: async (input) => {
      // Omit absent filters explicitly: generated RPC types encode DEFAULT NULL as optional.
      const filters = {
        ...(input.stage !== null ? { p_stage: input.stage } : {}),
        ...(input.startDate !== null ? { p_start: input.startDate } : {}),
        ...(input.endDate !== null ? { p_end: input.endDate } : {}),
      };
      const { data, error } = await supabaseAdmin.rpc("gravon_count_leads", {
        ...identity,
        ...filters,
      });
      if (error) throw new Error("Consulta indisponível.");
      return data;
    },
    lookup: async (input) => {
      const { data, error } = await supabaseAdmin.rpc("gravon_lookup_lead", {
        ...identity,
        p_field: input.field,
        p_query: input.query,
      });
      if (error) throw new Error("Consulta indisponível.");
      return data;
    },
  });
}
