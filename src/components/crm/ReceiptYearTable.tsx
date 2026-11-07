import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { receiptSummary, receiptYearGrid, type ReceiptRow } from "@/lib/receipt-control";
import { matchReceiptClient, type SheetClient } from "@/lib/receipt-sheet";
import { currency } from "@/lib/revenue";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const money = (cents: number) => currency(cents / 100);
// Célula com leitura imediata: valor + marcador de situação (cor e símbolo, não só cor).
function YearCell({ cell, received }: { cell: ReceiptRow[]; received: number }) {
 if (!cell.length) return <span className="text-muted-foreground">—</span>;
 const s = receiptSummary(cell);
 const state = s.pending === 0 ? "pago" : s.overdue > 0 ? "atrasado" : received > 0 ? "parcial" : cell.some(r => r.statusLabel === "conciliacao") ? "conciliacao" : "pendente";
 const mark = { pago: ["✓", "text-success"], atrasado: ["!", "text-destructive"], parcial: ["◐", "text-receipt-partial"], conciliacao: ["⇄", "text-muted-foreground"], pendente: ["○", "text-receipt-pending"] }[state];
 const value = state === "pago" || state === "parcial" ? received : s.pending;
 return <span className={`inline-flex items-center gap-1 ${state === "pendente" || state === "conciliacao" ? "text-muted-foreground" : state === "atrasado" ? "font-medium text-destructive" : ""}`} title={state === "atrasado" ? `Atrasado: ${money(s.overdue)} em aberto` : state === "parcial" ? `Recebido ${money(received)} de ${money(s.expected)}` : undefined}><span aria-hidden className={`font-bold ${mark[1]}`}>{mark[0]}</span>{money(value)}</span>;
}
export function ReceiptYearTable({ title, recurrence, year, allRows, rows, names, onDetail, roster = [], clients = [], onConfigure, search = "", clientFilter = "all", statusFilter = "all" }: { title: string; recurrence: string; year: number; allRows: ReceiptRow[]; rows: ReceiptRow[]; names: Map<string, string>; onDetail: (id: string) => void; roster?: SheetClient[]; clients?: { id: string; trade_name: string }[]; onConfigure?: (id: string) => void; search?: string; clientFilter?: string; statusFilter?: string }) {
 const [choices, setChoices] = useState<Record<number, string>>({});
 const grid = receiptYearGrid(allRows, year, recurrence), visible = new Set(rows.map(r => r.id));
 const source = roster.map(s => {
  const id = choices[s.row] || matchReceiptClient(s.name, clients)?.id || "";
  const cells = Array.from({ length: 12 }, (_, i) => allRows.filter(r => r.client_id === id && r.due_date.startsWith(`${year}-${String(i + 1).padStart(2, "0")}-`) && visible.has(r.id)));
  return { key: `sheet:${s.row}`, clientId: id, name: s.name, service: s.service, amount: s.amount, due: s.date, cells, sheet: s };
 });
 const covered = new Set(source.map(s => s.clientId).filter(Boolean));
 const extra = grid.groups.filter(g => !covered.has(g.clientId)).map(g => ({ key: g.clientId, clientId: g.clientId, name: names.get(g.clientId) ?? "Cliente", service: [...new Set(g.cells.flat().map(r => r.description))].join(" · "), amount: g.cells.flat()[0]?.amountCents ?? null, due: "", cells: g.cells.map(c => c.filter(r => visible.has(r.id))), sheet: null }));
 const groups = [...source, ...extra].filter(g => (clientFilter === "all" || g.clientId === clientFilter) && (!search || `${g.name} ${g.service}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) && (statusFilter === "all" || g.cells.some(c => c.length)));
 const total = receiptSummary(groups.flatMap(g => g.cells.flat()));
 return <section className="border-t py-5" aria-label={title}>
  <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">{title}</h2><span className="text-xs text-muted-foreground">{groups.length} clientes · {year}</span></div>
  <div className="max-h-[65dvh] max-w-full overflow-auto border"><table className="w-full min-w-[1800px] border-separate border-spacing-0 text-xs">
   <thead className="sticky top-0 z-20 bg-muted"><tr>{["Nome do cliente", "Serviços", "Valor devido", "Data", ...MONTHS, "Total recebido"].map((h, i) => <th key={h} className={`border-b border-r px-2 py-2 text-left font-semibold ${i === 0 ? "sticky left-0 z-30 min-w-48 bg-muted" : i === 1 ? "min-w-40" : "min-w-24"}`}>{h}</th>)}</tr></thead>
   <tbody>{groups.map(g => <tr key={g.key} className="group align-middle">
    <th className="sticky left-0 z-10 border-b border-r bg-background px-2 py-2 text-left font-medium">{g.clientId ? <Link to="/clientes/$id" params={{ id: g.clientId }} search={{ aba: undefined }} className="text-primary">{g.name}</Link> : <span>{g.name}</span>}{!g.clientId && <Select value={choices[g.sheet?.row ?? 0] ?? ""} onValueChange={v => setChoices(c => ({ ...c, [g.sheet?.row ?? 0]: v }))}><SelectTrigger className="mt-1 h-7 w-44 text-xs" aria-label={`Identificar cliente ${g.name}`}><SelectValue placeholder="Conferir vínculo" /></SelectTrigger><SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.trade_name}</SelectItem>)}</SelectContent></Select>}</th>
    <td className="border-b border-r px-2 py-2 text-muted-foreground">{g.service || "—"}</td><td className="border-b border-r px-2 py-2 text-right tabular-nums">{g.amount ? money(g.amount) : "—"}</td><td className="border-b border-r px-2 py-2 text-center">{g.due || "—"}</td>
    {g.cells.map((cell, i) => { const received = receiptSummary(cell).received; return <td key={i} className="border-b border-r p-0 text-right tabular-nums"><Button variant="ghost" className="h-9 w-full justify-end rounded-none px-2 text-xs font-normal" aria-label={`Pagamento de ${g.name} em ${MONTHS[i]} de ${year}`} disabled={!g.clientId} title={cell.length ? "Consultar ou registrar pagamento" : "Configurar recebimento"} onClick={() => { if (cell[0]) onDetail(cell[0].id); else if (g.clientId) onConfigure?.(g.clientId); }}><YearCell cell={cell} received={received} /></Button></td>; })}
    <td className="border-b px-2 py-2 text-right font-semibold tabular-nums">{money(receiptSummary(g.cells.flat()).received)}</td>
   </tr>)}</tbody>
   <tfoot className="sticky bottom-0 z-20 bg-muted font-semibold"><tr><th className="sticky left-0 border-r bg-muted px-2 py-2 text-left">Total recebido</th><td colSpan={3} className="border-r" />{MONTHS.map((m, i) => <td key={m} className="border-r px-2 py-2 text-right tabular-nums">{money(receiptSummary(groups.flatMap(g => g.cells[i])).received)}</td>)}<td className="px-2 py-2 text-right tabular-nums">{money(total.received)}</td></tr></tfoot>
  </table></div>
  {!groups.length && <p className="py-5 text-sm text-muted-foreground">Nenhum cliente neste filtro.</p>}
 </section>;
}
