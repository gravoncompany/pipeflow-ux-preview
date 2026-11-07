// Leitura das movimentações bancárias classificadas para a Visão Geral do Financeiro.
// Reutiliza exatamente classify/reviewStatus do painel bancário (polp-bank-ledger.server); nada é gravado aqui.
import * as bc from "./bank-classification";
import { learnedBankSuggestion, type ApprovedExample } from "./bank-review";
import { bankCoverage, categoryBreakdown, cardRows, monthlyPersonal, overviewTotals, spDay, yearEvolution, type OverviewRow, type SourceReceipt } from "./bank-overview";

const COMPANY = "crm:1";
type Res = { data: unknown; error: unknown };
type Q = PromiseLike<Res> & { eq(c: string, v: unknown): Q; in(c: string, v: unknown[]): Q; gte(c: string, v: unknown): Q; lt(c: string, v: unknown): Q; order(c: string, o: { ascending: boolean }): Q; range(a: number, b: number): Q; limit(n: number): Q };
export type OverviewDb = { from(t: string): { select(c: string): Q } };

export type AiSuggestion = { kind: bc.BankKind; category: bc.CostCategory | null; confidence: "alta" | "media" | "baixa"; reason: string | null };
export type LoadedRow = OverviewRow & { suggestion: bc.Classification; overrideRevision: number; ai: AiSuggestion | null; type: string | null; accountId: string; clientId: string | null; clientSuggestion: { id: string; reason: string } | null };

const startSP = (day: string) => new Date(`${day}T00:00:00-03:00`).toISOString();
const nextDay = (day: string) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

