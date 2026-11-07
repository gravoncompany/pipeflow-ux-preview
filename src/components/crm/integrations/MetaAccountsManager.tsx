import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addMetaAccounts, discoverMetaAccounts, listMetaRegistry, removeMetaAccount, syncMetaAccounts } from "@/lib/meta-ad-accounts.functions";

const STATUS: Record<number, string> = { 1: "Ativa", 2: "Desativada", 3: "Pendência de pagamento", 7: "Em revisão", 9: "Período de carência", 100: "Encerramento pendente", 101: "Encerrada" };

/** Contas Meta adicionadas ao Pipeflow: busca, seleção múltipla, sincronização e remoção (nada muda na Meta). */
export function MetaAccountsManager({ selected, onMetrics }: { selected: string; onMetrics: (id: string) => void }) {
  const listFn = useServerFn(listMetaRegistry), discFn = useServerFn(discoverMetaAccounts), addFn = useServerFn(addMetaAccounts), syncFn = useServerFn(syncMetaAccounts), rmFn = useServerFn(removeMetaAccount);
  const q = useQuery({ queryKey: ["meta-registry"], queryFn: () => listFn(), retry: false });
  const [open, setOpen] = useState(false), [pick, setPick] = useState<Set<string>>(new Set()), [busy, setBusy] = useState(""), [msg, setMsg] = useState(""), [err, setErr] = useState("");
  const disc = useQuery({ queryKey: ["meta-discover"], queryFn: () => discFn(), enabled: open, retry: false, staleTime: 0 });
  const run = async (k: string, fn: () => Promise<{ error: string | null } & Record<string, unknown>>) => { setBusy(k); setErr(""); setMsg(""); try { const r = await fn(); if (r.error) setErr(r.error); return r; } catch (e) { setErr(e instanceof Error ? e.message : "Falha."); } finally { setBusy(""); } };
  const rows = q.data?.data ?? [];
  const avail = (disc.data?.data?.accounts ?? []).filter((a) => !a.added);
  return <section className="border-b py-6">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h2 className="font-semibold">Contas de anúncios autorizadas ({rows.length})</h2><p className="text-xs text-muted-foreground">Vincule cada conta ao cliente em Clientes › ficha › Visão geral › Campanhas. Remover aqui não exclui nada na Meta.</p></div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void run("sync", async () => { const r = await syncFn(); if (r.data) setMsg(`${r.data.total} conta(s) sincronizada(s); ${r.data.available} acessível(is) pela conexão${r.data.lost ? `; ${r.data.lost} perderam acesso` : ""}.${r.data.notes.length ? " " + r.data.notes.join(" ") : ""}`); await q.refetch(); return r; })}><RefreshCw className="size-4" />{busy === "sync" ? "Sincronizando…" : "Sincronizar contas"}</Button>
        <Button size="sm" onClick={() => { setPick(new Set()); setOpen(true); }}><Plus className="size-4" />Adicionar contas de anúncios</Button>
      </div>
    </div>
    {msg && <p className="mt-2 text-sm text-muted-foreground">{msg}</p>}
    {(err || q.data?.error) && <p role="alert" className="mt-2 text-sm text-destructive">{err || q.data?.error}</p>}
    <div className="mt-3 rounded-lg border"><Table><TableHeader><TableRow><TableHead>Conta</TableHead><TableHead>ID</TableHead><TableHead>Portfólio empresarial</TableHead><TableHead>Status</TableHead><TableHead>Cliente vinculado</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader>
      <TableBody>{rows.map((a) => <TableRow key={a.account_id}>
        <TableCell className="font-medium">{a.account_name || "—"}</TableCell>
        <TableCell className="text-xs">{a.account_id.replace("act_", "")}</TableCell>
        <TableCell>{a.business_name || <span className="text-muted-foreground">Não informado</span>}</TableCell>
        <TableCell>{!a.accessible ? <Badge variant="destructive">Sem acesso</Badge> : a.account_status === 1 ? <Badge variant="secondary">Ativa</Badge> : <Badge variant="outline">{STATUS[a.account_status ?? 0] ?? "Desconhecido"}</Badge>}</TableCell>
        <TableCell>{a.client_name ?? <span className="text-muted-foreground">Nenhum</span>}</TableCell>
        <TableCell className="text-right"><div className="flex justify-end gap-1">
          <Button size="sm" variant={selected === a.account_id ? "default" : "outline"} onClick={() => onMetrics(a.account_id)}>Métricas</Button>
          <Button size="sm" variant="ghost" aria-label="Remover do Pipeflow" disabled={Boolean(busy)} onClick={() => { if (confirm(`Remover "${a.account_name}" do Pipeflow? A conta continua existindo na Meta e o vínculo com o cliente é mantido.`)) void run("rm", async () => { const r = await rmFn({ data: { id: a.account_id } }); await q.refetch(); return r; }); }}><Trash2 className="size-4" /></Button>
        </div></TableCell>
      </TableRow>)}
      {!q.isPending && !rows.length && <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground">Nenhuma conta adicionada. Clique em “Adicionar contas de anúncios”.</TableCell></TableRow>}</TableBody></Table></div>

    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>Adicionar contas de anúncios</DialogTitle><DialogDescription>Contas que a conexão Meta do Pipeflow consegue ler, incluindo as de portfólios de clientes compartilhados com ela.</DialogDescription></DialogHeader>
      {disc.isFetching && <p className="text-sm text-muted-foreground">Consultando a Meta…</p>}
      {(disc.data?.error || disc.data?.data?.error) && <p role="alert" className="text-sm text-destructive">{disc.data?.error || disc.data?.data?.error}</p>}
      {disc.data?.data?.notes?.map((n) => <p key={n} className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">{n}</p>)}
      {avail.length > 0 && <label className="flex items-center gap-2 text-sm"><Checkbox checked={pick.size === avail.length} onCheckedChange={(v) => setPick(v ? new Set(avail.map((a) => a.id)) : new Set())} />Selecionar todas ({avail.length})</label>}
      <ul className="divide-y rounded-lg border">{(disc.data?.data?.accounts ?? []).map((a) => <li key={a.id} className="flex items-center gap-3 px-3 py-2 text-sm">
        <Checkbox disabled={a.added} checked={a.added || pick.has(a.id)} onCheckedChange={(v) => { const s = new Set(pick); if (v) s.add(a.id); else s.delete(a.id); setPick(s); }} />
        <span className="min-w-0 flex-1"><b>{a.name || a.id}</b><span className="block text-xs text-muted-foreground">{a.id.replace("act_", "")} · {a.businessName || "Portfólio não informado"}</span></span>
        {a.added && <Badge variant="secondary">Já adicionada</Badge>}
      </li>)}{disc.data?.data && !disc.data.data.accounts.length && <li className="px-3 py-3 text-sm text-muted-foreground">A Meta não retornou nenhuma conta para esta conexão.</li>}</ul>
      <Button disabled={!pick.size || Boolean(busy)} onClick={() => void run("add", async () => { const r = await addFn({ data: { ids: [...pick] } }); if (r.data) { setMsg(`${r.data.added} conta(s) adicionada(s).`); setOpen(false); } await q.refetch(); return r; })}>{busy === "add" ? "Adicionando…" : `Adicionar ${pick.size || ""} selecionada(s)`}</Button>
    </DialogContent></Dialog>
  </section>;
}
