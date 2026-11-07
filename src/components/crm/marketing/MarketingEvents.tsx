import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CrmAuthGate } from "@/components/crm/CrmAuthGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { getMarketingEvents, saveMarketingEventMapping } from "@/lib/marketing.functions";
import { retryMetaConversion } from "@/lib/meta-capi-monitor.functions";
import { DEFAULT_STAGES } from "@/lib/crm-types";
import type { DashboardSearch } from "@/lib/dashboard-search";
import { MarketingLayout } from "./MarketingLayout";
import { Empty, LoadState, MarketingPeriodBar, Panel, Stat, useMarketingPeriod } from "./marketing-ui";

const META_EVENTS = ["", "Lead", "QualifiedLead", "Schedule", "Purchase", "Contact", "CompleteRegistration"];
const STATUS_LABEL: Record<string, string> = { pending: "Pendente", sent: "Aceito", failed: "Erro", unknown: "Incerto", pixel_changed: "Pixel alterado" };
const stageLabel = (id: string) => DEFAULT_STAGES.find((s) => s.id === id)?.title ?? id;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

export function MarketingEventsPage({ search }: { search: DashboardSearch }) {
  const { period } = useMarketingPeriod(search);
  const load = useServerFn(getMarketingEvents);
  const save = useServerFn(saveMarketingEventMapping);
  const retry = useServerFn(retryMetaConversion);
  const [busy, setBusy] = useState("");
  const q = useQuery({
    queryKey: ["marketing-events", period?.from, period?.to],
    queryFn: () => { if (!period) throw new Error("Período inválido"); return load({ data: period }); },
    enabled: Boolean(period), staleTime: 60_000,
  });
  if (q.data && "needsAuth" in q.data) return <CrmAuthGate onUnlock={() => void q.refetch()} />;
  const d = q.data && !("needsAuth" in q.data) ? q.data : null;

  async function saveMapping(m: { id: string; metaEvent: string; googleAction: string; active: boolean }) {
    setBusy(m.id);
    try {
      const r = await save({ data: m });
      if (r && "needsAuth" in r) return;
      toast.success("Mapeamento salvo.");
      await q.refetch();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(""); }
  }

  async function retryEvent(id: string) {
    setBusy(id);
    try {
      const r = await retry({ data: { id } });
      toast.success(r.productionEnabled ? "Nova tentativa agendada." : "Nova tentativa agendada. O envio real continua desligado até a ativação nas configurações da Meta.");
      await q.refetch();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(""); }
  }

  return (
    <MarketingLayout>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b pb-6">
        <div>
          <h1 className="text-2xl font-bold">Eventos e Conversões</h1>
          <p className="mt-1 text-sm text-muted-foreground">Envio e monitoramento de eventos para Meta e Google Ads</p>
        </div>
        <MarketingPeriodBar search={search} refreshing={q.isFetching} onRefresh={() => void q.refetch()} />
      </header>

      <LoadState loading={q.isLoading} error={q.error} />
      {d && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Stat label="Eventos elegíveis" value={String(d.conversions.summary.total)} />
            <Stat label="Eventos enviados" value={String(d.conversions.summary.sent)} hint="Tiveram ao menos uma tentativa" />
            <Stat label="Aceitos pela API" value={String(d.conversions.summary.accepted)} hint="Aceito não significa atribuído a uma campanha" />
            <Stat label="Com erro" value={String(d.conversions.summary.error)} />
            <Stat label="Pendentes" value={String(d.conversions.summary.pending)} />
          </div>

          <Panel title="Mapeamento etapa → evento" note="Define qual evento cada etapa do CRM dispara. Envios reais continuam desligados até a ativação na integração da Meta; Google Ads só envia com uma ação de conversão válida configurada.">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead><tr className="border-b text-left text-xs text-muted-foreground">
                  {["Etapa do CRM", "Evento Meta", "Ação de conversão Google", "Ativo", ""].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}
                </tr></thead>
                <tbody>
                  {d.mappings.map((m) => (
                    <MappingRow key={m.id} m={m} busy={busy === m.id} onSave={saveMapping} />
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Monitoramento de envios — Meta" note="Últimos eventos do período; reprocessamento controlado, sem duplicar (a Meta deduplica pelo identificador do evento)">
            {d.conversions.rows.length === 0 ? <Empty>Nenhum evento registrado no período.</Empty> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead><tr className="border-b text-left text-xs text-muted-foreground">
                    {["Lead", "Evento", "Quando", "Status", "Tentativas", "Último envio", ""].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {d.conversions.rows.slice(0, 100).map((r) => (
                      <tr key={r.id} className="border-b last:border-0">
                        <td className="max-w-44 truncate px-2 py-2 font-medium">{r.leadName}</td>
                        <td className="px-2 py-2">{r.event_name}</td>
                        <td className="px-2 py-2 tabular-nums">{when(r.event_time)}</td>
                        <td className="px-2 py-2">{STATUS_LABEL[r.status] ?? r.status}</td>
                        <td className="px-2 py-2 tabular-nums">{r.attempts}</td>
                        <td className="px-2 py-2 tabular-nums">{when(r.sent_at)}</td>
                        <td className="px-2 py-2 text-right">
                          {r.retryable && r.status !== "sent" && (
                            <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => void retryEvent(r.id)}>Reprocessar</Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Google Ads — preparação" note="Importação de conversões qualificadas e vendas do CRM">
            <p className="text-sm text-muted-foreground">
              A integração está preparada para importar conversões do CRM usando identificadores de clique ou dados próprios permitidos.
              Configure a ação de conversão de cada etapa na tabela de mapeamento acima. <strong className="text-foreground">Nenhum evento é enviado ao Google sem uma configuração válida.</strong>
            </p>
          </Panel>
        </div>
      )}
    </MarketingLayout>
  );
}

function MappingRow({ m, busy, onSave }: { m: { id: string; crmStage: string; metaEvent: string; googleAction: string; active: boolean }; busy: boolean; onSave: (m: { id: string; metaEvent: string; googleAction: string; active: boolean }) => void }) {
  const [metaEvent, setMetaEvent] = useState(m.metaEvent);
  const [googleAction, setGoogleAction] = useState(m.googleAction);
  const [active, setActive] = useState(m.active);
  const dirty = metaEvent !== m.metaEvent || googleAction !== m.googleAction || active !== m.active;
  return (
    <tr className="border-b last:border-0">
      <td className="px-2 py-2 font-medium">{stageLabel(m.crmStage)}</td>
      <td className="px-2 py-2">
        <Select value={metaEvent || "none"} onValueChange={(v) => setMetaEvent(v === "none" ? "" : v)}>
          <SelectTrigger className="w-48" aria-label={`Evento Meta para ${stageLabel(m.crmStage)}`}><SelectValue /></SelectTrigger>
          <SelectContent>
            {META_EVENTS.map((e) => <SelectItem key={e || "none"} value={e || "none"}>{e || "Não enviar"}</SelectItem>)}
          </SelectContent>
        </Select>
      </td>
      <td className="px-2 py-2">
        <Input value={googleAction} onChange={(e) => setGoogleAction(e.target.value)} placeholder="Ex.: lead_qualificado" className="w-52" aria-label={`Ação Google para ${stageLabel(m.crmStage)}`} />
      </td>
      <td className="px-2 py-2"><Switch checked={active} onCheckedChange={setActive} aria-label={`Ativar mapeamento de ${stageLabel(m.crmStage)}`} /></td>
      <td className="px-2 py-2 text-right">
        <Button size="sm" variant="outline" disabled={!dirty || busy} onClick={() => onSave({ id: m.id, metaEvent, googleAction, active })}>Salvar</Button>
      </td>
    </tr>
  );
}