/** Loads and classifies every bank transaction between two São Paulo days (inclusive). */
export async function loadClassifiedRows(db: OverviewDb, fromDay: string, toDay: string) {
  const from = startSP(fromDay), to = startSP(nextDay(toDay));
  type Tx = { polp_transaction_id: string; transaction_at: string | null; description: string | null; amount_cents: number | null; currency: string; direction: "CREDITO" | "DEBITO" | null; category_ref: string | null; transaction_type: string | null; counterparty_name: string | null; polp_account_id: string; counterparty_doc_hmac: string | null };
  const raw: Tx[] = [];
  let truncated = false;
  for (let page = 0; page < 20; page++) {
    const { data, error } = await db.from("polp_bank_transactions")
      .select("polp_transaction_id,transaction_at,description,amount_cents,currency,direction,category_ref,transaction_type,counterparty_name,polp_account_id,counterparty_doc_hmac")
      .eq("company_key", COMPANY).gte("transaction_at", from).lt("transaction_at", to)
      .order("transaction_at", { ascending: false }).range(page * 1000, page * 1000 + 999);
    if (error) throw new Error("Não foi possível ler as movimentações bancárias.");
    const list = (data ?? []) as Tx[];
    raw.push(...list);
    if (list.length < 1000) break;
    if (page === 19) truncated = true;
  }
  // PostgREST returns at most 1000 rows per request: page through every list that can grow past it.
  const all = async (table: string, cols: string) => {
    const out: unknown[] = [];
    for (let page = 0; page < 30; page++) {
      const { data, error } = await db.from(table).select(cols).eq("company_key", COMPANY).order("polp_transaction_id", { ascending: true }).range(page * 1000, page * 1000 + 999);
      if (error) return { data: null, error };
      const list = (data ?? []) as unknown[];
      out.push(...list);
      if (list.length < 1000) break;
    }
    return { data: out, error: null };
  };
  const [ov, rl, ai] = await Promise.all([
    all("polp_bank_classification_overrides", "polp_transaction_id,kind,category,vendor,revision,decision"),
    db.from("polp_bank_classification_rules").select("field,pattern,direction,kind,category,vendor,active").eq("company_key", COMPANY).limit(500),
    all("polp_bank_ai_suggestions", "polp_transaction_id,kind,category,confidence,reason"),
  ]);
  if (ov.error || rl.error) throw new Error("Não foi possível ler as classificações.");
  type Ov = { polp_transaction_id: string; kind: bc.BankKind; category: bc.CostCategory | null; vendor: string | null; revision: number; decision: "aprovado" | "corrigido" | null };
  const overrides = new Map(((ov.data ?? []) as Ov[]).map((o) => [o.polp_transaction_id, o]));
  const rules = ((rl.data ?? []) as { field: "description" | "counterparty"; pattern: string; direction: string | null; kind: bc.BankKind; category: bc.CostCategory | null; vendor: string | null; active: boolean | null }[])
    .filter((r) => r.active !== false)
    .map((r) => ({ field: r.field, pattern: r.pattern, kind: r.kind, category: r.category, vendor: r.vendor, direction: (r.direction === "CREDITO" || r.direction === "DEBITO" ? r.direction : null) as "CREDITO" | "DEBITO" | null }));
  const aiMap = new Map(ai.error ? [] : ((ai.data ?? []) as (AiSuggestion & { polp_transaction_id: string })[]).map((a) => [a.polp_transaction_id, a]));
  // All reconciliations of the company; avoids very long id lists in the request URL.
  const rec = await all("polp_bank_reconciliations", "polp_transaction_id");
  if (rec.error) throw new Error("Não foi possível ler as conciliações.");
  const reconciled = new Set(((rec.data ?? []) as { polp_transaction_id: string }[]).map((r) => r.polp_transaction_id));
  const payoutsResult=await db.from('crm_hypercash_payout_links').select('bank_transaction_id').eq('company_key',COMPANY).limit(20000);
  if(payoutsResult.error)throw new Error('Não foi possível verificar os repasses conciliados.');
  const payoutIds=new Set(((payoutsResult.data??[]) as {bank_transaction_id:string}[]).map(p=>p.bank_transaction_id));
  const links = await all("polp_bank_client_links", "polp_transaction_id,client_id");
  if (links.error) throw new Error("Não foi possível ler os vínculos bancários.");
  const clientLinks = new Map(((links.data ?? []) as {polp_transaction_id:string;client_id:string}[]).map(r => [r.polp_transaction_id,r.client_id]));
  const historyResult = await db.from("polp_bank_transactions").select("polp_transaction_id,polp_account_id,counterparty_doc_hmac,counterparty_name,description,direction,amount_cents,transaction_at").eq("company_key",COMPANY).order("transaction_at",{ascending:false}).limit(1000);
  if (historyResult.error) throw new Error("Não foi possível ler o histórico bancário.");
  const examples: ApprovedExample[] = ((historyResult.data ?? []) as Tx[]).flatMap(r => {
    const o=overrides.get(r.polp_transaction_id); if(!o)return [];
    return [{transactionId:r.polp_transaction_id,accountId:r.polp_account_id,payerHmac:r.counterparty_doc_hmac,counterparty:r.counterparty_name,description:r.description,direction:r.direction,amountCents:r.amount_cents,transactionAt:r.transaction_at,kind:o.kind,category:o.category,vendor:o.vendor,clientId:clientLinks.get(r.polp_transaction_id)??null}];
  });
  const rows: LoadedRow[] = raw.map((r) => {
    const o = overrides.get(r.polp_transaction_id) ?? null;
    const input = { direction: r.direction, type: r.transaction_type, categoryRef: r.category_ref, description: r.description, counterparty: r.counterparty_name };
    const base = bc.classify(input, rules, null);
    const learned=learnedBankSuggestion({transactionId:r.polp_transaction_id,accountId:r.polp_account_id,payerHmac:r.counterparty_doc_hmac,counterparty:r.counterparty_name,description:r.description,direction:r.direction,amountCents:r.amount_cents,transactionAt:r.transaction_at},examples);
    const protectedKind=["aplicacao","resgate","rendimento","transferencia_interna","emprestimo"].includes(base.kind);
    const suggestion = base.source==='regra'||protectedKind ? base : learned ?? base;
    const cls = payoutIds.has(r.polp_transaction_id) ? bc.classify(input,rules,{kind:'transferencia_interna',category:null,vendor:'HyperCash'}) : o ? bc.classify(input, rules, { kind: o.kind, category: o.category, vendor: o.vendor }) : suggestion;
    const isRec = reconciled.has(r.polp_transaction_id);
    const a = aiMap.get(r.polp_transaction_id);
    return {
      transactionId: r.polp_transaction_id, transactionAt: r.transaction_at, amountCents: r.amount_cents === null ? null : Number(r.amount_cents), currency: r.currency,
      direction: r.direction, description: r.description, counterparty: r.counterparty_name, type: r.transaction_type, cls,
      status: bc.reviewStatus(cls, o ? { decision: o.decision ?? "corrigido" } : null, isRec), reconciled: isRec, suggestion, overrideRevision: o?.revision ?? 0,
      ai: learned && !protectedKind && base.source!=='regra' ? {kind:learned.kind,category:learned.category,confidence:learned.confidence??'media',reason:learned.reason} : a && !protectedKind ? { kind: a.kind, category: a.category, confidence: a.confidence, reason: a.reason } : null,
      accountId:r.polp_account_id,clientId:clientLinks.get(r.polp_transaction_id)??null,clientSuggestion:learned?.clientId?{id:learned.clientId,reason:learned.reason}:null,
    };
  });
  return { rows, truncated };
}

export async function loadReceipts(db: OverviewDb, fromDay: string, toDay: string): Promise<SourceReceipt[]> {
  const { data, error } = await db.from("universe_confirmed_sources").select("amount,date,status").eq("status", "confirmada").gte("date", fromDay).lt("date", nextDay(toDay)).limit(20000);
  if (error) throw new Error("Não foi possível ler os recebimentos confirmados.");
  return ((data ?? []) as { amount: number; date: string }[]).map((r) => ({ amountCents: Number(r.amount), date: String(r.date).slice(0, 10) }));
}

