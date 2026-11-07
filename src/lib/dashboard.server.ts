// Dashboard Geral data loader. Callers MUST have verified a full CRM session first (dashboard.functions.ts).
// scope.companyKey keeps every read ready for a future per-company dashboard; today only the original CRM (crm:1) exists.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  commercialMetrics, financialMetrics, fullMonths, inRange, isContacted, isQualified, originGroup, isPaidOrigin,
  ok, unavailable, integration, type DashLead, type FinanceInputs, type Metric,
} from "./dashboard";
import { FINANCE_YEAR } from "./finance";

export type DashScope = { companyKey: "crm:1" };
export type DatedValue = { date: string; value: number };
export type MonthlyValue = { month: string; value: number };

export type DashboardData = Awaited<ReturnType<typeof loadDashboard>>;

async function all<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset < 20000; offset += 1000) {
    const { data, error } = await build(offset, offset + 999);
    if (error) throw new Error("Não foi possível carregar os dados do Dashboard.");
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) return rows;
  }
  return rows;
}

export async function loadDashboard(scope: DashScope, from: string, to: string) {
  const db = supabaseAdmin;
  const [leadRows, pipes, classes, b2b, deliveries, analyses, runs, messages] = await Promise.all([
    all<any>((a, b) => db.from("leads").select("id,entry_date,stage,pipeline_id,closed_at,source,utm_source,utm_medium,tags").order("id").range(a, b)),
    db.from("sales_pipelines").select("id,name").eq("archived", false),
    all<any>((a, b) => db.from("sale_classifications").select("lead_id,customer_key,sale_type,first_acquisition,closed_on").eq("company_key", scope.companyKey).order("id").range(a, b)),
    all<any>((a, b) => db.from("b2b_companies").select("created_at").gte("created_at", `${from}T00:00:00-03:00`).lte("created_at", `${to}T23:59:59-03:00`).order("id").range(a, b)),
    all<any>((a, b) => db.from("crm_campaign_deliveries").select("state,created_at").gte("created_at", `${from}T00:00:00-03:00`).lte("created_at", `${to}T23:59:59-03:00`).order("id").range(a, b)),
    all<any>((a, b) => db.from("whatsapp_analyses").select("analyzed_at,result").gte("analyzed_at", `${from}T00:00:00-03:00`).lte("analyzed_at", `${to}T23:59:59-03:00`).order("id").range(a, b)),
    all<any>((a, b) => db.from("crm_agent_runs").select("status,created_at").gte("created_at", `${from}T00:00:00-03:00`).lte("created_at", `${to}T23:59:59-03:00`).order("id").range(a, b)),
    db.from("whatsapp_messages").select("phone_key,from_me,sent_at").order("sent_at", { ascending: false }).limit(5000),
  ]);
  if (pipes.error || messages.error) throw new Error("Não foi possível carregar os dados do Dashboard.");
  const pipelines = [{ id: null as string | null, name: "Funil principal" }, ...((pipes.data ?? []) as { id: string; name: string }[])];
  const outboundId = pipelines.find((p) => p.name.trim().toLowerCase() === "outbound")?.id ?? null;
  const leads: DashLead[] = leadRows.map((l) => ({
    id: l.id, entryDate: l.entry_date, stage: l.stage, pipelineId: l.pipeline_id, closedAt: l.closed_at,
    source: l.source ?? "", utmSource: l.utm_source ?? "", utmMedium: l.utm_medium ?? "", tags: Array.isArray(l.tags) ? l.tags.map(String) : [],
  }));

  // ---- Financeiro: CRM confirmed receipts first; the monthly sheet only fills whole months when the CRM has none.
  const { readManagement } = await import("./finance-management.server");
  const { confirmedReceipts, settledExpenseItems } = await import("./finance-management");
  const snapshot = await readManagement(false);
  const receipts = confirmedReceipts(snapshot, to).filter((r) => r.date >= from).map((r) => ({ date: r.date, value: r.amount / 100 }));
  const expenseItems = settledExpenseItems(snapshot, to).filter((r) => r.date >= from).map((r) => ({ date: r.date, value: r.amount / 100 }));
  const months = fullMonths(from, to);
  const sheetMonths = months.filter((m) => m.startsWith(`${FINANCE_YEAR}-`));
  let sheet: Awaited<ReturnType<typeof import("./finance.server").readFinance>> | null = null;
  if (sheetMonths.length) { const { readFinance } = await import("./finance.server"); sheet = await readFinance(); }
  const sheetValue = (rows: { value: number | null }[] | undefined, m: string) => rows?.[Number(m.slice(5, 7)) - 1]?.value ?? null;
  const sheetSeries = (rows: { value: number | null }[] | undefined): MonthlyValue[] | null => {
    if (!rows || !sheetMonths.length) return null;
    const vals = sheetMonths.map((m) => ({ month: m, value: sheetValue(rows, m) }));
    return vals.some((v) => v.value === null) ? null : (vals as MonthlyValue[]);
  };
  let revenue: FinanceInputs["revenue"]; let revenueDaily: DatedValue[] = []; let revenueMonthly: MonthlyValue[] = [];
  if (receipts.length) {
    revenue = { total: receipts.reduce((n, r) => n + r.value, 0), source: "crm", note: "Recebimentos confirmados no Financeiro do CRM." };
    revenueDaily = receipts;
  } else {
    const series = sheetSeries(sheet?.months);
    if (series) { revenue = { total: series.reduce((n, r) => n + r.value, 0), source: "planilha", note: `Planilha Financeiro (${series.length} mês${series.length > 1 ? "es" : ""} completo${series.length > 1 ? "s" : ""}).` }; revenueMonthly = series; }
    else revenue = { total: null, source: null, note: months.length ? "Sem recebimentos confirmados no CRM nem valores na planilha para estes meses." : "Sem recebimentos confirmados no CRM; a planilha só cobre meses completos." };
  }
  const expenses: FinanceInputs["expenses"] = expenseItems.length
    ? { total: expenseItems.reduce((n, r) => n + r.value, 0), note: "Despesas pagas registradas no Financeiro (sem pessoais e transferências)." }
    : { total: null, note: "Nenhuma despesa paga registrada no Financeiro neste período." };

  // ---- Investimento: Portal ad spend (own Gravon accounts, BRL) for the exact period; monthly sheet as fallback.
  let investment: FinanceInputs["investment"] = { total: null, source: null, note: "Conecte os gastos de anúncios no Portal ou preencha a linha de tráfego da planilha." };
  let investmentDaily: DatedValue[] = []; let investmentMonthly: MonthlyValue[] = []; let investmentPartial = false;
  try {
    const { readAgencyAds } = await import("./portal-ads.server");
    const { uniqueAdsRows, adsPartial } = await import("./portal-ads");
    const ads = await readAgencyAds(from, to);
    if (ads.payload && !ads.error) {
      const rows = uniqueAdsRows(ads.payload.rows).filter((r) => r.date >= from && r.date <= to && r.currency === "BRL" && r.spend !== null);
      const byDay = new Map<string, number>();
      for (const r of rows) byDay.set(r.date, (byDay.get(r.date) ?? 0) + (r.spend as number));
      investmentDaily = [...byDay].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
      investmentPartial = adsPartial(ads.payload, from, to);
      investment = { total: investmentDaily.reduce((n, r) => n + r.value, 0), source: "portal", note: investmentPartial ? "Gastos dos anúncios da Gravon pelo Portal; cobertura parcial no período." : "Gastos dos anúncios da Gravon pelo Portal." };
    }
  } catch { console.error("dashboard_ads_unavailable"); }
  if (investment.total === null) {
    const series = sheetSeries(sheet?.traffic);
    if (series) { investment = { total: series.reduce((n, r) => n + r.value, 0), source: "planilha", note: "Linha de tráfego da planilha Financeiro (meses completos)." }; investmentMonthly = series; }
  }

  // ---- Commercial
  const com = commercialMetrics(leads, from, to);
  const cohort = leads.filter((l) => inRange(l.entryDate, from, to));
  const origins = new Map<string, { leads: number; qualified: number; sales: number }>();
  for (const l of cohort) {
    const g = originGroup(l, outboundId);
    const o = origins.get(g) ?? { leads: 0, qualified: 0, sales: 0 };
    o.leads++; if (isQualified(l.stage)) o.qualified++; if (l.stage === "fechado") o.sales++;
    origins.set(g, o);
  }
  const paidLeads = [...origins].filter(([g]) => isPaidOrigin(g)).reduce((n, [, o]) => n + o.leads, 0);
  const salesInPeriod = leads.filter((l) => l.stage === "fechado" && inRange(l.closedAt ?? l.entryDate, from, to));
  const classified = new Set(classes.map((c) => c.lead_id));
  const pendingClassifications = salesInPeriod.filter((l) => !classified.has(l.id)).length;
  const { countNewCustomers } = await import("./sale-classifications");
  const newCustomers = countNewCustomers(classes.map((c) => ({ customerKey: c.customer_key, saleType: c.sale_type, firstAcquisition: c.first_acquisition, closedOn: c.closed_on })), from, to);
  const fin = financialMetrics({ revenue, expenses, investment, newCustomers, pendingClassifications }, paidLeads, com.sales);

  const funnels = pipelines.map((p) => {
    const ls = leads.filter((l) => (l.pipelineId ?? null) === p.id);
    const c = commercialMetrics(ls, from, to);
    return { id: p.id, name: p.name, leads: c.received, opportunities: c.qualified, conversions: c.closedInCohort, sales: c.sales };
  });

  // ---- Outbound
  const outLeads = outboundId ? leads.filter((l) => l.pipelineId === outboundId) : [];
  const outCohort = outLeads.filter((l) => inRange(l.entryDate, from, to));
  const sentStates = new Set(["accepted", "scheduled"]);
  const outbound: Record<string, Metric> = {
    companies: ok(b2b.length, "Empresas cadastradas na Prospecção B2B no período."),
    contacts: outboundId ? ok(outCohort.filter((l) => isContacted(l.stage)).length, "Cards do Outbound que chegaram a Contato Realizado.") : unavailable("Funil Outbound não encontrado."),
    emails: ok(deliveries.filter((d) => sentStates.has(d.state)).length, "E-mails de campanha aceitos pelo Brevo."),
    replies: integration("Respostas de e-mail ainda não são recebidas pelo CRM."),
    leads: outboundId ? ok(outCohort.length) : unavailable("Funil Outbound não encontrado."),
    opportunities: outboundId ? ok(outCohort.filter((l) => isQualified(l.stage)).length) : unavailable("Funil Outbound não encontrado."),
    customers: outboundId ? ok(outLeads.filter((l) => l.stage === "fechado" && inRange(l.closedAt ?? l.entryDate, from, to)).length) : unavailable("Funil Outbound não encontrado."),
  };

  // ---- Gravon IA
  const lastByContact = new Map<string, { fromMe: boolean; at: string }>();
  for (const m of messages.data ?? []) if (!lastByContact.has(m.phone_key)) lastByContact.set(m.phone_key, { fromMe: m.from_me, at: m.sent_at });
  const unanswered = [...lastByContact].filter(([k, v]) => k.length >= 8 && !v.fromMe && inRange(new Date(v.at).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }), from, to)).length;
  const ai: Record<string, Metric> = {
    analyzed: ok(analyses.length, "Análises de conversa feitas no período."),
    automatic: ok(runs.filter((r) => ["accepted", "completed"].includes(r.status)).length, "Respostas enviadas pela Gravon IA."),
    qualified: ok(analyses.filter((a) => a.result?.qualification === "qualified").length, "Conversas que a análise considerou qualificadas."),
    human: ok(runs.filter((r) => r.status === "human").length, "Atendimentos transferidos para uma pessoa."),
    unanswered: ok(unanswered, "Conversas cuja última mensagem é do cliente."),
    opportunities: ok(analyses.filter((a) => a.result?.opportunity === "open").length, "Oportunidades em aberto apontadas pelas análises."),
  };

  const day = (v: string | null) => (v ? new Date(v).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }) : "");
  return {
    period: { from, to }, scope: scope.companyKey,
    financial: fin,
    commercial: {
      received: ok(com.received), qualified: ok(com.qualified), negotiation: ok(com.negotiation), sales: ok(com.sales),
      conversion: com.conversion === null ? unavailable("Sem leads no período.") : ok(com.conversion, "Fechados entre os leads que entraram no período."),
      cpl: fin.cpl, cac: fin.cac,
    },
    outbound, ai,
    series: {
      leads: leads.map((l) => ({ entryDate: l.entryDate, stage: l.stage, closedAt: l.closedAt, pipelineId: l.pipelineId })).filter((l) => inRange(l.entryDate, from, to) || (l.stage === "fechado" && inRange(l.closedAt ?? l.entryDate, from, to))),
      revenueDaily, revenueMonthly, investmentDaily, investmentMonthly, investmentPartial,
      b2bDaily: b2b.map((r) => day(r.created_at)),
      outboundId,
    },
    funnels, origins: [...origins].map(([name, o]) => ({ name, ...o })).sort((a, b) => b.leads - a.leads),
    sources: { revenue: revenue.source, investment: investment.source, sheetError: sheet?.error ?? null },
    pendingClassifications,
  };
}
