// Leituras derivadas do Controle de Recebimentos: fila de ação do dia, aging e resumo por cliente.
// Somente leitura sobre as linhas canônicas (receiptRows); nunca cria nem altera cobranças.
import { addDays } from "./finance-management";
import { daysBetween } from "./ux-format";
import type { ReceiptRow } from "./receipt-control";

export type QueueItem = { row: ReceiptRow; days: number };

/** Atrasados (mais antigos e maiores primeiro), vencendo nos próximos `windowDays` e aguardando conciliação. */
export function receiptActionQueue(rows: ReceiptRow[], asOf: string, windowDays = 7) {
  const open = rows.filter((r) => r.remaining > 0);
  const overdue = open
    .filter((r) => r.overdue && r.statusLabel !== "conciliacao")
    .map((row) => ({ row, days: daysBetween(row.due_date, asOf) }))
    .sort((a, b) => b.days - a.days || b.row.remaining - a.row.remaining);
  const limit = addDays(asOf, windowDays);
  const dueSoon = open
    .filter((r) => !r.overdue && r.due_date >= asOf && r.due_date <= limit && r.statusLabel !== "conciliacao")
    .map((row) => ({ row, days: daysBetween(asOf, row.due_date) }))
    .sort((a, b) => a.days - b.days || b.row.remaining - a.row.remaining);
  const reconciling = open.filter((r) => r.statusLabel === "conciliacao").map((row) => ({ row, days: daysBetween(row.due_date, asOf) }));
  const sum = (list: QueueItem[]) => list.reduce((n, i) => n + i.row.remaining, 0);
  return { overdue, dueSoon, reconciling, totals: { overdue: sum(overdue), dueSoon: sum(dueSoon), reconciling: sum(reconciling) } };
}

export const AGING_BUCKETS = [
  { key: "a_vencer", label: "A vencer" },
  { key: "d1_15", label: "1–15 dias" },
  { key: "d16_30", label: "16–30 dias" },
  { key: "d31_60", label: "31–60 dias" },
  { key: "d60", label: "+60 dias" },
] as const;
export type AgingKey = (typeof AGING_BUCKETS)[number]["key"];

/** Saldo em aberto distribuído por idade do vencimento. */
export function receiptAging(rows: ReceiptRow[], asOf: string): Record<AgingKey, { amount: number; count: number }> {
  const out = Object.fromEntries(AGING_BUCKETS.map((b) => [b.key, { amount: 0, count: 0 }])) as Record<AgingKey, { amount: number; count: number }>;
  for (const r of rows) {
    if (r.remaining <= 0) continue;
    const late = daysBetween(r.due_date, asOf);
    const key: AgingKey = late <= 0 ? "a_vencer" : late <= 15 ? "d1_15" : late <= 30 ? "d16_30" : late <= 60 ? "d31_60" : "d60";
    out[key].amount += r.remaining;
    out[key].count += 1;
  }
  return out;
}

export type ClientReceiptHealth = { lastPayment: string | null; maxDaysLate: number; nextDue: string | null; nextAmount: number; monthly: number; openOverdue: number };

/** Resumo financeiro por cliente para listas (último pagamento, maior atraso aberto, próximo vencimento). */
export function clientReceiptHealth(rows: ReceiptRow[], asOf: string): Map<string, ClientReceiptHealth> {
  const map = new Map<string, ClientReceiptHealth>();
  for (const r of rows) {
    const h = map.get(r.client_id) ?? { lastPayment: null, maxDaysLate: 0, nextDue: null, nextAmount: 0, monthly: 0, openOverdue: 0 };
    for (const p of r.payments) if (!h.lastPayment || p.paid_at > h.lastPayment) h.lastPayment = p.paid_at;
    if (r.remaining > 0 && r.overdue) {
      h.maxDaysLate = Math.max(h.maxDaysLate, daysBetween(r.due_date, asOf));
      h.openOverdue += r.remaining;
    }
    if (r.remaining > 0 && r.due_date >= asOf && (!h.nextDue || r.due_date < h.nextDue)) {
      h.nextDue = r.due_date;
      h.nextAmount = r.remaining;
    }
    if (r.recurrence === "mensal" && r.due_date.slice(0, 7) === asOf.slice(0, 7)) h.monthly += r.amountCents;
    map.set(r.client_id, h);
  }
  return map;
}
