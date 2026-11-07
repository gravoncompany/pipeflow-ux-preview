import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Mail, MessageCircle, Phone, Plus, Zap, Instagram, ChevronRight } from "lucide-react";
import { CampaignsLayout } from "@/components/crm/CampaignsLayout";
import { CrmAuthGate } from "@/components/crm/CrmAuthGate";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getAutomations, saveAutomation } from "@/lib/automations.functions";
import { AUTOMATION_STATE_LABEL, defaultAutomationGraph, manualAutomationGraph, triggerModeOf, TRIGGER_MODE_LABEL } from "@/lib/automations";
import { DiagnosisAutomation } from "@/components/crm/DiagnosisAutomation";

export const Route = createFileRoute("/automacoes/")({
  head: () => ({ meta: [
    { title: "Automações — PipeFlow CRM" },
    { name: "description", content: "Central de Automações do Pipeflow: cadências de e-mail em blocos visuais, com Pipeflow IA, links rastreados e interrupção automática." },
    { property: "og:title", content: "Automações — PipeFlow CRM" },
    { property: "og:description", content: "Monte cadências de prospecção por e-mail em blocos, do card do Outbound ao formulário de diagnóstico." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: AutomationsPage,
});

const fmt = (v: string | null) => v ? new Date(v).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "—";

function AutomationsPage() {
  const get = useServerFn(getAutomations), save = useServerFn(saveAutomation);
  const q = useQuery({ queryKey: ["automations"], queryFn: () => get(), retry: false, gcTime: 0 });
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  if (q.isError) return <CrmAuthGate onUnlock={() => void q.refetch()} />;
  const data = q.data;

  async function create(mode: "entry" | "manual" = "entry") {
    if (busy || !data) return;
    setBusy(true); setError("");
    try {
      const outbound = data.pipelines.find((p) => p.name.trim().toLowerCase() === "outbound") ?? null;
      const r = await save({ data: { id: null, revision: 0, name: mode === "manual" ? "Outbound · disparo manual (cards selecionados)" : "Outbound · diagnóstico estratégico (18 dias)",
        graph: mode === "manual" ? manualAutomationGraph(outbound?.id ?? null) : defaultAutomationGraph(outbound?.id ?? null), landingUrl: "", testContacts: [], approveAi: false } });
      await navigate({ to: "/automacoes/$id", params: { id: r.automation.id } });
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível criar."); }
    finally { setBusy(false); }
  }

  return (
    <CampaignsLayout>
      <main className="min-w-0 flex-1 overflow-y-auto p-4 text-foreground md:p-8">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b pb-6">
          <div>
            <div className="mb-2 flex items-center gap-2 text-primary"><Zap className="size-5" /><span className="text-sm font-medium">Central de Automações</span></div>
            <h1 className="text-2xl font-bold">Automações</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Monte a cadência em blocos: gatilho, Pipeflow IA, e-mail, espera e condições. Toda automação nasce desligada; teste com seus próprios e-mails antes de ativar.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void create("manual")} disabled={busy || !data}><Plus className="size-4" />Nova automação manual (cards selecionados)</Button>
            <Button onClick={() => void create()} disabled={busy || !data}><Plus className="size-4" />Nova automação (modelo de 18 dias)</Button>
          </div>
        </header>
        {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
        <DiagnosisAutomation />

        {data && !data.agentEnabled && (
          <p className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">O envio automático de e-mails (Agente Comercial de e-mail) está desligado: nenhuma automação envia até ele ser ligado nos Fluxos de E-mail.</p>
        )}

        <section className="mt-6 grid gap-3" aria-label="Automações">
          {q.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {data && data.automations.length === 0 && (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <p className="font-medium">Nenhuma automação ainda.</p>
              <p className="mt-1 text-sm text-muted-foreground">Comece pelo modelo: card no Outbound → 5 e-mails em 18 dias → página do diagnóstico → formulário → card atualizado.</p>
            </div>
          )}
          {data?.automations.map((a) => (
            <Link key={a.id} to="/automacoes/$id" params={{ id: a.id }} className="flex flex-wrap items-center gap-4 rounded-lg border bg-card p-4 hover:border-primary/50">
              <span className="grid size-10 place-items-center rounded-md bg-primary/10 text-primary"><Mail className="size-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{a.name}</span>
                  <Badge variant={a.state === "active" ? "default" : "secondary"}>{AUTOMATION_STATE_LABEL[a.state]}</Badge>
                  {!a.compile_ok && <Badge variant="outline">Desenho incompleto</Badge>}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {TRIGGER_MODE_LABEL[triggerModeOf(a.graph)]} · Funil: {data.pipelines.find((p) => p.id === a.trigger_pipeline_id)?.name ?? "não definido"} · {a.compiled.steps?.length ?? 0} e-mail(s) · atualizada {fmt(a.updated_at)}
                </span>
              </span>
              <span className="grid grid-cols-4 gap-4 text-center text-xs">
                <Stat label="Cards" v={a.stats.runs} /><Stat label="Cliques" v={a.stats.clicks} /><Stat label="Respostas" v={a.stats.replies} /><Stat label="Formulários" v={a.stats.forms} />
              </span>
              <ChevronRight className="size-4 text-muted-foreground" />
            </Link>
          ))}
        </section>

        <section className="mt-8 rounded-lg border p-4" aria-label="Próximos canais">
          <h2 className="text-sm font-semibold">Próximas fases</h2>
          <p className="mt-1 text-xs text-muted-foreground">Cadências comerciais por e-mail e atendimento WhatsApp exclusivo do diagnóstico.</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <Badge variant="outline"><MessageCircle className="mr-1 size-3" />WhatsApp</Badge>
            <Badge variant="outline"><Instagram className="mr-1 size-3" />Instagram</Badge>
            <Badge variant="outline"><Phone className="mr-1 size-3" />Ligações</Badge>
          </div>
        </section>
      </main>
    </CampaignsLayout>
  );
}

function Stat({ label, v }: { label: string; v: number }) {
  return <span><span className="block text-base font-semibold">{v}</span><span className="text-muted-foreground">{label}</span></span>;
}
