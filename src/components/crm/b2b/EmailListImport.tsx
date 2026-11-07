import { useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Upload, ClipboardPaste, LayoutGrid, List, Trash2, Pencil, Search, Loader2, Mail, Phone, Globe, User } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { importB2b } from "@/lib/b2b-prospecting.functions";
import { LIST_FIELDS, guessColumns, parseDelimited, rowsFromTable, toCompanyInput, validateRows, type ColumnMap, type ListRow } from "@/lib/b2b-email-list";

const selectClass = "h-9 w-full rounded-md border bg-background px-2 text-sm";
type Pipeline = { id: string; name: string };
type Outcome = { created: number; duplicate: number; failed: number };

/** "Importar lista de e-mails" origin of B2B prospecting: same left-config / right-results layout as the Maps search. Never creates cards until the user confirms. */
export function EmailListImport({ pipelines }: { pipelines: Pipeline[] }) {
  const importFn = useServerFn(importB2b);
  const fileRef = useRef<HTMLInputElement>(null);
  const [table, setTable] = useState<string[][] | null>(null), [label, setLabel] = useState(""), [map, setMap] = useState<ColumnMap>({}), [hasHeader, setHasHeader] = useState(true);
  const [paste, setPaste] = useState(""), [rows, setRows] = useState<ListRow[]>([]), [sel, setSel] = useState<string[]>([]);
  const [q, setQ] = useState(""), [filter, setFilter] = useState<"todas" | "validas" | "pendentes" | "duplicadas">("todas"), [view, setView] = useState<"cards" | "list">("cards");
  const [edit, setEdit] = useState<ListRow | null>(null), [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [outcome, setOutcome] = useState<Outcome | null>(null);
  const outbound = pipelines.find(p => p.name.trim().toLowerCase() === "outbound");
  const [pipelineId, setPipelineId] = useState(outbound?.id ?? "main");
  const status = useMemo(() => validateRows(rows), [rows]);
  const term = q.trim().toLowerCase();
  const visible = rows.filter(r => {
    const s = status[r.key];
    if (filter === "validas" && !s?.ok) return false;
    if (filter === "pendentes" && !s?.issues.length) return false;
    if (filter === "duplicadas" && !s?.duplicateOf) return false;
    return !term || [r.name, ...r.emails, r.contactName, r.city].some(v => v.toLowerCase().includes(term));
  });
  const selectedValid = rows.filter(r => sel.includes(r.key) && status[r.key]?.ok);

  function load(t: string[][], name: string) {
    if (!t.length) { toast.error("Nenhuma linha encontrada."); return; }
    const g = guessColumns(t);
    setTable(t); setLabel(name); setMap(g.map); setHasHeader(g.hasHeader); setOutcome(null);
  }
  async function onFile(f: File) {
    try {
      if (/\.xlsx$/i.test(f.name)) {
        const { readSheet } = await import("read-excel-file/browser");
        const data = await readSheet(f);
        load(data.map(r => r.map(c => (c === null || c === undefined ? "" : c instanceof Date ? c.toISOString().slice(0, 10) : String(c)).trim())).filter(r => r.some(Boolean)), f.name);
      } else if (/\.(csv|txt)$/i.test(f.name)) load(parseDelimited(await f.text()), f.name);
      else toast.error("Use um arquivo .csv ou .xlsx.");
    } catch { toast.error("Não foi possível ler o arquivo."); }
  }
  function applyMapping() {
    if (!table) return;
    if (map.name === undefined || map.email === undefined) { toast.error("Indique as colunas de nome da empresa e e-mail."); return; }
    const added = rowsFromTable(table, map, hasHeader);
    setRows(old => [...old, ...added]); setSel(old => [...old, ...added.map(r => r.key)]); setTable(null);
    toast.success(`${added.length} empresa(s) adicionadas para revisão. Nada foi cadastrado no CRM.`);
  }
  async function addToCrm() {
    setBusy(true); const res: Outcome = { created: 0, duplicate: 0, failed: 0 }; const done: string[] = [];
    for (let i = 0; i < selectedValid.length; i += 20) {
      const batch = selectedValid.slice(i, i + 20);
      try {
        const r = await importFn({ data: { pipelineId: pipelineId === "main" ? null : pipelineId, confirmed: true, companies: batch.map(b => toCompanyInput(b, label || "lista colada")) } });
        for (const x of r) x.status === "created" ? res.created++ : res.duplicate++;
        done.push(...batch.map(b => b.key));
      } catch { res.failed += batch.length; }
    }
    setRows(old => old.filter(r => !done.includes(r.key))); setSel(old => old.filter(k => !done.includes(k)));
    setOutcome(res); setConfirm(false); setBusy(false);
  }

  return <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_1fr]">
    <section className="space-y-4 rounded-xl border bg-card p-4 md:p-5" aria-label="Importar lista de e-mails">
      <div><h2 className="font-semibold">Importar lista de e-mails</h2><p className="text-xs text-muted-foreground">Obrigatórios: nome da empresa e e-mail. Nada é cadastrado nem enviado nesta etapa.</p></div>
      <input ref={fileRef} type="file" accept=".csv,.txt,.xlsx" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }} />
      <Button className="w-full" variant="outline" onClick={() => fileRef.current?.click()}><Upload className="size-4" />Importar CSV ou Excel (.xlsx)</Button>
      <div className="space-y-2">
        <Label htmlFor="b2b-paste">Ou cole a lista</Label>
        <Textarea id="b2b-paste" rows={5} value={paste} onChange={e => setPaste(e.target.value)} placeholder={"Empresa;E-mail;Telefone\nClínica Sorriso;contato@sorriso.com.br;41999990000"} />
        <Button size="sm" variant="secondary" disabled={!paste.trim()} onClick={() => { load(parseDelimited(paste), "lista colada"); setPaste(""); }}><ClipboardPaste className="size-4" />Ler lista colada</Button>
      </div>
      {table && <div className="space-y-2 rounded-md border p-3">
        <p className="text-sm font-medium">Colunas de “{label}” ({table.length - (hasHeader ? 1 : 0)} linhas)</p>
        <label className="flex items-center gap-2 text-xs"><Checkbox checked={hasHeader} onCheckedChange={v => setHasHeader(v === true)} />A primeira linha é cabeçalho</label>
        {LIST_FIELDS.map(f => <div key={f.id} className="grid grid-cols-[1fr_1.2fr] items-center gap-2 text-xs">
          <span>{f.label}{"required" in f && f.required ? " *" : ""}</span>
          <select aria-label={`Coluna para ${f.label}`} className={selectClass} value={map[f.id] ?? ""} onChange={e => setMap({ ...map, [f.id]: e.target.value === "" ? undefined : Number(e.target.value) })}>
            <option value="">— não usar —</option>
            {(table[0] ?? []).map((h, i) => <option key={i} value={i}>{hasHeader ? h || `Coluna ${i + 1}` : `Coluna ${i + 1} (${h.slice(0, 20)})`}</option>)}
          </select>
        </div>)}
        <div className="flex gap-2"><Button size="sm" onClick={applyMapping}>Usar estas colunas</Button><Button size="sm" variant="ghost" onClick={() => setTable(null)}>Cancelar</Button></div>
      </div>}
      <div className="space-y-1">
        <Label htmlFor="b2b-list-pipe">Funil de destino</Label>
        <select id="b2b-list-pipe" className={selectClass} value={pipelineId} onChange={e => setPipelineId(e.target.value)}>
          <option value="main">Pipeline original</option>
          {pipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <p className="text-xs text-muted-foreground">Os cards entram na primeira etapa. Empresas já existentes no CRM (mesmo e-mail, telefone ou nome) são ignoradas.</p>
      </div>
      {outcome && <p role="status" className="rounded-md border border-primary/40 p-3 text-sm">{outcome.created} card(s) criado(s), {outcome.duplicate} já existia(m) no CRM{outcome.failed ? `, ${outcome.failed} com falha (continuam na lista)` : ""}. Nenhum e-mail foi enviado.</p>}
    </section>

    <section className="space-y-4" aria-label="Empresas importadas">
      <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold">Resultados <span className="text-sm font-normal text-muted-foreground">· Lista importada ({rows.length})</span></h2>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Modo de visualização" className="flex overflow-hidden rounded-md border">
            <Button variant={view === "cards" ? "default" : "ghost"} size="sm" className="rounded-none" aria-pressed={view === "cards"} onClick={() => setView("cards")}><LayoutGrid className="size-4" />Cards</Button>
            <Button variant={view === "list" ? "default" : "ghost"} size="sm" className="rounded-none" aria-pressed={view === "list"} onClick={() => setView("list")}><List className="size-4" />Lista</Button>
          </div>
          <Button size="sm" variant="outline" disabled={!visible.length} onClick={() => setSel(old => [...new Set([...old, ...visible.map(r => r.key)])])}>Selecionar visíveis ({visible.length})</Button>
          <Button size="sm" variant="ghost" disabled={!sel.length} onClick={() => setSel([])}>Limpar seleção</Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1"><Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" /><Input className="pl-8" placeholder="Pesquisar empresa, e-mail, responsável ou cidade" value={q} onChange={e => setQ(e.target.value)} /></div>
        <select aria-label="Filtrar por validação" className={`${selectClass} w-44`} value={filter} onChange={e => setFilter(e.target.value as typeof filter)}>
          <option value="todas">Todas</option><option value="validas">Prontas</option><option value="pendentes">Precisam de correção</option><option value="duplicadas">Duplicadas na lista</option>
        </select>
      </div>
      {!rows.length ? <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Importe um arquivo ou cole uma lista para revisar as empresas aqui.</p>
        : <div className={view === "cards" ? "grid gap-3 sm:grid-cols-2 xl:grid-cols-3" : "divide-y rounded-xl border bg-card"}>
          {visible.map(r => {
            const s = status[r.key], on = sel.includes(r.key);
            const badge = s?.duplicateOf ? <Badge variant="outline">Duplicada na lista</Badge> : s?.issues.length ? <Badge variant="destructive">Corrigir</Badge> : <Badge variant="secondary">Pronta</Badge>;
            const actions = <div className="flex gap-1"><Button size="icon" variant="ghost" aria-label={`Editar ${r.name}`} onClick={() => setEdit({ ...r })}><Pencil className="size-4" /></Button><Button size="icon" variant="ghost" aria-label={`Excluir ${r.name}`} onClick={() => { setRows(o => o.filter(x => x.key !== r.key)); setSel(o => o.filter(k => k !== r.key)); }}><Trash2 className="size-4" /></Button></div>;
            const info = <>
              <p className="flex items-center gap-1 break-all text-xs"><Mail className="size-3 shrink-0" />{r.emails.join(", ") || "—"}</p>
              {r.phone && <p className="flex items-center gap-1 text-xs text-muted-foreground"><Phone className="size-3" />{r.phone}</p>}
              {r.website && <p className="flex items-center gap-1 break-all text-xs text-muted-foreground"><Globe className="size-3" />{r.website}</p>}
              {r.contactName && <p className="flex items-center gap-1 text-xs text-muted-foreground"><User className="size-3" />{r.contactName}{r.contactRole ? ` · ${r.contactRole}` : ""}</p>}
              {!!s?.issues.length && <p className="text-xs text-destructive">{s.issues.join(" · ")}</p>}
            </>;
            return view === "cards"
              ? <article key={r.key} className={`space-y-2 rounded-xl border bg-card p-4 ${on ? "ring-2 ring-primary" : ""}`}>
                <div className="flex items-start gap-2"><Checkbox checked={on} onCheckedChange={v => setSel(o => v === true ? [...o, r.key] : o.filter(k => k !== r.key))} aria-label={`Selecionar ${r.name}`} /><div className="min-w-0 flex-1"><h3 className="truncate font-medium">{r.name || "Sem nome"}</h3><p className="text-xs text-muted-foreground">Origem: Lista importada{r.city ? ` · ${r.city}${r.state ? `/${r.state}` : ""}` : ""}</p></div>{badge}</div>
                {info}{actions}
              </article>
              : <div key={r.key} className="flex items-start gap-3 p-3">
                <Checkbox checked={on} onCheckedChange={v => setSel(o => v === true ? [...o, r.key] : o.filter(k => k !== r.key))} aria-label={`Selecionar ${r.name}`} />
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{r.name || "Sem nome"} <span className="text-xs font-normal text-muted-foreground">· Lista importada</span></p>{info}</div>{badge}{actions}
              </div>;
          })}
        </div>}
      {rows.length > 0 && <div className="sticky bottom-0 flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3 text-sm">
        <b>{sel.length} selecionada(s)</b><span className="text-muted-foreground">· {selectedValid.length} pronta(s) para o CRM</span>
        <Button className="ml-auto" disabled={!selectedValid.length || busy} onClick={() => setConfirm(true)}>Revisar e adicionar ao CRM</Button>
      </div>}
    </section>

    <Dialog open={!!edit} onOpenChange={v => { if (!v) setEdit(null); }}><DialogContent>
      <DialogHeader><DialogTitle>Editar empresa</DialogTitle><DialogDescription>Corrija os dados antes do cadastro.</DialogDescription></DialogHeader>
      {edit && <div className="grid gap-2 sm:grid-cols-2">
        {([["name", "Nome da empresa *"], ["emails", "E-mails * (separe por vírgula)"], ["phone", "Telefone"], ["website", "Site"], ["contactName", "Responsável"], ["contactRole", "Cargo"], ["cnpj", "CNPJ"], ["city", "Cidade"], ["state", "Estado (UF)"], ["notes", "Observações"]] as const).map(([k, l]) => <div key={k} className={k === "notes" ? "sm:col-span-2" : ""}>
          <Label className="text-xs">{l}</Label>
          <Input value={k === "emails" ? edit.emails.join(", ") : edit[k]} onChange={e => setEdit({ ...edit, ...(k === "emails" ? { emails: e.target.value.split(/[,;\s]+/).map(x => x.trim().toLowerCase()).filter(Boolean) } : { [k]: k === "state" ? e.target.value.toUpperCase() : e.target.value }) })} />
        </div>)}
      </div>}
      <DialogFooter><Button variant="ghost" onClick={() => setEdit(null)}>Cancelar</Button><Button onClick={() => { if (edit) setRows(o => o.map(r => r.key === edit.key ? edit : r)); setEdit(null); }}>Salvar</Button></DialogFooter>
    </DialogContent></Dialog>

    <Dialog open={confirm} onOpenChange={v => { if (!busy) setConfirm(v); }}><DialogContent>
      <DialogHeader><DialogTitle>Adicionar ao CRM</DialogTitle><DialogDescription>
        {selectedValid.length} empresa(s) serão cadastradas no funil {pipelineId === "main" ? "Pipeline original" : pipelines.find(p => p.id === pipelineId)?.name}, na primeira etapa. Vários e-mails ficam no mesmo card. Empresas já existentes são ignoradas e nenhum e-mail é enviado.
      </DialogDescription></DialogHeader>
      <ul className="max-h-60 divide-y overflow-y-auto text-sm">{selectedValid.map(r => <li key={r.key} className="py-1.5"><b>{r.name}</b> <span className="text-muted-foreground">· {r.emails.join(", ")}</span></li>)}</ul>
      <p className="text-xs text-muted-foreground">Confirmo que revisei estes dados, que a lista tem origem legítima e que pedidos de descadastro serão respeitados.</p>
      <DialogFooter><Button variant="ghost" disabled={busy} onClick={() => setConfirm(false)}>Cancelar</Button><Button disabled={busy} onClick={() => void addToCrm()}>{busy && <Loader2 className="size-4 animate-spin" />}Confirmar e cadastrar</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
}
