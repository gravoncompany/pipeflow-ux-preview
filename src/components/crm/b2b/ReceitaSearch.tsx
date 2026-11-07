import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Search, RotateCcw, ChevronLeft, ChevronRight, ClipboardCheck, Landmark, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { getReceitaStatus, searchReceita, completeReceitaLegalNames } from "@/lib/receita-federal.functions";
import { RECEITA_STATUS, receitaSearch, receitaRowHasEmail, receitaRowHasPhone, type ReceitaRow, type ReceitaSearch, type receitaResponse } from "@/lib/receita-federal";
import { searchReceitaCnaes, receitaCnaeDescription } from "@/lib/receita-cnae";
import { searchReceitaMunicipios, receitaMunicipioName } from "@/lib/receita-municipios";
import type { z } from "zod";

function CnaePicker({ selected, onChange }: { selected: string[]; onChange: (codes: string[]) => void }) {
  const [term, setTerm] = useState(""), [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const suggestions = useMemo(() => searchReceitaCnaes(term).filter(s => !selected.includes(s.code)), [term, selected]);
  function add(code: string) { if (!selected.includes(code) && selected.length < 20) onChange([...selected, code]); setTerm(""); setOpen(false); }
  return <div ref={box} className="relative">
    <div className="flex min-h-10 flex-wrap items-center gap-1 rounded-md border bg-background px-2 py-1">
      {selected.map(code => <span key={code} className="flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs">
        {code} · {receitaCnaeDescription(code) || "CNAE"}
        <button type="button" aria-label={`Remover CNAE ${code}`} onClick={() => onChange(selected.filter(c => c !== code))}><X className="size-3" /></button>
      </span>)}
      <input aria-label="Buscar CNAE por atividade" className="min-w-32 flex-1 bg-transparent px-1 py-1 text-sm outline-none" placeholder={selected.length ? "" : "Digite a atividade, ex.: refrigeração"} value={term}
        onChange={e => { setTerm(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)} />
    </div>
    {open && suggestions.length > 0 && <ul role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover shadow-md">
      {suggestions.map(s => <li key={s.code}><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted" onMouseDown={e => { e.preventDefault(); add(s.code); }}>
        <span className="font-medium">{s.code}</span> · {s.description}
      </button></li>)}
    </ul>}
    {open && term.trim().length >= 2 && !suggestions.length && <p className="absolute z-20 mt-1 w-full rounded-md border bg-popover px-3 py-2 text-xs text-muted-foreground shadow-md">Nenhum CNAE encontrado para “{term.trim()}”.</p>}
  </div>;
}

function MunicipalityPicker({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const [term, setTerm] = useState(() => receitaMunicipioName(value) || value), [open, setOpen] = useState(false);
  const suggestions = useMemo(() => searchReceitaMunicipios(term), [term]);
  const currentName = receitaMunicipioName(value);
  return <div className="relative">
    <Input aria-label="Município" placeholder="Digite o nome, ex.: Balneário Camboriú" value={term} maxLength={80}
      onChange={e => { setTerm(e.target.value); setOpen(true); if (!e.target.value.trim()) onChange(""); }}
      onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => { setOpen(false); if (value && currentName) setTerm(currentName); }, 150)} />
    {open && suggestions.length > 0 && <ul role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover shadow-md">
      {suggestions.map(m => <li key={m.code}><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted" onMouseDown={e => { e.preventDefault(); onChange(m.code); setTerm(m.name); setOpen(false); }}>{m.name}</button></li>)}
    </ul>}
    {value && currentName && term !== currentName && <p className="mt-1 text-xs text-muted-foreground">Selecionado: {currentName}</p>}
  </div>;
}

export function ReceitaSearchPanel({ onReview }: { onReview: (rows: ReceitaRow[], competence: string | null) => void }) {
  const statusFn = useServerFn(getReceitaStatus), searchFn = useServerFn(searchReceita), completeFn = useServerFn(completeReceitaLegalNames);
  const status = useQuery({ queryKey: ["receita-status"], queryFn: () => statusFn(), retry: false });
  const [filters, setFilters] = useState<ReceitaSearch>(() => receitaSearch.parse({}));
  const [result, setResult] = useState<z.infer<typeof receitaResponse> | null>(null);
  const [selected, setSelected] = useState<Record<string, ReceitaRow>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [confirmSearch, setConfirmSearch] = useState(false);
  const [query, setQuery] = useState<ReceitaSearch | null>(null);
  const [completing, setCompleting] = useState(false);
  const completionGen = useRef(0);
  /** Completa razões sociais ausentes pela fonte pública gratuita (cache de 24 h), sem DeskData. */
  async function completeLegalNames(data: z.infer<typeof receitaResponse>) {
    const missing = data.rows.filter(r => !r.razao_social).map(r => r.cnpj).slice(0, 20);
    if (!missing.length) return;
    const gen = completionGen.current;
    setCompleting(true);
    try {
      for (let i = 0; i < missing.length; i += 5) {
        if (gen !== completionGen.current) return;
        const out = await completeFn({ data: { cnpjs: missing.slice(i, i + 5) } });
        if (gen !== completionGen.current) return;
        const names = out.names;
        if (!Object.keys(names).length) continue;
        setResult(old => old ? { ...old, rows: old.rows.map(r => names[r.cnpj] ? { ...r, razao_social: names[r.cnpj] } : r) } : old);
        setSelected(old => Object.fromEntries(Object.entries(old).map(([k, r]) => [k, names[r.cnpj] ? { ...r, razao_social: names[r.cnpj] } : r])));
      }
    } catch { /* fonte pública indisponível: mantém "Não informado" */ }
    finally { if (gen === completionGen.current) setCompleting(false); }
  }
  async function search(page = 1, confirmed = false) {
    if (busy) return;
    if (page === 1 && Object.keys(selected).length && !confirmed) { setConfirmSearch(true); return; }
    const parsed = receitaSearch.safeParse({ ...(page === 1 ? filters : query), page });
    if (!parsed.success) { setError(parsed.error.issues.map(i => i.message).join(" · ")); return; }
    setBusy(true); setError("");
    completionGen.current += 1; setCompleting(false);
    if (page === 1) { setSelected({}); setResult(null); }
    try { const data = await searchFn({ data: parsed.data }); setResult(data); setQuery(parsed.data); void completeLegalNames(data); }
    catch (e) { setError(e instanceof Error ? e.message : "Falha na consulta."); }
    finally { setBusy(false); setConfirmSearch(false); }
  }
  const rows = result?.rows ?? [], count = Object.keys(selected).length;
  // "Com e-mail"/"Com telefone" filtram os resultados já carregados, sem nova consulta.
  const visibleRows = rows.filter(r => (!filters.hasEmail || receitaRowHasEmail(r)) && (!filters.hasPhone || receitaRowHasPhone(r)));
  const all = visibleRows.length > 0 && visibleRows.every(r => selected[r.cnpj]);
  function toggle(row: ReceitaRow, checked: boolean) { setSelected(old => { const next = { ...old }; if (checked) next[row.cnpj] = row; else delete next[row.cnpj]; return next; }); }
  const municipioLabel = (row: ReceitaRow) => row.municipio || receitaMunicipioName(row.municipio_codigo) || (row.municipio_codigo ? `Código ${row.municipio_codigo}` : "Não informado");
  const cnaeLabel = (row: ReceitaRow) => {
    const desc = row.cnae_descricao || receitaCnaeDescription(row.cnae_principal);
    return desc ? `${row.cnae_principal} · ${desc}` : row.cnae_principal || "";
  };
  return <div className="space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-xl font-semibold"><Landmark className="size-5 text-primary" />Receita Federal</h2><p className="mt-1 text-sm text-muted-foreground">Estabelecimentos de Santa Catarina · Dados públicos</p></div><span className="rounded-md border px-3 py-1 text-xs text-muted-foreground">{status.isLoading ? "Verificando conexão…" : status.data?.connected ? "Conectado à VPS" : "Sem conexão com a VPS"}</span></header>
    {status.data && !status.data.connected && <p role="status" className="border-l-2 border-primary bg-muted p-3 text-sm">{status.data.error} Nenhum resultado fictício será apresentado.</p>}
    <form className="grid gap-4 border-b pb-5 sm:grid-cols-2 xl:grid-cols-3" onSubmit={e => { e.preventDefault(); void search(); }}>
      <div className="sm:col-span-2"><Label>Segmento — busca por atividade (CNAE)</Label><CnaePicker selected={filters.cnaes} onChange={codes => setFilters(old => ({ ...old, cnaes: codes }))} /></div>
      <div><Label htmlFor="receita-cnae">CNAE principal — código</Label><Input id="receita-cnae" maxLength={20} placeholder="Ex.: 86 ou 8610101" value={filters.cnae} onChange={e => setFilters(old => ({ ...old, cnae: e.target.value }))} /></div>
      <div><Label>Município</Label><MunicipalityPicker value={filters.municipality} onChange={code => setFilters(old => ({ ...old, municipality: code }))} /></div>
      {([["tradeName", "Nome fantasia"], ["legalName", "Razão social"], ["cnpj", "CNPJ"]] as const).map(([key, label]) => <div key={key}><Label htmlFor={`receita-${key}`}>{label}</Label><Input id={`receita-${key}`} maxLength={key === "cnpj" ? 30 : 150} value={filters[key]} onChange={e => setFilters(old => ({ ...old, [key]: e.target.value }))} /></div>)}
      <div><Label htmlFor="receita-uf">Estado</Label><select id="receita-uf" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={filters.uf} onChange={() => {}}><option value="SC">Santa Catarina</option></select></div>
      <div><Label htmlFor="receita-status">Situação cadastral</Label><select id="receita-status" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={filters.status} onChange={e => setFilters(old => ({ ...old, status: e.target.value as ReceitaSearch["status"] }))}><option value="">Todas</option>{Object.entries(RECEITA_STATUS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
      <div className="flex flex-wrap items-center gap-4"><label className="flex items-center gap-2 text-sm"><Checkbox checked={filters.hasPhone} onCheckedChange={v => setFilters(old => ({ ...old, hasPhone: v === true }))} />Com telefone</label><label className="flex items-center gap-2 text-sm"><Checkbox checked={filters.hasEmail} onCheckedChange={v => setFilters(old => ({ ...old, hasEmail: v === true }))} />Com e-mail</label></div>
      <div className="flex gap-2 sm:col-span-2 xl:col-span-3"><Button type="submit" disabled={busy || !status.data?.connected}><Search className="size-4" />{busy ? "Pesquisando…" : "Pesquisar"}</Button><Button type="button" variant="outline" onClick={() => { setFilters(receitaSearch.parse({})); setResult(null); setSelected({}); setError(""); }}><RotateCcw className="size-4" />Limpar filtros</Button></div>
    </form>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm">{result ? `${result.total.toLocaleString("pt-BR")} resultados` : "Resultados"}{visibleRows.length !== rows.length && ` · ${visibleRows.length} visíveis com os filtros`} · {count} selecionada(s){completing && " · Completando razões sociais…"}</p><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!visibleRows.length} onClick={() => setSelected(old => { const next = { ...old }; for (const row of visibleRows) if (all) delete next[row.cnpj]; else next[row.cnpj] = row; return next; })}>{all ? "Desmarcar visíveis" : "Selecionar visíveis"}</Button><Button size="sm" disabled={!count || busy} onClick={() => onReview(Object.values(selected), result?.competence ?? null)}><ClipboardCheck className="size-4" />Revisar Selecionadas ({count})</Button></div></div>
    <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[1000px] text-sm"><thead className="bg-muted text-left text-xs"><tr>{["", "Razão social", "Nome fantasia", "CNPJ", "CNAE principal", "Município / UF", "Telefone", "E-mail", "Situação", "Ações"].map((h, i) => <th key={i} className="px-3 py-3">{h || <Checkbox aria-label="Selecionar resultados visíveis" checked={all} disabled={!visibleRows.length} onCheckedChange={v => { for (const row of visibleRows) toggle(row, v === true); }} />}</th>)}</tr></thead><tbody>{visibleRows.map(row => <tr key={row.cnpj} className="border-t align-top"><td className="p-3"><Checkbox aria-label={`Selecionar CNPJ ${row.cnpj}`} checked={Boolean(selected[row.cnpj])} onCheckedChange={v => toggle(row, v === true)} /></td>{[row.razao_social, row.nome_fantasia, row.cnpj, cnaeLabel(row), `${municipioLabel(row)} / ${row.uf}`, row.telefone, row.email, RECEITA_STATUS[row.situacao_cadastral as keyof typeof RECEITA_STATUS] ?? row.situacao_cadastral].map((value, i) => <td key={i} className="max-w-64 break-words p-3">{value || <span className="text-muted-foreground">Não informado</span>}</td>)}<td className="p-3"><Button size="sm" variant="ghost" onClick={() => onReview([row], result?.competence ?? null)}>Revisar</Button></td></tr>)}{!visibleRows.length && <tr><td colSpan={10} className="p-10 text-center text-muted-foreground">{busy ? "Consultando estabelecimentos…" : rows.length ? "Nenhuma empresa visível com os filtros de contato." : result ? "Nenhuma empresa encontrada." : "Nenhuma consulta realizada."}</td></tr>}</tbody></table></div>
    {result && <footer className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"><p>Receita Federal · {result.competence ? `Competência ${result.competence} · ` : ""}Consultada em {new Date(result.updatedAt).toLocaleString("pt-BR")}</p><div className="flex items-center gap-2"><Button aria-label="Página anterior" size="icon" variant="outline" disabled={busy || result.page <= 1} onClick={() => void search(result.page - 1)}><ChevronLeft /></Button><span>Página {result.page} de {Math.max(1, Math.ceil(result.total / result.pageSize))}</span><Button aria-label="Próxima página" size="icon" variant="outline" disabled={busy || result.page >= 1000 || result.page * result.pageSize >= result.total} onClick={() => void search(result.page + 1)}><ChevronRight /></Button></div></footer>}
    <Dialog open={confirmSearch} onOpenChange={setConfirmSearch}><DialogContent><DialogHeader><DialogTitle>Substituir a pesquisa atual?</DialogTitle><DialogDescription>A nova pesquisa desmarca as empresas desta lista. Cadastros do CRM e empresas já encaminhadas à revisão permanecem intactos.</DialogDescription></DialogHeader><Button onClick={() => void search(1, true)}>Confirmar nova pesquisa</Button></DialogContent></Dialog>
  </div>;
}
