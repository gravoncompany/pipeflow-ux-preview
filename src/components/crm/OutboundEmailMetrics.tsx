import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import { getOutboundEmailMetrics } from "@/lib/automations.functions";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function Card({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <div className="min-w-0 rounded-lg border bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-3xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

export function OutboundEmailMetrics({ pipelineId, from, to, newLeads }: { pipelineId: string; from: string; to: string; newLeads: number }) {
  const [automationId, setAutomationId] = useState<string>("all");
  const [mode, setMode] = useState<"all" | "manual" | "trigger">("all");
  const fetchMetrics = useServerFn(getOutboundEmailMetrics);
  const q = useQuery({
    queryKey: ["outbound-email-metrics", pipelineId, from, to, automationId, mode],
    queryFn: () => fetchMetrics({ data: { pipelineId, from, to, automationId: automationId === "all" ? null : automationId, mode } }),
    enabled: !!from && !!to,
    retry: false,
    refetchInterval: 30_000,
  });
  if (q.data && q.data.automations.length === 0) return null;
  const m = q.data;
  const v = (n: number | undefined) => (m ? (n ?? 0) : "—");
  return (
    <section className="mb-8 border-y py-5">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="mr-auto flex items-center gap-2">
          <Mail className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">E-mails de prospecção</h2>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Automação</Label>
          <Select value={automationId} onValueChange={setAutomationId}>
            <SelectTrigger className="w-full sm:w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as automações</SelectItem>
              {(m?.automations ?? []).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Tipo de disparo</Label>
          <Select value={mode} onValueChange={(x) => setMode(x as typeof mode)}>
            <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="trigger">Automático</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {q.isError ? (
        <p className="text-sm text-destructive">Não foi possível carregar os indicadores de e-mail.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card label="Leads novos" value={newLeads} hint="cards que entraram no funil" />
          <Card label="E-mails enviados" value={v(m?.sent)} hint="aceitos pelo provedor; sem pendentes ou agendados" />
          <Card label="Automações em andamento" value={v(m?.activeContacts)} hint="contatos ativos agora (não é envio)" />
          <Card label="E-mails entregues" value="Indisponível" hint="o provedor ainda não informa entregas ao Pipeflow" />
          <Card label="Falhas" value={v(m?.failed)} hint={m?.unknown ? `+ ${m.unknown} com resultado incerto` : "recusados pelo provedor"} />
          <Card label="Cliques" value={v(m?.clicksTotal)} hint={m ? `${m.clicksUnique} ${m.clicksUnique === 1 ? "contato único" : "contatos únicos"}` : "—"} />
          <Card label="Respostas" value={v(m?.replies)} hint="contatos que responderam" />
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">Atualiza a cada 30 segundos. Envios de teste não entram na conta.</p>
    </section>
  );
}
