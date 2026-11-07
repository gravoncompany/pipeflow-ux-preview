import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileSpreadsheet } from "lucide-react";
import { saveReceiptSchedule } from "@/lib/receipt-control.functions";
import type { ReceiptConfig } from "@/lib/receipt-control";
import { buildImportRows, parseCsvText, type ImportRow } from "@/lib/receipt-import";
import { currency } from "@/lib/revenue";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Client = { id: string; trade_name: string };
type Schedule = { id: string; client_id: string; config: ReceiptConfig };
type Match = { row: ImportRow; client: Client | null; duplicate: boolean; selected: boolean };

const normName = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Importar planilha financeira (Excel ou CSV): identifica colunas, reconhece clientes existentes
 * e apresenta prévia antes de salvar. Duplicados e clientes não encontrados exigem revisão. */
export function ReceiptImportDialog({ clients, schedules, year, onClose }: { clients: Client[]; schedules: Schedule[]; year: number; onClose: () => void }) {
 const fn = useServerFn(saveReceiptSchedule), qc = useQueryClient();
 const [matches, setMatches] = useState<Match[] | null>(null), [confirmed, setConfirmed] = useState(false), [result, setResult] = useState(""), [fileName, setFileName] = useState("");
 const byName = useMemo(() => { const m = new Map<string, Client>(); for (const c of clients) { const k = normName(c.trade_name); if (k && !m.has(k)) m.set(k, c); } return m; }, [clients]);
 const readFile = async (file: File) => {
  setResult(""); setConfirmed(false); setFileName(file.name);
  let matrix: string[][];
  if (/\.(xlsx|xls)$/i.test(file.name)) {
   const XLSX = await import("xlsx");
   const book = XLSX.read(await file.arrayBuffer());
   const sheet = book.Sheets[book.SheetNames[0]];
   matrix = (XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }) as unknown[][]).map(r => r.map(c => String(c ?? "")));
  } else {
   matrix = parseCsvText(await file.text());
  }
  const { rows } = buildImportRows(matrix, year);
  setMatches(rows.map(row => {
   const client = byName.get(normName(row.cliente)) ?? null;
   const duplicate = !!client && schedules.some(s => s.client_id === client.id && normName(s.config.description) === normName(row.descricao));
   return { row, client, duplicate, selected: false };
  }));
 };
 const selectable = (matches ?? []).filter(m => m.client && !m.duplicate && !m.row.problemas.length);
 const chosen = selectable.filter(m => m.selected);
 const mutation = useMutation({
  mutationFn: async () => {
   let created = 0; const errors: string[] = [];
   for (const m of chosen) {
    const config: ReceiptConfig = { description: m.row.descricao, amount: m.row.valor, frequency: m.row.frequencia === "quinzenal" ? "quinzenal_fixa" : (m.row.frequencia as ReceiptConfig["frequency"]), start: m.row.inicio, end: m.row.fim, day1: m.row.dia, day2: m.row.dia2, method: "" };
    try { await fn({ data: { id: null, revision: 0, clientId: m.client!.id, projectId: null, config, generate: true, operation: crypto.randomUUID(), confirmed: true } }); created++; }
    catch (e) { errors.push(`${m.row.cliente}: ${e instanceof Error ? e.message : "falha"}`); }
   }
   return { created, errors };
  },
  onSuccess: async r => { setResult(`${r.created} configuração(ões) importada(s) com as cobranças do período.${r.errors.length ? ` Falhas: ${r.errors.join(" · ")}` : ""}`); await qc.invalidateQueries({ queryKey: ["receipt-control"] }); await qc.invalidateQueries({ queryKey: ["finance-management"] }); },
 });
 return <Dialog open onOpenChange={v => { if (!v) onClose(); }}><DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="size-5 text-primary" />Importar planilha financeira</DialogTitle><DialogDescription>Arquivos Excel (.xlsx) ou CSV. A prévia abaixo precisa ser revisada antes de salvar; clientes não reconhecidos e possíveis duplicidades ficam de fora.</DialogDescription></DialogHeader>
 <input type="file" accept=".csv,.xlsx,.xls" aria-label="Arquivo da planilha financeira" className="text-sm" onChange={e => { const f = e.target.files?.[0]; if (f) void readFile(f); }} />
 {result && <p role="status" className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">{result}</p>}
 {matches && !result && <>
  <p className="text-sm">{fileName}: {matches.length} linha(s) lidas · {selectable.length} prontas · {matches.length - selectable.length} precisam de revisão.</p>
  <div className="max-h-72 overflow-auto rounded-md border"><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-muted"><tr><th className="px-3 py-2" /><th className="px-3 py-2">Cliente</th><th className="px-3 py-2">Descrição</th><th className="px-3 py-2">Valor</th><th className="px-3 py-2">Frequência</th><th className="px-3 py-2">Vencimento</th><th className="px-3 py-2">Situação</th></tr></thead><tbody>
   {matches.map((m, i) => {
    const ready = m.client && !m.duplicate && !m.row.problemas.length;
    const situation = !m.client ? "Cliente não cadastrado — revise" : m.duplicate ? "Configuração já existe — revisão" : m.row.problemas.length ? m.row.problemas.join("; ") : "Pronta";
    return <tr key={i} className="border-t align-top"><td className="px-3 py-2">{ready && <Checkbox aria-label={`Selecionar linha ${m.row.line}`} checked={m.selected} onCheckedChange={v => setMatches(ms => ms!.map((x, j) => j === i ? { ...x, selected: v === true } : x))} />}</td><td className="px-3 py-2">{m.row.cliente}{m.client && <span className="block text-xs text-muted-foreground">→ {m.client.trade_name}</span>}</td><td className="px-3 py-2">{m.row.descricao}</td><td className="px-3 py-2 tabular-nums">{m.row.valor ? currency(m.row.valor / 100) : "—"}</td><td className="px-3 py-2">{m.row.frequencia || "—"}</td><td className="px-3 py-2">{m.row.frequencia === "semanal" ? "Semanal" : `Dia ${m.row.dia}${m.row.frequencia === "quinzenal" ? ` e ${m.row.dia2}` : ""}`}</td><td className="px-3 py-2 text-xs">{situation}</td></tr>;
   })}
  </tbody></table></div>
  {selectable.length > 0 && <Button variant="outline" size="sm" onClick={() => setMatches(ms => ms!.map(m => selectable.includes(m) ? { ...m, selected: true } : m))}>Selecionar todas as prontas</Button>}
  <label className="flex gap-2 text-sm"><Checkbox checked={confirmed} onCheckedChange={v => setConfirmed(v === true)} />Revisei a prévia e confirmo o cadastro das {chosen.length} linha(s) selecionadas.</label>
  {mutation.error && <p role="alert" className="text-sm text-destructive">{mutation.error.message}</p>}
  <Button disabled={!chosen.length || !confirmed || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "Importando…" : `Importar ${chosen.length} configuração(ões)`}</Button>
 </>}
 </DialogContent></Dialog>;
}
