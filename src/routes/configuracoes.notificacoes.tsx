import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Bell, BellRing, Mail, MessageSquare, Smartphone, Trash2 } from "lucide-react";
import { SettingsLayout } from "@/components/crm/SettingsLayout";
import { CrmAuthGate } from "@/components/crm/CrmAuthGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  getPushConfig, subscribePush, unsubscribePush,
  getNotificationCenter, setNotificationPref, setNotificationTargets,
} from "@/lib/notifications.functions";
import { activatePush, currentPushEndpoint, deactivatePush, pushSupported } from "@/lib/push-client";
import { NOTIFICATION_CHANNEL_LABEL, NOTIFICATION_EVENT_LABEL, type NotificationChannel } from "@/lib/notifications";

export const Route = createFileRoute("/configuracoes/notificacoes")({
  head: () => ({ meta: [
    { title: "Notificações · Configurações — PipeFlow CRM" },
    { name: "description", content: "Central de Notificações: avisos por push, e-mail e WhatsApp sobre respostas da prospecção." },
    { property: "og:title", content: "Notificações · Configurações — PipeFlow CRM" },
    { property: "og:description", content: "Canais e eventos de aviso do PipeFlow CRM." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: NotificationsSettingsPage,
});

const CHANNEL_ICON: Record<NotificationChannel, typeof Bell> = { push: Smartphone, email: Mail, whatsapp: MessageSquare };
const STATUS_LABEL: Record<string, string> = { sent: "Enviada", failed: "Falhou", pending: "Enviando", skipped: "Ignorada" };
const time = (v: string) => new Date(v).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

function NotificationsSettingsPage() {
  const queryClient = useQueryClient();
  const centerFn = useServerFn(getNotificationCenter);
  const pushConfigFn = useServerFn(getPushConfig);
  const subscribeFn = useServerFn(subscribePush);
  const unsubscribeFn = useServerFn(unsubscribePush);
  const prefFn = useServerFn(setNotificationPref);
  const targetsFn = useServerFn(setNotificationTargets);

  const query = useQuery({ queryKey: ["notification-center"], queryFn: () => centerFn(), retry: false });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [email, setEmail] = useState<string | null>(null);
  const [whatsapp, setWhatsapp] = useState<string | null>(null);
  const [thisDevice, setThisDevice] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    void currentPushEndpoint().then(setThisDevice);
  }, []);

  const data = query.data;
  const emailValue = email ?? data?.emailTarget ?? "";
  const whatsappValue = whatsapp ?? data?.whatsappTarget ?? "";

  async function refresh() { await queryClient.invalidateQueries({ queryKey: ["notification-center"] }); }

  async function activate() {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const cfg = await pushConfigFn();
      if (!cfg.ok) { setError("As chaves de notificação push não estão configuradas no servidor."); return; }
      const activation = await activatePush(cfg.publicKey);
      if (!activation.ok) { setError(activation.error); return; }
      const registration = await navigator.serviceWorker.getRegistration("/push-sw.js");
      const subscription = await registration?.pushManager.getSubscription();
      const json = subscription?.toJSON();
      if (!json?.endpoint || !json.keys?.p256dh || !json.keys?.auth) { setError("Inscrição push incompleta neste dispositivo."); return; }
      const saved = await subscribeFn({ data: { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth, userAgent: navigator.userAgent.slice(0, 300) } });
      if (!saved.ok) { setError(saved.error); return; }
      setNotice("Notificações ativadas neste dispositivo.");
      setThisDevice(json.endpoint);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao ativar as notificações.");
    } finally { setBusy(false); }
  }

  async function deactivate() {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const endpoint = await deactivatePush();
      if (endpoint) await unsubscribeFn({ data: { endpoint } });
      setNotice("Notificações desativadas neste dispositivo.");
      setThisDevice(null);
      await refresh();
    } finally { setBusy(false); }
  }

  async function toggle(event: string, channel: string, enabled: boolean) {
    setError("");
    const r = await prefFn({ data: { event, channel, enabled } });
    if (!r.ok) setError(r.error ?? "Não foi possível salvar.");
    await refresh();
  }

  async function saveTargets() {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const r = await targetsFn({ data: { email: emailValue.trim(), whatsapp: whatsappValue.trim() } });
      if (!r.ok) { setError(r.error ?? "Não foi possível salvar."); return; }
      setNotice("Destinatários salvos.");
      setEmail(null); setWhatsapp(null);
      await refresh();
    } finally { setBusy(false); }
  }

  if (query.isError) return <CrmAuthGate onUnlock={() => void query.refetch()} />;

  return (
    <SettingsLayout>
        <div className="mx-auto max-w-3xl space-y-6 p-4">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold"><BellRing className="h-5 w-5" /> Central de Notificações</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Escolha como o Pipeflow avisa você sobre os eventos comerciais. Tudo nasce desligado; ative só o que quiser receber.
            </p>
          </div>

          {error ? <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
          {notice ? <p className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">{notice}</p> : null}

          <section className="space-y-3 rounded-lg border bg-card p-4">
            <h2 className="flex items-center gap-2 font-medium"><Smartphone className="h-4 w-4" /> Notificações neste dispositivo</h2>
            <p className="text-sm text-muted-foreground">
              No iPhone, instale o Pipeflow pela opção “Adicionar à Tela de Início” do Safari e abra pelo ícone antes de ativar.
              Com o aplicativo fechado, os avisos continuam chegando quando o dispositivo permite.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {thisDevice ? (
                <>
                  <Badge variant="secondary">Ativadas neste dispositivo</Badge>
                  <Button variant="outline" size="sm" onClick={deactivate} disabled={busy}>Desativar neste dispositivo</Button>
                </>
              ) : (
                <Button size="sm" onClick={activate} disabled={busy || (mounted && !pushSupported())}>
                  <Bell className="mr-2 h-4 w-4" /> Ativar notificações
                </Button>
              )}
            </div>
            {mounted && !pushSupported() ? (
              <p className="text-sm text-muted-foreground">Este navegador não aceita notificações push. No iPhone, use o Safari e instale o app na Tela de Início.</p>
            ) : null}
            {(data?.devices.length ?? 0) > 0 ? (
              <p className="text-sm text-muted-foreground">Dispositivos com notificações ativas: {data?.devices.length}</p>
            ) : null}
          </section>

          <section className="space-y-3 rounded-lg border bg-card p-4">
            <h2 className="font-medium">Destinatários dos avisos</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="notif-email">E-mail para avisos</Label>
                <Input id="notif-email" type="email" value={emailValue} onChange={(e) => setEmail(e.target.value)} placeholder="voce@empresa.com" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="notif-wa">WhatsApp para avisos</Label>
                <Input id="notif-wa" value={whatsappValue} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+55 41 99999-0000" />
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={saveTargets} disabled={busy}>Salvar destinatários</Button>
          </section>

          <section className="space-y-3 rounded-lg border bg-card p-4">
            <h2 className="font-medium">Eventos e canais</h2>
            {(data?.prefs ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Carregando preferências…</p> : null}
            {NOTIFICATION_EVENTS_SAFE.map((event) => (
              <div key={event} className="rounded-md border p-3">
                <p className="mb-2 text-sm font-medium">{NOTIFICATION_EVENT_LABEL[event]}</p>
                <div className="flex flex-wrap gap-4">
                  {(data?.prefs ?? []).filter((p) => p.event === event).map((p) => {
                    const Icon = CHANNEL_ICON[p.channel];
                    return (
                      <label key={p.channel} className="flex items-center gap-2 text-sm">
                        <Switch checked={p.enabled} onCheckedChange={(v) => toggle(p.event, p.channel, v)} />
                        <Icon className="h-4 w-4 text-muted-foreground" /> {NOTIFICATION_CHANNEL_LABEL[p.channel]}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
            <p className="text-sm text-muted-foreground">
              Quando um contato responde um e-mail da prospecção, a sequência pausa sozinha (como já acontece hoje) e o Pipeflow avisa você pelos canais ligados. A Pipeflow IA continua apenas sugerindo o próximo atendimento — nunca responde automaticamente.
            </p>
          </section>

          <section className="space-y-3 rounded-lg border bg-card p-4">
            <h2 className="font-medium">Últimas notificações</h2>
            {(data?.log.length ?? 0) === 0 ? <p className="text-sm text-muted-foreground">Nenhuma notificação enviada ainda.</p> : null}
            <ul className="divide-y text-sm">
              {(data?.log ?? []).map((n) => (
                <li key={n.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{n.title}</p>
                    <p className="text-xs text-muted-foreground">{NOTIFICATION_CHANNEL_LABEL[n.channel as NotificationChannel] ?? n.channel} · {time(n.created_at)}</p>
                  </div>
                  <Badge variant={n.status === "sent" ? "secondary" : n.status === "failed" ? "destructive" : "outline"} title={n.error || undefined}>
                    {STATUS_LABEL[n.status] ?? n.status}
                  </Badge>
                </li>
              ))}
            </ul>
          </section>
        </div>
    </SettingsLayout>
  );
}

const NOTIFICATION_EVENTS_SAFE = ["email_reply"] as const;
