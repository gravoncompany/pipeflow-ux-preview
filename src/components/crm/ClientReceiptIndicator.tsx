import { Link } from "@tanstack/react-router";
import { receiptRows,receiptSummary,type ReceiptCharge } from "@/lib/receipt-control";
import type { ClientPayment } from "@/lib/finance-management";
import { currency } from "@/lib/revenue";
export function ClientReceiptIndicator({clientId,charges,payments}:{clientId:string;charges:ReceiptCharge[];payments:ClientPayment[]}) {
 const summary=receiptSummary(receiptRows(charges,payments));
 return <section className="border-y py-4"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Situação financeira</h2><Link to="/financeiro/recebimentos" search={{cliente:clientId}} className="text-sm text-primary underline">Consultar recebimentos</Link></div><dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">{[["Recebido",summary.received],["Pendente",summary.pending],["Atrasado",summary.overdue]].map(([label,value])=><div key={String(label)}><dt className="text-muted-foreground">{label}</dt><dd className="font-semibold">{currency(Number(value)/100)}</dd></div>)}<div><dt className="text-muted-foreground">Realizado</dt><dd className="font-semibold">{summary.percent}%</dd></div></dl></section>;
}