import { test } from "node:test";
import assert from "node:assert/strict";
import { receiptActionQueue, receiptAging, clientReceiptHealth } from "./receipt-insights";
import { dateBR, relativeDay, percentChange, previousMonth } from "./ux-format";
import type { ReceiptRow } from "./receipt-control";

const row = (o: Partial<ReceiptRow>): ReceiptRow => ({
  id: o.id ?? "r", client_id: o.client_id ?? "c1", due_date: o.due_date ?? "2026-11-07", amount: 100, status: "pendente", description: "Mensalidade",
  recurrence: o.recurrence ?? "mensal", amountCents: 10000, received: 0, remaining: o.remaining ?? 10000, overdue: o.overdue ?? false,
  statusLabel: o.statusLabel ?? "pendente", payments: o.payments ?? [], ...o,
} as ReceiptRow);
const asOf = "2026-11-07";

test("fila separa atrasados, próximos 7 dias e conciliação, sem itens pagos", () => {
  const q = receiptActionQueue([
    row({ id: "a", due_date: "2026-10-01", overdue: true, statusLabel: "atrasado" }),
    row({ id: "b", due_date: "2026-11-01", overdue: true, statusLabel: "atrasado", remaining: 50000 }),
    row({ id: "c", due_date: "2026-11-10" }),
    row({ id: "d", due_date: "2026-11-20" }),
    row({ id: "e", due_date: "2026-11-01", overdue: true, statusLabel: "conciliacao" }),
    row({ id: "f", due_date: "2026-11-01", remaining: 0, statusLabel: "pago" }),
  ], asOf);
  assert.deepEqual(q.overdue.map((i) => [i.row.id, i.days]), [["a", 37], ["b", 6]]);
  assert.deepEqual(q.dueSoon.map((i) => [i.row.id, i.days]), [["c", 3]]);
  assert.deepEqual(q.reconciling.map((i) => i.row.id), ["e"]);
  assert.equal(q.totals.overdue, 60000);
});

test("aging distribui somente saldo em aberto", () => {
  const a = receiptAging([
    row({ due_date: "2026-11-30" }), row({ due_date: "2026-11-01", overdue: true }), row({ due_date: "2026-10-20", overdue: true }),
    row({ due_date: "2026-09-20", overdue: true }), row({ due_date: "2026-01-01", overdue: true }), row({ due_date: "2026-01-01", remaining: 0 }),
  ], asOf);
  assert.deepEqual(Object.values(a).map((b) => b.count), [1, 1, 1, 1, 1]);
});

test("saúde por cliente traz último pagamento, maior atraso e próximo vencimento", () => {
  const h = clientReceiptHealth([
    row({ due_date: "2026-10-01", overdue: true, payments: [{ id: "p", charge_id: "x", paid_at: "2026-09-02", amount: 10 } as never] }),
    row({ due_date: "2026-11-15" }), row({ due_date: "2026-11-10" }),
  ], asOf).get("c1")!;
  assert.equal(h.lastPayment, "2026-09-02");
  assert.equal(h.maxDaysLate, 37);
  assert.equal(h.nextDue, "2026-11-10");
});

test("formatação de leitura", () => {
  assert.equal(dateBR("2026-11-07"), "07/11/2026");
  assert.equal(dateBR(null), "—");
  assert.equal(relativeDay("2026-11-08", asOf), "amanhã");
  assert.equal(relativeDay("2026-11-02", asOf), "há 5 dias");
  assert.equal(percentChange(110, 100), 10);
  assert.equal(percentChange(5, 0), null);
  assert.equal(previousMonth("2026-01"), "2025-12");
});

test("dias úteis restantes no mês", async () => {
  const { businessDaysLeft } = await import("./ux-format");
  assert.equal(businessDaysLeft("2026-11", "2026-11-07"), 16); // sáb 07/11 → seg 09 a seg 30
  assert.equal(businessDaysLeft("2026-10", "2026-11-07"), 0);
  assert.equal(businessDaysLeft("2026-12", "2026-11-07"), 23);
});
