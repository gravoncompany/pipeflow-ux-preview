import { RECEIPT_LABELS, type ReceiptStatus } from "@/lib/receipt-control";
const colors:Record<ReceiptStatus,string>={pago:"bg-success",pendente:"bg-receipt-pending",atrasado:"bg-destructive",parcial:"bg-receipt-partial",conciliacao:"bg-muted-foreground"};
// Mesmo símbolo usado nas células da grade anual, para a legenda não depender só da cor.
const glyphs:Record<ReceiptStatus,string>={pago:"✓",pendente:"○",atrasado:"!",parcial:"◐",conciliacao:"⇄"};
export function ReceiptStatusLabel({status}:{status:ReceiptStatus}) {return <span className="inline-flex items-center gap-1.5 text-xs"><span className={`inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${colors[status]}`} aria-hidden>{glyphs[status]}</span>{RECEIPT_LABELS[status]}</span>;}
