import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Search, Trash2, Users, User, Upload, Save, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { listWhatsAppGroups, listWhatsAppConversationContacts, listCampaignLists, saveCampaignList, deleteCampaignList } from "@/lib/campaigns.functions";
import { listPipelines } from "@/lib/pipelines.functions";
import { normalizeWhatsAppTarget } from "@/lib/phone";
import type { CampaignClient } from "@/lib/campaign-recipients";
import { parseRecipientCsv } from "@/lib/whatsapp-campaign-csv";
import { GroupPicker } from "./GroupPicker";

export type Lead = { id: string; name: string; company: string; whatsapp: string; pipeline_id: string | null; tags?: string[] | null };
export type Manual = { phone: string; name: string; company: string; source: string };
export type Group = { jid: string; name: string };
export type Selection = { kind: "individual" | "groups"; leadIds: string[]; clientIds: string[]; manual: Manual[]; groups: Group[] };

type Source = "crm" | "conversas" | "funis" | "etiquetas" | "clientes" | "listas" | "csv" | "manual" | "grupos";
const SOURCES: { id: Source; label: string; kind: "individual" | "groups" }[] = [
  { id: "crm", label: "Contatos do CRM", kind: "individual" },
  { id: "conversas", label: "Conversas do WhatsApp", kind: "individual" },
  { id: "funis", label: "Funis comerciais", kind: "individual" },
  { id: "etiquetas", label: "Etiquetas", kind: "individual" },
  { id: "clientes", label: "Clientes cadastrados", kind: "individual" },
  { id: "listas", label: "Listas salvas", kind: "individual" },
  { id: "csv", label: "Importação por CSV", kind: "individual" },
  { id: "manual", label: "Inserção manual", kind: "individual" },
  { id: "grupos", label: "Grupos do WhatsApp", kind: "groups" },
];

const tagsOf = (t: unknown): string[] => Array.isArray(t) ? t.map(x => typeof x === "string" ? x : String((x as { name?: unknown })?.name ?? "")).filter(Boolean) : [];

type Row = { key: string; name: string; id: string; source: string; status: string; ok: boolean; remove: () => void };

