import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { MessageSquareQuote, Plus, Pencil, Trash2, RefreshCw, Bot, AlertCircle } from "lucide-react";
import { SettingsLayout } from "@/components/crm/SettingsLayout";
import { AdminAccessRequired } from "@/components/crm/AdminAccessRequired";
import { CrmAuthGate } from "@/components/crm/CrmAuthGate";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { getReferenceMessages, saveReferenceMessage, deleteReferenceMessage } from "@/lib/reference-messages.functions";
import { REFERENCE_MODES, REFERENCE_SOURCES, type ReferenceInput, type ReferenceMessage, type ReferencePipeline } from "@/lib/reference-messages";

export const Route = createFileRoute("/configuracoes/whatsapp")({
  head: () => ({ meta: [
    { title: "WhatsApp · Configurações — PipeFlow CRM" },
    { name: "description", content: "Mensagens de referência das campanhas Google Ads e Meta Ads e entrada automática de leads nos funis." },
    { property: "og:title", content: "WhatsApp · Configurações — PipeFlow CRM" },
    { property: "og:description", content: "Identificação de origem e funil dos leads que chegam pelo WhatsApp." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: WhatsAppSettingsPage,
});

const CAPTURE_STATUS: Record<string, string> = { created: "Card criado", existing: "Card existente atualizado", ambiguous_lead: "Mais de um card do contato no funil — nada criado", ambiguous_reference: "Referências conflitantes — nada criado", invalid_target: "Funil ou etapa indisponível" };
const time = (v: string) => new Date(v).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
const empty = (pipelines: ReferencePipeline[]): ReferenceInput => {
  const crm = pipelines.find((p) => p.name.trim().toLowerCase() === "crm") ?? pipelines[0];
  return { id: null, revision: 0, body: "", matchMode: "exact", source: "meta_ads", pipelineId: crm?.id ?? null, stageId: crm?.stages[0]?.id ?? "", active: true };
};

function WhatsAppSettingsPage() {
  const fetch = useServerFn(getReferenceMessages);
  const save = useServerFn(saveReferenceMessage);
  const remove = useServerFn(deleteReferenceMessage);
  const query = useQuery({ queryKey: ["reference-messages"], queryFn: () => fetch(), retry: false });
  const [form, setForm] = useState<ReferenceInput | null>(null);
  const [removing, setRemoving] = useState<ReferenceMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [formError, setFormError] = useState("");
  const data = query.data?.authorized ? query.data : null;
  const pipelines = data?.pipelines ?? [];
  const pipelineName = (id: string | null) => pipelines.find((p) => p.id === id)?.name ?? "Funil indisponível";
  const stageName = (pipelineId: string | null, stageId: string) => pipelines.find((p) => p.id === pipelineId)?.stages.find((s) => s.id === stageId)?.title ?? stageId;
  const formStages = pipelines.find((p) => p.id === form?.pipelineId)?.stages ?? [];

  async function submit() {
    if (!form || busy) return;
    setBusy(true); setFormError("");
    try { await save({ data: form }); setForm(null); setNotice("Mensagem de referência salva."); await query.refetch(); }
    catch (e) { setFormError(e instanceof Error ? e.message : "Não foi possível salvar."); }
    finally { setBusy(false); }
  }
  async function toggle(r: ReferenceMessage) {
    if (busy) return; setBusy(true); setNotice("");
    try { await save({ data: { id: r.id, revision: r.revision, body: r.body, matchMode: r.match_mode, source: r.source, pipelineId: r.pipeline_id, stageId: r.stage_id, active: !r.active } }); await query.refetch(); }
    catch (e) { setNotice(e instanceof Error ? e.message : "Não foi possível alterar."); }
    finally { setBusy(false); }
  }
  async function confirmRemove() {
    if (!removing || busy) return; setBusy(true); setNotice("");
    try { await remove({ data: { id: removing.id, revision: removing.revision } }); setNotice("Mensagem de referência excluída. Os cards já criados foram preservados."); await query.refetch(); }
    catch (e) { setNotice(e instanceof Error ? e.message : "Não foi possível excluir."); }
    finally { setBusy(false); setRemoving(null); }
  }

  // Same full-screen password gate as the other CRM pages; the admin account is checked separately.
  if (query.data?.authorized === false && query.data.reason === "crm_session") return <CrmAuthGate onUnlock={() => void query.refetch()} />;
  return <SettingsLayout>
    <main className="min-w-0 flex-1 px-4 py-7 md:px-10">
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
          <div className="min-w-0"><div className="flex items-center gap-3"><MessageSquareQuote className="size-7 shrink-0 text-primary" /><h1 className="text-2xl font-semibold">WhatsApp</h1></div>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Mensagens de referência identificam leads das campanhas: a origem (Google Ads ou Meta Ads), o funil e a etapa de entrada. Cards do mesmo contato no mesmo funil nunca são duplicados.</p></div>
          <Button variant="outline" size="icon" aria-label="Atualizar" title="Atualizar" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw className={query.isFetching ? "animate-spin" : ""} /></Button>
        </header>
        {query.isPending && <p className="py-10 text-muted-foreground">Carregando…</p>}
        {query.data?.authorized === false && <AdminAccessRequired reason={query.data.reason} message={query.data.error} returnTo="/configuracoes/whatsapp" onUnlocked={() => void query.refetch()} />}
        {query.isError && <section className="py-10"><AlertCircle className="mb-3 size-8 text-muted-foreground" /><h2 className="text-lg font-semibold">Não foi possível carregar</h2><p className="my-3 text-sm text-muted-foreground">{query.error instanceof Error ? query.error.message : "Tente novamente."}</p><Button variant="outline" onClick={() => void query.refetch()}>Tentar novamente</Button></section>}
        {data && <>
          {notice && <p role="status" className="my-5 flex items-start gap-2 rounded-md border p-3 text-sm"><AlertCircle className="mt-0.5 size-4 shrink-0" />{notice}</p>}
          <section className="border-b py-7">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div><h2 className="text-lg font-semibold">Mensagens de Referência</h2><p className="mt-1 text-sm text-muted-foreground">{data.references.length} cadastrada(s) · {data.references.filter((r) => r.active).length} ativa(s)</p></div>
              <Button onClick={() => { setFormError(""); setForm(empty(pipelines)); }}><Plus />Nova mensagem</Button>
            </div>
            {!data.references.length && <p className="py-6 text-sm text-muted-foreground">Nenhuma mensagem cadastrada. Cadastre o texto pré-preenchido do anúncio para direcionar os leads ao funil certo.</p>}
            <ul className="divide-y">{data.references.map((r) => <li key={r.id} className="flex flex-wrap items-start justify-between gap-4 py-4">
              <div className="min-w-0 flex-1">
                <p className="break-words font-medium">“{r.body}”</p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <Badge variant="secondary">{REFERENCE_SOURCES[r.source]}</Badge><Badge variant="outline">{REFERENCE_MODES[r.match_mode]}</Badge>
                  <span className="text-muted-foreground">→ {pipelineName(r.pipeline_id)} · {stageName(r.pipeline_id, r.stage_id)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch aria-label={r.active ? "Desativar referência" : "Ativar referência"} checked={r.active} disabled={busy} onCheckedChange={() => void toggle(r)} />
                <Button variant="ghost" size="icon" aria-label="Editar" title="Editar" disabled={busy} onClick={() => { setFormError(""); setForm({ id: r.id, revision: r.revision, body: r.body, matchMode: r.match_mode, source: r.source, pipelineId: r.pipeline_id, stageId: r.stage_id, active: r.active }); }}><Pencil /></Button>
                <Button variant="ghost" size="icon" aria-label="Excluir" title="Excluir" disabled={busy} onClick={() => setRemoving(r)}><Trash2 /></Button>
              </div>
            </li>)}</ul>
          </section>
          <section className="border-b py-7">
            <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold"><Bot className="size-5" />Agente Comercial — Pipeflow IA</h2>
            <p className="max-w-2xl text-sm text-muted-foreground">O atendimento automático é configurado individualmente em cada funil: no Pipeline, selecione o funil e use o botão <strong>Pipeflow IA</strong> ao lado do seletor. Todos os agentes começam desligados.</p>
            <Button asChild variant="outline" className="mt-4"><Link to="/">Abrir Pipeline</Link></Button>
          </section>
          <section className="py-7">
            <h2 className="mb-4 text-lg font-semibold">Últimas identificações</h2>
            {!data.captures.length ? <p className="text-sm text-muted-foreground">Nenhuma mensagem de referência recebida ainda.</p> :
              <ul className="divide-y text-sm">{data.captures.map((c) => <li key={c.message_id} className="flex flex-wrap justify-between gap-2 py-3"><span>{CAPTURE_STATUS[c.status] ?? c.status} · {REFERENCE_SOURCES[c.source as keyof typeof REFERENCE_SOURCES] ?? c.source} · {pipelineName(c.pipeline_id)}</span><span className="text-muted-foreground">{time(c.created_at)}</span></li>)}</ul>}
          </section>
        </>}
      </div>
    </main>
    <Dialog open={Boolean(form)} onOpenChange={(open) => { if (!open && !busy) setForm(null); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>{form?.id ? "Editar mensagem de referência" : "Nova mensagem de referência"}</DialogTitle><DialogDescription>Use o texto que o anúncio pré-preenche no WhatsApp do cliente.</DialogDescription></DialogHeader>
        {form && <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <div><Label htmlFor="ref-body">Texto da mensagem</Label><Textarea id="ref-body" className="mt-2" rows={3} maxLength={1000} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Ex.: Olá! Quero conhecer o CRM da Gravon." /></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label htmlFor="ref-mode">Correspondência</Label><select id="ref-mode" className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.matchMode} onChange={(e) => setForm({ ...form, matchMode: e.target.value as ReferenceInput["matchMode"] })}>{Object.entries(REFERENCE_MODES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            <div><Label htmlFor="ref-source">Origem</Label><select id="ref-source" className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value as ReferenceInput["source"] })}>{Object.entries(REFERENCE_SOURCES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            <div><Label htmlFor="ref-pipeline">Funil de destino</Label><select id="ref-pipeline" className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.pipelineId ?? "main"} onChange={(e) => { const id = e.target.value === "main" ? null : e.target.value; const p = pipelines.find((x) => x.id === id); setForm({ ...form, pipelineId: id, stageId: p?.stages[0]?.id ?? "" }); }}>{pipelines.map((p) => <option key={p.id ?? "main"} value={p.id ?? "main"}>{p.name}</option>)}</select></div>
            <div><Label htmlFor="ref-stage">Etapa inicial</Label><select id="ref-stage" className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.stageId} onChange={(e) => setForm({ ...form, stageId: e.target.value })}>{formStages.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</select></div>
          </div>
          <div className="flex items-center justify-between gap-4"><Label htmlFor="ref-active">Referência ativa</Label><Switch id="ref-active" checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} /></div>
          <p className="text-xs text-muted-foreground">{form.matchMode === "exact" ? "Reconhece só a mensagem idêntica (ignora maiúsculas, acentos e espaços extras)." : "Reconhece qualquer mensagem que contenha este trecho. Prefira trechos únicos do anúncio."} O card recebe a etiqueta {form.source === "meta_ads" ? "meta-ads" : "google-ads"}.</p>
          {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
          <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setForm(null)}>Cancelar</Button><Button type="submit" disabled={busy || form.body.trim().length < 5 || !form.stageId}>{busy ? "Salvando…" : "Salvar"}</Button></DialogFooter>
        </form>}
      </DialogContent>
    </Dialog>
    <AlertDialog open={Boolean(removing)} onOpenChange={(open) => { if (!open) setRemoving(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Excluir mensagem de referência?</AlertDialogTitle><AlertDialogDescription>Novas mensagens com este texto deixarão de ser identificadas. Cards e conversas já existentes são preservados.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void confirmRemove(); }}>Excluir</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </SettingsLayout>;
}
