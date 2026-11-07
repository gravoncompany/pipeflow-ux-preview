import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Lock, RefreshCw, Tags, Trash2, Pencil, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { listWhatsAppGroups, syncWhatsAppGroups } from "@/lib/campaigns.functions";
import { applyGroupTags, deleteGroupTag, listGroupTags, saveGroupTag } from "@/lib/whatsapp-group-tags.functions";
import { filterGroups } from "@/lib/whatsapp-group-filter";
import type { Group } from "./RecipientsStep";

const PAGE = 100;

/** Grupos do WhatsApp: pesquisa, etiquetas internas, filtro de selecionados, paginação e seleção em lote. A seleção vive no rascunho da campanha. */
export function GroupPicker({ instance, selected, onChange, onProceed }: { instance: string; selected: Group[]; onChange: (g: Group[]) => void; onProceed?: () => void }) {
  const qc = useQueryClient();
  const groupsFn = useServerFn(listWhatsAppGroups), syncFn = useServerFn(syncWhatsAppGroups), tagsFn = useServerFn(listGroupTags), applyFn = useServerFn(applyGroupTags);
  const groups = useQuery({ queryKey: ["wa-groups", instance], queryFn: () => groupsFn({ data: { instance } }), enabled: !!instance, retry: false, staleTime: 0, refetchInterval: query => query.state.data?.syncing ? 2000 : 60000 });
  const sync = useMutation({ mutationKey: ["wa-group-sync", instance], mutationFn: ({ target, force }: { target: string; force: boolean }) => syncFn({ data: { instance: target, force } }), onSuccess: (data, vars) => qc.setQueryData(["wa-groups", vars.target], data), onError: e => toast.error(e instanceof Error ? e.message : "Não foi possível atualizar os grupos.") });
  const [attempted, setAttempted] = useState("");
  const stamp = `${instance}:${groups.data?.fetchedAt ?? "first"}`;
  useEffect(() => {
    if (!groups.data?.needsSync || groups.data.syncing || sync.isPending || attempted === stamp) return;
    setAttempted(stamp);
    sync.mutate({ target: instance, force: false });
  }, [groups.data, sync.isPending, attempted, stamp, instance]); // eslint-disable-line react-hooks/exhaustive-deps
  const updating = sync.isPending || groups.data?.syncing === true;
  const refresh = () => sync.mutate({ target: instance, force: true });
  const tags = useQuery({ queryKey: ["wa-group-tags", instance], queryFn: () => tagsFn({ data: { instance } }), enabled: !!instance, retry: false });
  const [q, setQ] = useState(""), [tag, setTag] = useState("todas"), [onlySel, setOnlySel] = useState(false), [page, setPage] = useState(0);
  const [manage, setManage] = useState(false), [applyTag, setApplyTag] = useState("");
  const sel = useMemo(() => new Set(selected.map(g => g.jid)), [selected]);
  const byGroup = tags.data?.byGroup ?? {};
  const tagName = new Map((tags.data?.tags ?? []).map(t => [t.id, t.name]));
  const list = useMemo(() => filterGroups(groups.data?.groups ?? [], { q, tag: tag === "todas" ? null : tag === "sem" ? "" : tag, onlySelected: onlySel, selected: sel, byGroup }), [groups.data, q, tag, onlySel, sel, byGroup]);
  const pages = Math.max(1, Math.ceil(list.length / PAGE)), cur = Math.min(page, pages - 1);
  const visible = list.slice(cur * PAGE, cur * PAGE + PAGE);

  const toggle = (g: { jid: string; name: string }, on: boolean) => onChange(on ? (sel.has(g.jid) ? selected : [...selected, { jid: g.jid, name: g.name }]) : selected.filter(x => x.jid !== g.jid));
  const selectVisible = () => onChange([...selected, ...visible.filter(g => g.canPost && !sel.has(g.jid)).map(g => ({ jid: g.jid, name: g.name }))]);
  async function tagSelected(mode: "add" | "remove") {
    if (!applyTag || !selected.length) return;
    try { await applyFn({ data: { instance, jids: selected.map(g => g.jid), tagIds: [applyTag], mode } }); await qc.invalidateQueries({ queryKey: ["wa-group-tags", instance] }); toast.success(mode === "add" ? `Etiqueta aplicada a ${selected.length} grupo(s).` : `Etiqueta removida de ${selected.length} grupo(s).`); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao aplicar etiqueta."); }
  }

  if (groups.isPending || (!groups.data?.fetchedAt && updating)) return <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><RefreshCw className="size-4 animate-spin motion-reduce:animate-none" />Carregando grupos…</p>;
  if (groups.isError || (!groups.data?.fetchedAt && groups.data?.error)) return <div className="space-y-2"><p className="text-sm text-destructive">{groups.data?.error ?? "Não foi possível listar os grupos."}</p><Button size="sm" variant="outline" disabled={updating} onClick={refresh}><RefreshCw className="size-4" />Tentar novamente</Button></div>;

  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      <Input placeholder="Pesquisar grupo pelo nome" value={q} onChange={e => { setQ(e.target.value); setPage(0); }} className="h-8 min-w-40 flex-1" />
      <Select value={tag} onValueChange={v => { setTag(v); setPage(0); }}><SelectTrigger className="h-8 w-44" aria-label="Filtrar por etiqueta"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todas">Todas as etiquetas</SelectItem><SelectItem value="sem">Sem etiqueta</SelectItem>{(tags.data?.tags ?? []).map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent></Select>
      <label className="flex items-center gap-1.5 text-xs"><Checkbox checked={onlySel} onCheckedChange={v => { setOnlySel(v === true); setPage(0); }} />Só selecionados</label>
      <Button size="sm" variant="outline" onClick={() => setManage(true)}><Tags className="size-4" />Gerenciar etiquetas</Button>
      <Button size="sm" variant="outline" disabled={updating} onClick={refresh}><RefreshCw className={`size-4 ${updating ? "animate-spin motion-reduce:animate-none" : ""}`} />{updating ? "Atualizando…" : "Atualizar grupos"}</Button>
    </div>
    <p role="status" className="text-xs text-muted-foreground">{list.length} de {groups.data?.groups.length ?? 0} grupos · ordem alfabética{groups.data?.fetchedAt ? ` · última sincronização: ${new Date(groups.data.fetchedAt).toLocaleString("pt-BR")}` : ""}</p>
    {groups.data?.error && <p className="text-xs text-destructive">{groups.data.error}</p>}
    <ul className="max-h-[420px] divide-y overflow-y-auto rounded-md border">
      {visible.map(g => {
        const on = sel.has(g.jid);
        return <li key={g.jid} className={`flex items-start gap-3 px-2 py-2 text-sm ${g.canPost ? "" : "opacity-60"}`}>
          <Checkbox className="mt-0.5" disabled={!g.canPost && !on} checked={on} onCheckedChange={v => toggle(g, v === true)} aria-label={`Selecionar ${g.name}`} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{!g.canPost && <Lock className="mr-1 inline size-3" aria-label="Indisponível" />}{g.name}</p>
            <p className="truncate text-xs text-muted-foreground">{g.jid}{g.size ? ` · ${g.size} participantes` : ""}{g.reason ? ` · ${g.reason}` : ""}</p>
            {(byGroup[g.jid] ?? []).length > 0 && <div className="mt-1 flex flex-wrap gap-1">{byGroup[g.jid].map(t => tagName.get(t) && <Badge key={t} variant="secondary" className="text-[10px]">{tagName.get(t)}</Badge>)}</div>}
          </div>
          <Button size="sm" variant={on ? "secondary" : "ghost"} disabled={!g.canPost && !on} onClick={() => toggle(g, !on)}>{on ? "Remover" : "Adicionar"}</Button>
        </li>;
      })}
      {!visible.length && <li className="p-4 text-center text-sm text-muted-foreground">Nenhum grupo encontrado.</li>}
    </ul>
    {pages > 1 && <div className="flex items-center justify-center gap-2 text-xs"><Button size="sm" variant="ghost" disabled={cur === 0} onClick={() => setPage(cur - 1)}>Anterior</Button>Página {cur + 1} de {pages}<Button size="sm" variant="ghost" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Próxima</Button></div>}
    <div className="flex flex-wrap items-center gap-2 border-t pt-2 text-sm">
      <b>{selected.length} grupo(s) selecionado(s)</b>
      <Button size="sm" variant="outline" onClick={selectVisible}>Selecionar visíveis</Button>
      <Button size="sm" variant="ghost" disabled={!selected.length} onClick={() => onChange([])}>Limpar seleção</Button>
      {onProceed && <Button size="sm" className="ml-auto" disabled={!selected.length} onClick={onProceed}>Prosseguir</Button>}
    </div>
    {selected.length > 0 && (tags.data?.tags.length ?? 0) > 0 && <div className="flex flex-wrap items-center gap-2 text-xs">
      <span>Etiqueta para os selecionados:</span>
      <Select value={applyTag} onValueChange={setApplyTag}><SelectTrigger className="h-8 w-40" aria-label="Etiqueta para aplicar"><SelectValue placeholder="Escolher" /></SelectTrigger><SelectContent>{(tags.data?.tags ?? []).map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent></Select>
      <Button size="sm" variant="outline" disabled={!applyTag} onClick={() => void tagSelected("add")}>Aplicar</Button>
      <Button size="sm" variant="ghost" disabled={!applyTag} onClick={() => void tagSelected("remove")}>Remover</Button>
    </div>}
    <TagManager open={manage} onClose={() => setManage(false)} instance={instance} tags={tags.data?.tags ?? []} />
  </div>;
}

function TagManager({ open, onClose, instance, tags }: { open: boolean; onClose: () => void; instance: string; tags: { id: string; name: string }[] }) {
  const qc = useQueryClient();
  const saveFn = useServerFn(saveGroupTag), delFn = useServerFn(deleteGroupTag);
  const [name, setName] = useState(""), [edit, setEdit] = useState<{ id: string; name: string } | null>(null);
  const reload = () => qc.invalidateQueries({ queryKey: ["wa-group-tags", instance] });
  async function save(id: string | null, n: string) {
    try { await saveFn({ data: { id, name: n } }); setName(""); setEdit(null); await reload(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao salvar."); }
  }
  return <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}><DialogContent>
    <DialogHeader><DialogTitle>Etiquetas dos grupos</DialogTitle><DialogDescription>Etiquetas internas do Pipeflow, só para organizar grupos. Não mudam nada no WhatsApp nem nos contatos do CRM.</DialogDescription></DialogHeader>
    <div className="flex gap-2"><Input placeholder="Nova etiqueta (ex.: Clientes)" value={name} onChange={e => setName(e.target.value)} maxLength={60} /><Button disabled={!name.trim()} onClick={() => void save(null, name.trim())}><Plus />Criar</Button></div>
    <ul className="divide-y">{tags.map(t => <li key={t.id} className="flex items-center gap-2 py-2 text-sm">
      {edit?.id === t.id ? <><Input className="h-8" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} maxLength={60} /><Button size="sm" disabled={!edit.name.trim()} onClick={() => void save(t.id, edit.name.trim())}>Salvar</Button><Button size="icon" variant="ghost" aria-label="Cancelar" onClick={() => setEdit(null)}><X /></Button></>
        : <><span className="flex-1">{t.name}</span><Button size="icon" variant="ghost" aria-label={`Editar ${t.name}`} onClick={() => setEdit(t)}><Pencil /></Button><Button size="icon" variant="ghost" aria-label={`Excluir ${t.name}`} onClick={() => void (async () => { if (!window.confirm(`Excluir a etiqueta "${t.name}"? Ela sai de todos os grupos.`)) return; try { await delFn({ data: { id: t.id } }); await reload(); } catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao excluir."); } })()}><Trash2 /></Button></>}
    </li>)}{!tags.length && <li className="py-3 text-sm text-muted-foreground">Nenhuma etiqueta ainda.</li>}</ul>
  </DialogContent></Dialog>;
}
