import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { History, RefreshCw, RotateCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { SettingsLayout } from "@/components/crm/SettingsLayout";
import { CrmAuthGate } from "@/components/crm/CrmAuthGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getMetaConversion, listMetaConversions, retryMetaConversion } from "@/lib/meta-capi-monitor.functions";
import { eventLabel, outcomeLabel, sourceLabel, statusBucket, type AttemptOutcome } from "@/lib/meta-capi-monitor";
import { metaEventLabel } from "@/lib/lead-ai-qualification";
import { capiFailureText } from "@/lib/meta-capi";

export const Route = createFileRoute("/configuracoes/integracoes/meta_/historico")({
  head: () => ({ meta: [
    { title: "Meta Ads · Histórico de Conversões — PipeFlow CRM" },
    { name: "description", content: "Monitoramento dos eventos enviados à API de Conversões da Meta: aceitos, pendentes e com erro, por empresa e período." },
    { property: "og:title", content: "Meta Ads · Histórico de Conversões — PipeFlow CRM" },
    { property: "og:description", content: "Veja se as conversões de cada empresa estão chegando à Meta, com detalhes de cada tentativa." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: ConversionHistoryPage,
});

const time = (v: string | null | undefined) => (v ? new Date(v).toLocaleString("pt-BR") : "—");
const TONE = { accepted: "bg-success/15 text-success", pending: "bg-muted text-muted-foreground", error: "bg-destructive/10 text-destructive" } as const;

function StatusPill({ status }: { status: string }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE[statusBucket(status)]}`}>{metaEventLabel[status] ?? status}</span>;
}

function ConversionHistoryPage() {
  const list = useServerFn(listMetaConversions);
  const [company, setCompany] = useState<string>("");
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const filter = { companyKey: company || undefined, from: from || undefined, to: to || undefined };
  const query = useQuery({ queryKey: ["meta-conversions", filter], queryFn: () => list({ data: filter }), retry: false, refetchInterval: 60_000 });
  const data = query.data && !query.data.needsAuth ? query.data : undefined;
  if (query.data?.needsAuth) return <CrmAuthGate onUnlock={() => void query.refetch()} />;

  return <SettingsLayout>
    <main className="min-w-0 flex-1 px-5 py-7 md:px-10">
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
          <div>
            <div className="flex items-center gap-3"><History className="size-7 text-primary" /><h1 className="text-2xl font-semibold">Histórico de Conversões</h1></div>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Eventos da API de Conversões gerados pelo Pipeflow. O evento de lead qualificado só nasce depois que a Pipeflow IA confirma a qualificação. Cada lead gera no máximo um evento.</p>
          </div>
          <Button variant="outline" size="icon" aria-label="Atualizar" title="Atualizar" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw className={query.isFetching ? "animate-spin" : ""} /></Button>
        </header>

        {query.isPending && <p className="py-10 text-muted-foreground">Carregando…</p>}
        {query.isError && <section className="py-10"><ShieldCheck className="mb-3 size-8 text-muted-foreground" /><h2 className="text-lg font-semibold">Acesso administrativo necessário</h2><p className="my-3 text-sm text-muted-foreground">{query.error instanceof Error ? query.error.message : "Entre com sua conta administrativa."}</p><Button asChild><Link to="/auth">Entrar com minha conta</Link></Button></section>}

        {data && <>
          <section className="flex flex-wrap items-end gap-4 border-b py-5" aria-label="Filtros">
            <div className="grid gap-1.5"><Label>Empresa</Label>
              <Select value={company || data.companies[0]?.key} onValueChange={setCompany}><SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>{data.companies.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-1.5"><Label htmlFor="from">De</Label><Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></div>
            <div className="grid gap-1.5"><Label htmlFor="to">Até</Label><Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></div>
            {(from || to) && <Button variant="ghost" onClick={() => { setFrom(""); setTo(""); }}>Limpar período</Button>}
          </section>

          <section className="grid gap-4 py-6 sm:grid-cols-4" aria-label="Indicadores">
            <Indicator label="Enviados" value={data.summary.sent} detail="Com ao menos uma tentativa" />
            <Indicator label="Aceitos pela API" value={data.summary.accepted} tone="ok" />
            <Indicator label="Pendentes" value={data.summary.pending} detail="Aguardando envio ou nova tentativa" />
            <Indicator label="Com erro" value={data.summary.error} tone={data.summary.error ? "error" : undefined} />
          </section>

          {data.rows.length === 0 ? <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">Nenhum evento no período. Os eventos aparecem aqui quando a Pipeflow IA confirma um lead como Qualificado.</p>
            : <div className="rounded-lg border bg-card"><Table>
              <TableHeader><TableRow><TableHead>Lead</TableHead><TableHead>Empresa</TableHead><TableHead>Evento</TableHead><TableHead>Data e horário</TableHead><TableHead>Status</TableHead><TableHead>Origem</TableHead></TableRow></TableHeader>
              <TableBody>{data.rows.map((r) => <TableRow key={r.id} className="cursor-pointer" onClick={() => setOpen(r.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") setOpen(r.id); }}>
                <TableCell className="font-medium">{r.leadName}</TableCell>
                <TableCell>{r.leadCompany || "—"}</TableCell>
                <TableCell>{eventLabel[r.event_name] ?? r.event_name}</TableCell>
                <TableCell>{time(r.event_time)}</TableCell>
                <TableCell><StatusPill status={r.status} /></TableCell>
                <TableCell className="text-xs text-muted-foreground">{sourceLabel[r.source] ?? r.source}</TableCell>
              </TableRow>)}</TableBody>
            </Table></div>}
        </>}
      </div>
    </main>
    <EventDialog id={open} onClose={() => setOpen(null)} />
  </SettingsLayout>;
}

function Indicator({ label, value, detail, tone }: { label: string; value: number; detail?: string; tone?: "ok" | "error" }) {
  return <div className="rounded-lg border bg-card p-4">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className={`mt-1 text-2xl font-semibold ${tone === "ok" ? "text-success" : tone === "error" ? "text-destructive" : "text-foreground"}`}>{value}</p>
    {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
  </div>;
}

function EventDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const get = useServerFn(getMetaConversion); const retry = useServerFn(retryMetaConversion);
  const qc = useQueryClient(); const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ["meta-conversion", id], queryFn: () => get({ data: { id: id! } }), enabled: Boolean(id), retry: false });
  const d = q.data;
  async function again() {
    if (!id || busy) return;
    setBusy(true);
    try {
      const r = await retry({ data: { id } });
      toast.success(r.productionEnabled ? "Nova tentativa agendada." : "Nova tentativa agendada. O envio real está desligado, então ela só acontece depois da validação final.");
      await Promise.all([qc.invalidateQueries({ queryKey: ["meta-conversion", id] }), qc.invalidateQueries({ queryKey: ["meta-conversions"] })]);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível agendar a nova tentativa."); }
    finally { setBusy(false); }
  }
  return <Dialog open={Boolean(id)} onOpenChange={(v) => { if (!v) onClose(); }}>
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>Detalhes do evento</DialogTitle></DialogHeader>
      {q.isPending && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {q.isError && <p className="text-sm text-destructive">{q.error instanceof Error ? q.error.message : "Não foi possível abrir o evento."}</p>}
      {d && <div className="space-y-5 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          <dt className="text-muted-foreground">Lead</dt><dd>{d.lead?.name ?? "Lead removido"}{d.lead?.company ? ` · ${d.lead.company}` : ""}</dd>
          <dt className="text-muted-foreground">Evento</dt><dd>{eventLabel[d.event.event_name] ?? d.event.event_name}</dd>
          <dt className="text-muted-foreground">Status</dt><dd><StatusPill status={d.event.status} /></dd>
          <dt className="text-muted-foreground">Origem</dt><dd>{sourceLabel[d.event.source] ?? d.event.source}</dd>
          <dt className="text-muted-foreground">Data do evento</dt><dd>{time(d.event.event_time)}</dd>
          <dt className="text-muted-foreground">Pixel</dt><dd>{d.event.pixel_id ?? "Ainda não configurado"}</dd>
          <dt className="text-muted-foreground">ID do evento</dt><dd className="break-all font-mono text-xs">{d.event.event_id}</dd>
          <dt className="text-muted-foreground">Tentativas</dt><dd>{d.event.attempts}{d.event.next_attempt_at ? ` · próxima em ${time(d.event.next_attempt_at)}` : ""}</dd>
          {d.event.last_code && <><dt className="text-muted-foreground">Último erro</dt><dd>{capiFailureText({ http: d.event.last_http, code: d.event.last_code })}</dd></>}
        </dl>
        <section>
          <h3 className="mb-2 font-semibold">Tentativas de envio</h3>
          {d.attempts.length === 0 ? <p className="text-muted-foreground">Nenhuma tentativa ainda. {d.event.status === "ready" ? "O envio real está desligado até a validação final." : ""}</p>
            : <ol className="space-y-3">{d.attempts.map((a) => <li key={a.attempt_no} className="rounded-md border p-3">
              <p className="font-medium">#{a.attempt_no} · {outcomeLabel[a.outcome as AttemptOutcome] ?? a.outcome} <span className="font-normal text-muted-foreground">· {time(a.created_at)} · {a.trigger === "manual" ? "manual" : "automática"}</span></p>
              {a.outcome !== "accepted" && a.code && <p className="mt-1 text-destructive">{capiFailureText({ http: a.http, code: a.code })}</p>}
              <details className="mt-2"><summary className="cursor-pointer text-xs text-muted-foreground">Requisição enviada (resumo técnico)</summary><pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-[11px]">{JSON.stringify(a.request_summary, null, 2)}</pre></details>
              <details className="mt-1"><summary className="cursor-pointer text-xs text-muted-foreground">Resposta da Meta</summary><pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-[11px]">{JSON.stringify(a.response_summary, null, 2)}</pre></details>
            </li>)}</ol>}
          <p className="mt-2 text-xs text-muted-foreground">Os registros mostram só quais campos foram enviados e os códigos da Meta. Token, e-mail, telefone e seus hashes nunca são guardados aqui.</p>
        </section>
        {d.event.retryable && ["failed", "unknown", "retry_scheduled"].includes(d.event.status) && <Button variant="outline" disabled={busy} onClick={() => void again()}><RotateCcw />Tentar novamente</Button>}
      </div>}
    </DialogContent>
  </Dialog>;
}
