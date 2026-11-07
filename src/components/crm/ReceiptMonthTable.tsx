import { Link } from "@tanstack/react-router";
import { receiptMonthGrid, receiptSummary, type ReceiptRow } from "@/lib/receipt-control";
import { currency } from "@/lib/revenue";
import { Button } from "@/components/ui/button";
import { ReceiptStatusLabel } from "./ReceiptStatus";

const money=(cents:number)=>currency(cents/100);
const date=(value:string)=>value.split("-").reverse().join("/");
export function ReceiptMonthTable({title,recurrence,month,allRows,rows,names,onDetail}:{title:string;recurrence:string;month:string;allRows:ReceiptRow[];rows:ReceiptRow[];names:Map<string,string>;onDetail:(id:string)=>void}) {
 const grid=receiptMonthGrid(allRows,month,recurrence);
 const visible=new Set(rows.map(r=>r.id));
 const groups=grid.groups.map(g=>({...g,cells:g.cells.map(cell=>cell.filter(r=>visible.has(r.id)))})).filter(g=>g.cells.some(c=>c.length));
 const columns=Array.from({length:grid.columnCount},(_,i)=>i);
 const list=groups.flatMap(g=>g.cells.flat());
 const total=receiptSummary(list);
 const monthly=recurrence==="mensal";
 const label=(i:number)=>recurrence==="semanal"?`Semana ${i+1}`:recurrence==="quinzenal"?(i<2?`${i+1}ª quinzena`:`${i+1}º vencimento`):`Cobrança ${i+1}`;
 const heading=recurrence==="semanal"?"Valor semanal":recurrence==="quinzenal"?"Valor quinzenal":"Valor previsto";
 return <section className="border-t py-6" aria-label={title}>
  <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{title}</h2><span className="text-xs text-muted-foreground">{groups.length} cliente(s) · {list.length} cobranças</span></div>
  {groups.length>0?<div className="max-h-[65dvh] max-w-full overflow-auto rounded-md border"><table className="w-full min-w-[900px] border-separate border-spacing-0 text-left text-sm">
   <thead className="sticky top-0 z-20 bg-muted"><tr><th className="sticky left-0 z-30 min-w-48 border-b bg-muted px-3 py-3">Cliente</th><th className="min-w-36 border-b px-3 py-3">{heading}</th>{columns.map(i=><th key={i} className="min-w-44 border-b px-3 py-3">{label(i)}</th>)}{["Total previsto","Total recebido","Saldo pendente"].map(h=><th key={h} className="min-w-36 border-b px-3 py-3 text-right">{h}</th>)}</tr></thead>
   <tbody>{groups.map(g=>{
    const charges=g.cells.flat(),summary=receiptSummary(charges),amounts=[...new Set(charges.map(r=>r.amountCents))];
    return <tr key={g.clientId} className="align-top"><th className="sticky left-0 z-10 border-b bg-background px-3 py-3 font-medium"><Link to="/clientes/$id" params={{id:g.clientId}} search={{aba:undefined}} className="text-primary">{names.get(g.clientId)??"Cliente"}</Link>{monthly&&<div className="mt-1 text-xs font-normal text-muted-foreground">{[...new Set(charges.map(r=>r.description))].join(" · ")}</div>}</th><td className="border-b px-3 py-3 tabular-nums">{amounts.length===1?money(amounts[0]):"Valores variáveis"}</td>{columns.map(i=><td key={i} className="border-b px-2 py-2">{g.cells[i]?.map(r=><Button key={r.id} variant="ghost" aria-label={`Abrir cobrança de ${names.get(g.clientId)??"Cliente"}, ${date(r.due_date)}`} className="mb-1 h-auto w-full flex-col items-start gap-1 rounded-md border px-2 py-2 text-left" onClick={()=>onDetail(r.id)}><span className="font-semibold tabular-nums">{money(r.amountCents)}</span><span className="text-xs font-normal text-muted-foreground">Vence {date(r.due_date)}</span><ReceiptStatusLabel status={r.statusLabel}/>{r.received>0&&<span className="text-xs font-normal">Recebido {money(r.received)}{monthly&&r.payments.length>0?` · ${date([...r.payments].sort((a,b)=>b.paid_at.localeCompare(a.paid_at))[0].paid_at)}`:""}</span>}{r.remaining>0&&r.received>0&&<span className="text-xs font-normal">Saldo {money(r.remaining)}</span>}</Button>)??<span className="text-muted-foreground">—</span>}</td>)}{[summary.expected,summary.received,summary.pending].map((value,i)=><td key={i} className="border-b px-3 py-3 text-right font-medium tabular-nums">{money(value)}</td>)}</tr>;
   })}</tbody>
   <tfoot className="bg-muted font-semibold"><tr><th className="sticky left-0 z-10 border-t bg-muted px-3 py-3">Totais do mês</th><td className="border-t"/>{columns.map(i=>{const s=receiptSummary(groups.flatMap(g=>g.cells[i]??[]));return <td key={i} className="border-t px-3 py-3 text-xs"><div>Previsto {money(s.expected)}</div><div className="mt-1">Recebido {money(s.received)}</div><div className="mt-1">Pendente {money(s.pending)}</div><div className="mt-1">Atrasado {money(s.overdue)}</div></td>;})}{[total.expected,total.received,total.pending].map((value,i)=><td key={i} className="border-t px-3 py-3 text-right tabular-nums">{money(value)}</td>)}</tr></tfoot>
  </table></div>:<p className="py-8 text-center text-sm text-muted-foreground">Nenhuma cobrança cadastrada neste período.</p>}
  <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm"><span>Total previsto <strong>{money(total.expected)}</strong></span><span>Total recebido <strong>{money(total.received)}</strong></span><span>Total pendente <strong>{money(total.pending)}</strong></span><span>Total atrasado <strong>{money(total.overdue)}</strong></span></div>
 </section>;
}