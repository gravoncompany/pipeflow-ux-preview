import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, MessageSquare, Power, PowerOff, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SEND_STATE_LABELS } from "@/lib/whatsapp-message-sync";
import {
  getWhatsAppTestStatus,
  runWhatsAppTestDiagnostic,
  setWhatsAppTestEnabled,
  setCrmReadEnabled,
  setCrmMoveEnabled,
  setCrmFinanceEnabled,
  type DiagnosticResult,
} from "@/lib/gravon-whatsapp-test.functions";

const EVENT_LABELS: Record<string, string> = {
  inbound: "Mensagem recebida",
  reply: "Resposta da IA",
  toggle: "Configuração",
  error: "Erro",
  action: "Movimentação de lead",
};

export function GravonWhatsAppTest() {
  const queryClient = useQueryClient();
  const getStatus = useServerFn(getWhatsAppTestStatus);
  const runDiagnostic = useServerFn(runWhatsAppTestDiagnostic);
  const setEnabled = useServerFn(setWhatsAppTestEnabled);
  const setReadEnabled = useServerFn(setCrmReadEnabled);
  const setMoveEnabled = useServerFn(setCrmMoveEnabled);
  const setFinanceEnabled = useServerFn(setCrmFinanceEnabled);
  const q = useQuery({
    queryKey: ["gravon-wa-test"],
    queryFn: () => getStatus(),
    retry: false,
    refetchInterval: 8000,
  });
  const [phone, setPhone] = useState<string | null>(null);
  const [diagnostic, setDiagnostic] = useState<DiagnosticResult | null>(null);
  const [busy, setBusy] = useState(false);

  if (q.isPending) return <p className="text-sm text-muted-foreground">Carregando WhatsApp...</p>;
  if (q.isError)
    return (
      <p role="alert" className="text-sm text-destructive">
        Não foi possível carregar o WhatsApp.{" "}
        <Button variant="outline" onClick={() => void q.refetch()}>
          Tentar novamente
        </Button>
      </p>
    );
  if (!q.data || q.data.needsAuth) return null;
  const status = q.data;
  const authorizedPhone = phone ?? status.authorizedPhone;

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["gravon-wa-test"] });

  const onDiagnostic = async () => {
    setBusy(true);
    try {
      const result = await runDiagnostic();
      setDiagnostic(result);
      if (result.error) toast.error(result.error);
      else toast.success("Diagnóstico concluído, sem envio de mensagens.");
    } catch {
      toast.error("Não foi possível concluir a operação. Nenhum reenvio foi iniciado.");
    } finally {
      setBusy(false);
    }
  };

  const onToggle = async (enabled: boolean) => {
    setBusy(true);
    try {
      const result = await setEnabled({ data: { enabled, authorizedPhone } });
      if (!result.ok) {
        toast.error(result.error ?? "Não foi possível alterar as respostas.");
        return;
      }
      toast.success(
        enabled ? "Respostas no seu WhatsApp ativadas." : "Respostas no seu WhatsApp desativadas.",
      );
      setPhone(null);
      refresh();
    } catch {
      toast.error("Não foi possível concluir a operação. Nenhum reenvio foi iniciado.");
    } finally {
      setBusy(false);
    }
  };

  const onReadToggle = async (enabled: boolean) => {
    setBusy(true);
    try {
      const result = await setReadEnabled({ data: { enabled } });
      if (!result.ok) {
        toast.error(result.error ?? "Não foi possível alterar a autorização.");
        return;
      }
      toast.success(enabled ? "Consultas ao CRM autorizadas." : "Consultas ao CRM desativadas.");
      refresh();
    } catch {
      toast.error("Não foi possível alterar a autorização.");
    } finally {
      setBusy(false);
    }
  };

  const onMoveToggle = async (enabled: boolean) => {
    setBusy(true);
    try {
      const result = await setMoveEnabled({ data: { enabled } });
      if (!result.ok) {
        toast.error(result.error ?? "Não foi possível alterar a permissão.");
        return;
      }
      toast.success(
        enabled
          ? "Movimentações autorizadas com confirmação no seu WhatsApp."
          : "Movimentações desativadas; confirmações pendentes invalidadas.",
      );
      refresh();
    } catch {
      toast.error("Não foi possível alterar a permissão.");
    } finally {
      setBusy(false);
    }
  };

  const onFinanceToggle = async (enabled: boolean) => {
    setBusy(true);
    try {
      const result = await setFinanceEnabled({ data: { enabled } });
      if (!result.ok) {
        toast.error(result.error ?? "Não foi possível alterar a autorização financeira.");
        return;
      }
      toast.success(
        enabled
          ? "Financeiro e valores de vendas autorizados no seu WhatsApp."
          : "Acesso financeiro desativado.",
      );
      refresh();
    } catch {
      toast.error("Não foi possível alterar a autorização financeira.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]"
      aria-label="Meu WhatsApp"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <MessageSquare className="size-5 text-primary" />
              Respostas no meu WhatsApp
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Responde apenas na conversa "Você", com o número autorizado. Nenhum cliente recebe
              mensagens.
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                status.enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
              }`}
            >
              <span
                className={`size-2 rounded-full ${status.enabled ? "bg-primary" : "bg-muted-foreground"}`}
              />
              {status.enabled ? "Respostas ativadas" : "Respostas desativadas"}
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={refresh}
              aria-label="Atualizar"
              title="Atualizar"
            >
              <RefreshCw />
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-6">
          <div className="space-y-2 text-sm">
            <p>
              OpenAI:{" "}
              <strong>
                {status.openaiConfigured ? "chave configurada" : "chave não configurada"}
              </strong>
            </p>
            <p>
              WhatsApp:{" "}
              <strong>
                {diagnostic
                  ? diagnostic.ok
                    ? `conectado (${diagnostic.instanceName})`
                    : (diagnostic.error ?? "falha")
                  : "execute o diagnóstico"}
              </strong>
            </p>
            {diagnostic?.ok && (
              <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
                <p>Número conectado: {diagnostic.ownNumber}</p>
                <p>Mensagens na conversa "Você": {diagnostic.selfChatMessages}</p>
                {diagnostic.lastSelfChat ? (
                  <p>
                    Última: {new Date(diagnostic.lastSelfChat.sentAt).toLocaleString("pt-BR")} ·
                    identificador {diagnostic.lastSelfChat.hasId ? "presente" : "ausente"}
                  </p>
                ) : (
                  <p>Envie uma mensagem para si mesmo no WhatsApp e rode o diagnóstico de novo.</p>
                )}
                <p>
                  Resposta na mesma conversa: {diagnostic.canReply ? "disponível" : "indisponível"}
                </p>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="wa-test-phone">
                Número autorizado (o número conectado ao WhatsApp)
              </Label>
              <Input
                id="wa-test-phone"
                value={authorizedPhone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Ex.: 5511999998888"
                maxLength={40}
                disabled={busy || status.enabled}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={onDiagnostic} disabled={busy}>
                <Activity />
                Diagnosticar (sem envio)
              </Button>
              {status.enabled ? (
                <Button variant="destructive" onClick={() => void onToggle(false)} disabled={busy}>
                  <PowerOff />
                  Desativar respostas
                </Button>
              ) : (
                <Button
                  onClick={() => void onToggle(true)}
                  disabled={busy || !status.openaiConfigured}
                >
                  <Power />
                  Ativar respostas
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Sem limite de respostas por hora · consumo conforme uso da OpenAI
            </p>
          </div>
        </div>

        <div className="mt-6 border-t pt-5">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="wa-crm-read">
                IA pode ver leads e conversão do funil (só leitura)
              </Label>
              <p className="mt-1 text-xs text-muted-foreground">
                {status.crmReadEnabled ? "Autorizadas no seu WhatsApp" : "Desligadas"}
              </p>
            </div>
            <Switch
              id="wa-crm-read"
              checked={status.crmReadEnabled}
              onCheckedChange={(enabled) => void onReadToggle(enabled)}
              disabled={busy || (!status.enabled && !status.crmReadEnabled)}
            />
          </div>
          <div className="mb-5 flex items-center justify-between gap-4 border-t pt-5">
            <div>
              <Label htmlFor="wa-crm-finance">
                IA pode consultar financeiro e valores de vendas
              </Label>
              <p className="mt-1 text-xs text-muted-foreground">
                {status.crmFinanceEnabled
                  ? "Autorizado no seu WhatsApp · somente leitura"
                  : "Desligado"}
              </p>
            </div>
            <Switch
              id="wa-crm-finance"
              checked={status.crmFinanceEnabled}
              onCheckedChange={(enabled) => void onFinanceToggle(enabled)}
              disabled={
                busy || ((!status.enabled || !status.crmReadEnabled) && !status.crmFinanceEnabled)
              }
            />
          </div>
          <div className="flex items-center justify-between gap-4 border-t pt-5">
            <div>
              <Label htmlFor="wa-crm-move">Permitir mover leads pelo meu WhatsApp</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                {status.crmMoveEnabled
                  ? "Autorizado · confirmação obrigatória · etapas padrão"
                  : "Desligado"}
              </p>
            </div>
            <Switch
              id="wa-crm-move"
              checked={status.crmMoveEnabled}
              onCheckedChange={(enabled) => void onMoveToggle(enabled)}
              disabled={
                busy || ((!status.enabled || !status.crmReadEnabled) && !status.crmMoveEnabled)
              }
            />
          </div>
        </div>
      </div>
      <aside
        className="min-w-0 border-t pt-5 xl:border-t-0 xl:border-l xl:pl-6 xl:pt-0"
        aria-label="Histórico de atividades"
      >
        <h3 className="text-lg font-semibold">Histórico de atividades</h3>
        {status.logs.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nenhuma atividade registrada ainda.</p>
        ) : (
          <ul className="mt-4 max-h-[650px] space-y-4 overflow-y-auto pr-2 text-sm">
            {status.logs.map((log) => (
              <li
                key={log.id}
                className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 border-b pb-4"
              >
                <span className="text-xs text-muted-foreground">
                  {new Date(log.created_at).toLocaleString("pt-BR")}
                </span>
                <span className="font-medium">{EVENT_LABELS[log.event] ?? log.event}</span>
                <span
                  className={
                    log.status === "error" || log.status === "sync_error"
                      ? "text-destructive"
                      : log.status === "skipped"
                        ? "text-muted-foreground"
                        : "text-primary"
                  }
                >
                  {log.event === "action"
                    ? ({
                        pending: "Aguardando confirmação",
                        moved: "Movido no CRM",
                        cancelled: "Cancelado",
                        expired: "Expirado",
                        stale: "Lead alterado · não movido",
                      }[log.status] ?? "Estado não informado")
                    : (SEND_STATE_LABELS[log.delivered_at ? "delivered" : log.status] ??
                      "Estado não informado")}
                </span>
                {log.body && (
                  <span className="w-full whitespace-pre-wrap break-words text-sm text-foreground">
                    {log.body}
                  </span>
                )}
                {["error", "unknown", "sync_error", "skipped"].includes(log.status) &&
                  log.detail && (
                    <span
                      className={`w-full break-words text-xs ${log.status === "skipped" ? "text-muted-foreground" : "text-destructive"}`}
                    >
                      {log.detail}
                    </span>
                  )}
              </li>
            ))}
          </ul>
        )}
      </aside>
    </section>
  );
}
