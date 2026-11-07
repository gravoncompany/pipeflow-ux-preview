import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const rangeInput = z.object({ from: day, to: day, year: z.number().int().min(2020).max(2100), personal: z.boolean().default(false) }).strict()
  .refine((r) => r.from <= r.to, "Período inválido.")
  .refine((r) => (Date.parse(r.to) - Date.parse(r.from)) / 86400000 <= 800, "Escolha um período menor.");

/** Personal view additionally requires the verified administrator (same gate as Administração Pessoal). */
async function access(personal: boolean) {
  const { financeAccess } = await import("./finance-management.server");
  if (personal) await financeAccess(true);
  const a = await financeAccess(false);
  if (a.scope !== "crm:1") throw new Error("Escopo financeiro inválido.");
  return a;
}

export const getBankOverview = createServerFn({ method: "POST" }).inputValidator((i) => rangeInput.parse(i)).handler(async ({ data }) => {
  const { db } = await access(data.personal);
  const { bankOverview } = await import("./bank-overview.server");
  const result = await bankOverview(db as never, data.from, data.to, data.year);
  await access(data.personal);
  return result;
});

/** Faturamento confirmado de um ano inteiro: mesma regra da Visão Geral (Financeiro + banco confirmado, uma vez só). */
export const getFaturamentoAnual = createServerFn({ method: "POST" }).inputValidator((i) => z.object({ year: z.number().int().min(2020).max(2100) }).strict().parse(i)).handler(async ({ data }) => {
  const { db } = await access(false);
  const { loadClassifiedRows, loadReceipts } = await import("./bank-overview.server");
  const { yearEvolution, yearlyRevenueStats } = await import("./bank-overview");
  const from = `${data.year}-01-01`, to = `${data.year}-12-31`;
  const [{ rows }, receipts] = await Promise.all([loadClassifiedRows(db as never, from, to), loadReceipts(db as never, from, to)]);
  const months = yearEvolution(rows, receipts, data.year);
  await access(false);
  return { year: data.year, months, stats: yearlyRevenueStats(months, data.year) };
});

/** Gravon IA suggests categories for pending rows without a suggestion (largest first). Never confirms or overwrites. */
export const suggestBankWithAi = createServerFn({ method: "POST" }).inputValidator((i) => z.object({ from: day, to: day, ids:z.array(z.string().min(1).max(128)).max(3000).optional() }).strict().refine(r=>r.from<=r.to && (Date.parse(r.to)-Date.parse(r.from))/86400000<=800,"Período inválido.").parse(i)).handler(async ({ data }) => {
  const { db } = await access(false);
  const { loadClassifiedRows } = await import("./bank-overview.server");
  const { suggestBankCategories, BANK_AI_MODEL } = await import("./ai/bank-classification-ai.server");
  const { spDay } = await import("./bank-overview");
  const { rows } = await loadClassifiedRows(db as never, data.from, data.to);
  const nonOp = new Set(["aplicacao", "resgate", "rendimento", "transferencia_interna", "emprestimo"]);
  const selected=data.ids?new Set(data.ids):null;
  const todo = rows.filter((r) => (!selected||selected.has(r.transactionId)) && r.status === "pendente" && !r.ai && r.direction && r.amountCents !== null && r.currency === "BRL" && !nonOp.has(r.cls.kind))
    .sort((a, b) => Math.abs(b.amountCents ?? 0) - Math.abs(a.amountCents ?? 0));
  const batch = todo.slice(0, 50);
  if (!batch.length) return { suggested: 0, remaining: 0 };
  const examples = rows.filter((r) => r.status !== "pendente" && r.cls.kind !== "nao_classificado").slice(0, 60)
    .map((r) => ({ direction: r.direction ?? "", description: r.description, counterparty: r.counterparty, kind: r.cls.kind, category: r.cls.category }));
  const inputs = batch.map((r, i) => ({ ref: String(i), direction: r.direction as "CREDITO" | "DEBITO", amountCents: Math.abs(r.amountCents as number), day: r.transactionAt ? spDay(r.transactionAt) : null,
    description: r.description?.slice(0, 200) ?? null, counterparty: r.counterparty?.slice(0, 120) ?? null, type: r.type, hint: r.suggestion.hint ?? null }));
  const out = await suggestBankCategories(inputs, examples);
  await access(false);
  const payload = out.flatMap((o) => batch[Number(o.ref)] ? [{ company_key: "crm:1", polp_transaction_id: batch[Number(o.ref)]?.transactionId, kind: o.kind, category: o.category, confidence: o.confidence, reason: o.reason, model: BANK_AI_MODEL }] : []);
  if (payload.length) {
    const { error } = await (db as unknown as { from(t: string): { upsert(v: unknown, o: { onConflict: string }): PromiseLike<{ error: unknown }> } })
      .from("polp_bank_ai_suggestions").upsert(payload, { onConflict: "company_key,polp_transaction_id" });
    if (error) throw new Error("Não foi possível guardar as sugestões. Nenhuma classificação foi alterada.");
  }
  return { suggested: payload.length, remaining: Math.max(0, todo.length - batch.length) };
});