export function RecipientsStep({ value, onChange, leads, clients, instance }: { value: Selection; onChange: (s: Selection) => void; leads: Lead[]; clients: CampaignClient[] | null; instance: string }) {
  const [source, setSource] = useState<Source>(value.kind === "groups" ? "grupos" : "crm");
  const [q, setQ] = useState(""), [selQ, setSelQ] = useState(""), [pipe, setPipe] = useState("main"), [tag, setTag] = useState(""), [manualText, setManualText] = useState(""), [msg, setMsg] = useState(""), [listName, setListName] = useState(""), [page, setPage] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const groupsFn = useServerFn(listWhatsAppGroups), convFn = useServerFn(listWhatsAppConversationContacts), listsFn = useServerFn(listCampaignLists), saveListFn = useServerFn(saveCampaignList), delListFn = useServerFn(deleteCampaignList), pipesFn = useServerFn(listPipelines);
  const convs = useQuery({ queryKey: ["wa-conv-contacts"], queryFn: () => convFn(), enabled: source === "conversas", retry: false, staleTime: 60000 });
  const lists = useQuery({ queryKey: ["wa-lists"], queryFn: () => listsFn(), enabled: source === "listas", retry: false });
  const pipes = useQuery({ queryKey: ["wa-pipes"], queryFn: () => pipesFn(), enabled: source === "funis", retry: false });
  const allTags = useMemo(() => [...new Set(leads.flatMap(l => tagsOf(l.tags)))].sort(), [leads]);
  const term = q.trim().toLowerCase();

  function setKind(kind: "individual" | "groups") {
    if (kind === value.kind) return;
    const has = kind === "groups" ? value.leadIds.length + value.clientIds.length + value.manual.length : value.groups.length;
    if (has && !window.confirm("Campanhas para grupos e para contatos individuais são separadas. Trocar o tipo limpa a seleção atual. Continuar?")) return;
    onChange({ kind, leadIds: [], clientIds: [], manual: [], groups: [] });
    setSource(kind === "groups" ? "grupos" : "crm");
  }
  const toggleLead = (id: string, on: boolean) => onChange({ ...value, leadIds: on ? [...new Set([...value.leadIds, id])] : value.leadIds.filter(x => x !== id) });
  const addLeads = (ids: string[]) => onChange({ ...value, leadIds: [...new Set([...value.leadIds, ...ids])] });
  function addManual(items: Manual[]) {
    const have = new Set(value.manual.map(m => m.phone));
    const fresh = items.filter(m => !have.has(m.phone) && (have.add(m.phone), true));
    onChange({ ...value, manual: [...value.manual, ...fresh] });
    return fresh.length;
  }
  function addRaw(lines: { raw: string; name: string; company: string }[], src: string) {
    let invalid = 0; const ok: Manual[] = [];
    for (const l of lines) { const t = normalizeWhatsAppTarget(l.raw); if (t.kind === "phone") ok.push({ phone: t.value, name: l.name.slice(0, 200), company: l.company.slice(0, 200), source: src }); else invalid++; }
    const added = addManual(ok);
    setMsg(`${added} número(s) adicionados${ok.length - added ? ` · ${ok.length - added} já estavam na seleção` : ""}${invalid ? ` · ${invalid} inválido(s) ignorado(s)` : ""}.`);
  }

  // Selected rows with local validation (final check happens on the server at review).
  const rows: Row[] = useMemo(() => {
    if (value.kind === "groups") return value.groups.map(g => ({ key: g.jid, name: g.name, id: g.jid, source: "Grupo", status: "Grupo selecionado", ok: true, remove: () => onChange({ ...value, groups: value.groups.filter(x => x.jid !== g.jid) }) }));
    const seen = new Set<string>(); const out: Row[] = [];
    const push = (key: string, name: string, raw: string, src: string, remove: () => void) => {
      const t = normalizeWhatsAppTarget(raw);
      const status = t.kind !== "phone" ? (raw ? t.reason || "Número inválido" : "Sem WhatsApp") : seen.has(t.value) ? "Duplicado" : "Válido";
      if (t.kind === "phone") seen.add(t.value);
      out.push({ key, name, id: t.kind === "phone" ? t.value : raw || "—", source: src, status, ok: status === "Válido", remove });
    };
    const byId = new Map(leads.map(l => [l.id, l]));
    for (const id of value.leadIds) { const l = byId.get(id); push(`l:${id}`, l ? [l.name, l.company].filter(Boolean).join(" · ") : "Contato", l?.whatsapp ?? "", "CRM", () => toggleLead(id, false)); }
    for (const id of value.clientIds) { const c = clients?.find(x => x.clientId === id); push(`c:${id}`, c ? `${c.company}${c.name && c.name !== c.company ? ` · ${c.name}` : ""}` : "Cliente", c?.whatsapp ?? "", "Cliente", () => onChange({ ...value, clientIds: value.clientIds.filter(x => x !== id) })); }
    for (const m of value.manual) push(`m:${m.phone}`, m.name || m.phone, m.phone, m.source, () => onChange({ ...value, manual: value.manual.filter(x => x.phone !== m.phone) }));
    return out;
  }, [value, leads, clients]); // eslint-disable-line react-hooks/exhaustive-deps
  const selTerm = selQ.trim().toLowerCase();
  const shown = rows.filter(r => !selTerm || `${r.name} ${r.id}`.toLowerCase().includes(selTerm));
  const PAGE = 10, pages = Math.max(1, Math.ceil(shown.length / PAGE)), cur = Math.min(page, pages - 1);
  const valid = rows.filter(r => r.ok).length;

  const leadList = (items: Lead[]) => {
    const f = items.filter(l => !term || `${l.name} ${l.company} ${l.whatsapp}`.toLowerCase().includes(term));
    return <ListBox count={f.length} onAll={() => addLeads(f.map(l => l.id))}>{f.slice(0, 300).map(l => <CheckRow key={l.id} checked={value.leadIds.includes(l.id)} onChange={on => toggleLead(l.id, on)} title={l.name || "Sem nome"} sub={`${l.company || "Sem empresa"} · ${l.whatsapp || "Sem WhatsApp"}`} />)}</ListBox>;
  };

  return <div className="space-y-4">
    <div role="group" aria-label="Tipo de campanha" className="inline-flex rounded-lg border bg-muted/40 p-1">
      {([["individual", "Contatos individuais", User], ["groups", "Grupos do WhatsApp", Users]] as const).map(([k, l, I]) => <button key={k} type="button" aria-pressed={value.kind === k} onClick={() => setKind(k)} className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm ${value.kind === k ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"}`}><I className="size-4" />{l}</button>)}
    </div>
    <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_minmax(0,1fr)]">
      <nav aria-label="Origem dos destinatários" className="rounded-lg border bg-card p-2">
        {SOURCES.filter(s => s.kind === value.kind).map(s => <button key={s.id} type="button" onClick={() => { setSource(s.id); setQ(""); setMsg(""); }} className={`block w-full rounded-md px-3 py-2 text-left text-sm ${source === s.id ? "bg-primary/10 font-medium text-primary" : "hover:bg-muted"}`}>{s.label}</button>)}
      </nav>
      <section className="min-w-0 rounded-lg border bg-card p-3">
        {["crm", "conversas", "funis", "etiquetas", "grupos", "clientes"].includes(source) && <div className="relative mb-3"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9" placeholder="Pesquisar" value={q} onChange={e => setQ(e.target.value)} /></div>}
        {msg && <p role="status" className="mb-2 text-xs text-primary">{msg}</p>}
        {source === "crm" && leadList(leads)}
        {source === "funis" && <>
          <Select value={pipe} onValueChange={setPipe}><SelectTrigger className="mb-3"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="main">Funil principal</SelectItem>{(pipes.data ?? []).filter(p => p.id !== "main").map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select>
          {leadList(leads.filter(l => (l.pipeline_id ?? "main") === pipe))}
        </>}
        {source === "etiquetas" && <>
          <Select value={tag || "none"} onValueChange={v => setTag(v === "none" ? "" : v)}><SelectTrigger className="mb-3"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Escolher etiqueta</SelectItem>{allTags.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select>
          {tag ? leadList(leads.filter(l => tagsOf(l.tags).includes(tag))) : <p className="text-sm text-muted-foreground">{allTags.length ? "Escolha uma etiqueta para ver os contatos." : "Nenhuma etiqueta nos cards."}</p>}
        </>}
        {source === "clientes" && (!clients ? <p className="text-sm text-destructive">Clientes indisponíveis.</p> : (() => {
          const f = clients.filter(c => !term || `${c.company} ${c.name} ${c.whatsapp}`.toLowerCase().includes(term));
          return <ListBox count={f.length} onAll={() => onChange({ ...value, clientIds: [...new Set([...value.clientIds, ...f.map(c => c.clientId)])] })}>{f.map(c => <CheckRow key={c.clientId} checked={value.clientIds.includes(c.clientId)} onChange={on => onChange({ ...value, clientIds: on ? [...value.clientIds, c.clientId] : value.clientIds.filter(x => x !== c.clientId) })} title={c.company} sub={`${c.name} · ${c.whatsapp || "Sem WhatsApp"}`} />)}</ListBox>;
        })())}
        {source === "conversas" && (convs.isPending ? <p className="text-sm text-muted-foreground">Carregando conversas…</p> : convs.isError ? <p className="text-sm text-destructive">Conversas indisponíveis.</p> : (() => {
          const items = (convs.data ?? []).map(c => ({ ...c, t: normalizeWhatsAppTarget(c.phone) })).filter(c => !term || `${c.name} ${c.phone}`.toLowerCase().includes(term));
          const sel = new Set(value.manual.map(m => m.phone));
          return <ListBox count={items.length} onAll={() => addRaw(items.map(c => ({ raw: c.phone, name: c.name, company: "" })), "Conversa")}>{items.slice(0, 300).map(c => <CheckRow key={c.phone} disabled={c.t.kind !== "phone"} checked={c.t.kind === "phone" && sel.has(c.t.value)} onChange={on => on ? addRaw([{ raw: c.phone, name: c.name, company: "" }], "Conversa") : onChange({ ...value, manual: value.manual.filter(m => m.phone !== c.t.value) })} title={c.name || c.phone} sub={c.t.kind === "phone" ? c.t.value : `${c.phone} · ${c.t.reason}`} />)}</ListBox>;
        })())}
        {source === "manual" && <div className="space-y-2"><Textarea rows={8} placeholder={"Um por linha: número, nome (opcional), empresa (opcional)\n(47) 99999-8888, Maria, Loja X"} value={manualText} onChange={e => setManualText(e.target.value)} /><Button size="sm" disabled={!manualText.trim()} onClick={() => { addRaw(manualText.split(/\n+/).filter(Boolean).map(l => { const [raw, name = "", company = ""] = l.split(/[,;\t]/).map(x => x.trim()); return { raw, name, company }; }), "Manual"); setManualText(""); }}>Adicionar números</Button><p className="text-xs text-muted-foreground">Números brasileiros recebem o código 55 automaticamente; o nono dígito nunca é alterado.</p></div>}
        {source === "csv" && <div className="space-y-2"><input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={async e => { const f = e.target.files?.[0]; if (!f) return; if (f.size > 2_000_000) { setMsg("Arquivo acima de 2 MB."); return; } const rows = parseRecipientCsv(await f.text()); if (!rows.length) setMsg("Nenhuma coluna de telefone encontrada (use telefone, whatsapp, celular ou número)."); else addRaw(rows, "CSV"); e.target.value = ""; }} /><Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}><Upload className="size-4" />Escolher arquivo CSV</Button><p className="text-xs text-muted-foreground">Colunas reconhecidas: telefone/whatsapp/celular, nome e empresa. Separador vírgula ou ponto e vírgula.</p></div>}
        {source === "listas" && (lists.isPending ? <p className="text-sm text-muted-foreground">Carregando listas…</p> : lists.isError ? <p className="text-sm text-destructive">Listas indisponíveis.</p> : <div className="divide-y">{(lists.data ?? []).filter(l => l.kind === value.kind).map(l => <div key={l.id} className="flex items-center justify-between gap-2 py-2 text-sm"><span className="min-w-0 truncate">{l.name} <span className="text-muted-foreground">· {l.targets.length}</span></span><span className="flex shrink-0 gap-1"><Button size="sm" variant="outline" onClick={() => { if (value.kind === "groups") { const have = new Set(value.groups.map(g => g.jid)); onChange({ ...value, groups: [...value.groups, ...l.targets.filter(t => t.jid && !have.has(t.jid)).map(t => ({ jid: t.jid, name: t.name ?? "" }))] }); } else addRaw(l.targets.map(t => ({ raw: t.phone ?? "", name: t.name ?? "", company: t.company ?? "" })), "Lista"); }}>Usar</Button><Button size="icon" variant="ghost" aria-label="Excluir lista" onClick={async () => { if (!window.confirm("Excluir esta lista?")) return; await delListFn({ data: { id: l.id } }); void lists.refetch(); }}><Trash2 className="size-4" /></Button></span></div>)}{!(lists.data ?? []).some(l => l.kind === value.kind) && <p className="py-2 text-sm text-muted-foreground">Nenhuma lista salva. Monte a seleção e use "Salvar como lista".</p>}</div>)}
        {source === "grupos" && (!instance ? <p className="text-sm text-muted-foreground">Escolha a instância do WhatsApp acima para listar os grupos.</p> : <GroupPicker instance={instance} selected={value.groups} onChange={g => onChange({ ...value, groups: g })} />)}
      </section>
      <section className="min-w-0 rounded-lg border bg-card p-3">
        <div className="mb-3 flex items-center justify-between gap-2"><h3 className="font-semibold">{value.kind === "groups" ? "Grupos" : "Destinatários"} selecionados ({rows.length})</h3>{rows.length > 0 && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { if (window.confirm("Limpar toda a seleção?")) onChange({ ...value, leadIds: [], clientIds: [], manual: [], groups: [] }); }}>Limpar</Button>}</div>
        <Input placeholder="Pesquisar na seleção" value={selQ} onChange={e => { setSelQ(e.target.value); setPage(0); }} className="mb-2" />
        <p className="mb-2 text-xs text-muted-foreground">{valid} válido(s){rows.length - valid ? ` · ${rows.length - valid} com aviso (ficam de fora)` : ""}</p>
        <div className="divide-y">{shown.slice(cur * PAGE, cur * PAGE + PAGE).map(r => <div key={r.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 py-2 text-sm"><div className="min-w-0"><p className="truncate font-medium">{r.name}</p><p className="truncate text-xs text-muted-foreground">{r.id} · {r.source} · <span className={r.ok ? "text-primary" : "text-destructive"}>{r.status}</span></p></div><Button size="icon" variant="ghost" aria-label="Remover da seleção" onClick={r.remove}><Trash2 className="size-4 text-destructive" /></Button></div>)}</div>
        {rows.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Nada selecionado ainda.</p>}
        {pages > 1 && <div className="mt-2 flex items-center justify-between text-xs"><span>{cur * PAGE + 1}–{Math.min(shown.length, cur * PAGE + PAGE)} de {shown.length}</span><span className="flex gap-1"><Button size="sm" variant="outline" disabled={cur === 0} onClick={() => setPage(cur - 1)}>Anterior</Button><Button size="sm" variant="outline" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Próxima</Button></span></div>}
        {rows.length > 0 && <div className="mt-3 flex gap-2 border-t pt-3"><Input placeholder="Nome da lista" value={listName} onChange={e => setListName(e.target.value)} maxLength={120} /><Button size="sm" variant="outline" disabled={listName.trim().length < 2} onClick={async () => { try { const targets = value.kind === "groups" ? value.groups.map(g => ({ jid: g.jid, name: g.name })) : rows.filter(r => r.ok).map(r => ({ phone: r.id, name: r.name, company: "" })); if (!targets.length) throw new Error("Nenhum destinatário válido para salvar."); await saveListFn({ data: { name: listName, kind: value.kind, targets } }); setListName(""); setMsg("Lista salva."); void lists.refetch(); } catch (e) { setMsg(e instanceof Error ? e.message : "Não foi possível salvar."); } }}><Save className="size-4" />Salvar como lista</Button></div>}
      </section>
    </div>
  </div>;
}

function ListBox({ count, onAll, children }: { count: number; onAll: () => void; children: React.ReactNode }) {
  return <div><div className="mb-2 flex items-center justify-between text-xs text-muted-foreground"><span>{count} resultado(s)</span>{count > 0 && <Button size="sm" variant="ghost" onClick={onAll}>Selecionar todos filtrados</Button>}</div><div className="max-h-[420px] divide-y overflow-y-auto">{children}</div></div>;
}
function CheckRow({ checked, onChange, title, sub, disabled }: { checked: boolean; onChange: (on: boolean) => void; title: string; sub: string; disabled?: boolean }) {
  return <label className={`flex items-start gap-3 py-2 text-sm ${disabled ? "opacity-60" : "cursor-pointer"}`}><Checkbox disabled={disabled} checked={checked} onCheckedChange={v => onChange(v === true)} /><span className="min-w-0"><span className="block truncate">{title}</span><span className="block truncate text-xs text-muted-foreground">{sub}</span></span></label>;
}