/** Primeira movimentação guardada e até quando a última sincronização bem-sucedida buscou dados. Falha de leitura não bloqueia os totais. */
async function loadCoverage(db: OverviewDb, fromDay: string, toDay: string) {
  try {
    const [first, sync] = await Promise.all([
      db.from("polp_bank_transactions").select("transaction_at").eq("company_key", COMPANY).order("transaction_at", { ascending: true }).limit(1),
      db.from("polp_sync_runs").select("window_to,finished_at").eq("company_key", COMPANY).eq("status", "success").order("finished_at", { ascending: false }).limit(1),
    ]);
    if (first.error || sync.error) return null;
    const firstAt = ((first.data ?? []) as { transaction_at: string | null }[])[0]?.transaction_at ?? null;
    const run = ((sync.data ?? []) as { window_to: string | null; finished_at: string | null }[])[0];
    return bankCoverage(fromDay, toDay, firstAt, run?.window_to ?? run?.finished_at ?? null);
  } catch { return null; }
}

const view = (r: OverviewRow) => ({
  id: r.transactionId, day: r.transactionAt ? spDay(r.transactionAt) : null, amountCents: r.amountCents, direction: r.direction,
  description: r.description, counterparty: r.counterparty, kind: r.cls.kind, category: r.cls.category, status: r.status,
});
const top = (list: OverviewRow[], n = 300) => [...list].sort((a, b) => Math.abs(b.amountCents ?? 0) - Math.abs(a.amountCents ?? 0)).slice(0, n).map(view);

export async function bankOverview(db: OverviewDb, fromDay: string, toDay: string, year: number) {
  const yFrom = `${year}-01-01`, yTo = `${year}-12-31`;
  const lo = fromDay < yFrom ? fromDay : yFrom, hi = toDay > yTo ? toDay : yTo;
  const [{ rows: all, truncated }, receiptsAll] = await Promise.all([loadClassifiedRows(db, lo, hi), loadReceipts(db, lo, hi)]);
  const inRange = (day: string | null, a: string, b: string) => Boolean(day && day >= a && day <= b);
  const rows = all.filter((r) => inRange(r.transactionAt ? spDay(r.transactionAt) : null, fromDay, toDay));
  const receipts = receiptsAll.filter((r) => inRange(r.date, fromDay, toDay));
  const yearRows = all.filter((r) => r.transactionAt && spDay(r.transactionAt).startsWith(`${year}-`));
  const yearReceipts = receiptsAll.filter((r) => r.date.startsWith(`${year}-`));
  const cards = cardRows(rows, receipts);
  const coverage = await loadCoverage(db, fromDay, toDay);
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  const pending = rows.filter((r) => r.status === "pendente" && r.amountCents !== null && r.direction && r.currency === "BRL"
    && !["aplicacao", "resgate", "rendimento", "transferencia_interna", "emprestimo"].includes(r.cls.kind));
  const pendingView = [...pending].sort((a, b) => Math.abs(b.amountCents ?? 0) - Math.abs(a.amountCents ?? 0)).map((r) => ({
    ...view(r), suggestion: { kind: r.suggestion.kind, category: r.suggestion.category, vendor: r.suggestion.vendor, hint: r.suggestion.hint ?? null },
    ai: r.ai, overrideRevision: r.overrideRevision, accountId:r.accountId,clientId:r.clientId,clientSuggestion:r.clientSuggestion,
  }));
  return {
    period: { from: fromDay, to: toDay }, year, truncated, coverage,
    totals: overviewTotals(rows, receipts),
    revenueFromFinanceCount: receipts.length,
    cards: { revenue: top(cards.revenue), opExpense: top(cards.opExpense), personal: top(cards.personal), bankIn: top(cards.bankIn), bankOut: top(cards.bankOut) },
    cardCounts: { revenue: cards.revenue.length, opExpense: cards.opExpense.length, personal: cards.personal.length, bankIn: cards.bankIn.length, bankOut: cards.bankOut.length },
    opCategories: categoryBreakdown(rows, "despesa_operacional").map((c) => ({ ...c, rows: top(c.rows, 200) })),
    personalCategories: categoryBreakdown(rows, "despesa_pessoal").map((c) => ({ ...c, rows: top(c.rows, 200) })),
    evolution: yearEvolution(yearRows, yearReceipts, year),
    personalMonths: monthlyPersonal(yearRows, months),
    pending: pendingView,
    confirmedUnlinked:rows.filter(r=>r.status!=='pendente'&&r.cls.kind==='receita_operacional'&&!r.clientId&&!r.reconciled).map(r=>({...view(r),suggestion:r.suggestion,ai:r.ai,overrideRevision:r.overrideRevision,accountId:r.accountId,clientId:r.clientId,clientSuggestion:r.clientSuggestion})),
    pendingWithoutAi: pending.filter((r) => !r.ai).length,
    // Every high-confidence AI suggestion in the period (not only the listed rows), for an explicit bulk confirmation.
    highConfidence: pending.filter((r) => r.ai && r.ai.confidence === "alta" && r.ai.kind !== "nao_classificado" && !r.suggestion.hint).slice(0, 3000)
      .map((r) => ({ id: r.transactionId, kind: r.ai?.kind ?? "nao_classificado", category: r.ai?.category ?? null, overrideRevision: r.overrideRevision, suggestion: { kind: r.suggestion.kind, category: r.suggestion.category, vendor: r.suggestion.vendor } })),
  };
}
export type BankOverview = Awaited<ReturnType<typeof bankOverview>>;
