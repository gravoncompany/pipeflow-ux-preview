import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Instagram, ShieldCheck, RefreshCw, Save, Copy, MessageCircle, AlertCircle } from "lucide-react";
import { SettingsLayout } from "@/components/crm/SettingsLayout";
import { CrmAuthGate } from "@/components/crm/CrmAuthGate";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { instagramOAuthFailureText } from "@/lib/instagram-oauth-diagnostics";
import { Switch } from "@/components/ui/switch";
import { getInstagram, connectInstagramAccount, saveInstagramSettings, subscribeInstagramAccount, getInstagramConversation, beginInstagramOAuth, completeInstagramOAuth } from "@/lib/instagram.functions";

export const Route = createFileRoute("/configuracoes/integracoes/instagram")({
  head: () => ({ meta: [
    { title: "Instagram · Integrações — PipeFlow CRM" },
    { name: "description", content: "Configuração administrativa de directs do Instagram, saudação e conversas da empresa." },
    { property: "og:title", content: "Instagram · Integrações — PipeFlow CRM" },
    { property: "og:description", content: "Directs do Instagram com configuração privada e histórico de conversas." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }), component: InstagramSettingsPage,
});
const time = (v: string | null) => v ? new Date(v).toLocaleString("pt-BR") : "Não disponível";
const greetingStatus: Record<string, string> = { skipped: "Sem saudação", sending: "Envio em verificação — não repetir", accepted: "Saudação aceita pela Meta", unknown: "Resultado incerto — não repetir", failed: "Saudação não enviada" };
function InstagramSettingsPage() {
  const beginOAuth = useServerFn(beginInstagramOAuth); const completeOAuth = useServerFn(completeInstagramOAuth);
  const [appId, setAppId] = useState(""); const [oauthOutcome, setOauthOutcome] = useState("");
  useEffect(() => { setOauthOutcome(new URLSearchParams(window.location.search).get("instagram_oauth") ?? ""); }, []);
  const fetchOverview = useServerFn(getInstagram); const connect = useServerFn(connectInstagramAccount);
  const save = useServerFn(saveInstagramSettings); const subscribe = useServerFn(subscribeInstagramAccount);
  const fetchConversation = useServerFn(getInstagramConversation);
  const query = useQuery({ queryKey: ["instagram-overview"], queryFn: () => fetchOverview(), retry: false, refetchInterval: 15000 });
  const [selected, setSelected] = useState(""); const [greeting, setGreeting] = useState(""); const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(""); const [notice, setNotice] = useState(""); const [contactId, setContactId] = useState("");
  const data = query.data && !query.data.needsAuth ? query.data : undefined;
  const account = data?.accounts.find(a => a.id === selected) ?? data?.accounts[0];
  useEffect(() => { setGreeting(account?.greeting ?? ""); setEnabled(account?.greeting_enabled ?? false); }, [account?.id, account?.greeting, account?.greeting_enabled]);
  const conversation = useQuery({ queryKey: ["instagram-conversation", contactId], queryFn: () => fetchConversation({ data: { contactId } }), enabled: Boolean(contactId) && Boolean(data), retry: false, refetchInterval: 10000 });
  async function action(name: string, work: () => Promise<unknown>, success: string) {
    if (busy) return; setBusy(name); setNotice("");
    try { await work(); setNotice(success); await query.refetch(); } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível concluir."); } finally { setBusy(""); }
  }
  if (query.data?.needsAuth) return <CrmAuthGate onUnlock={() => void query.refetch()} />;
  return <SettingsLayout>
    <main className="min-w-0 flex-1 px-5 py-7 md:px-10">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
          <div><div className="flex items-center gap-3"><Instagram className="size-7 text-primary" /><h1 className="text-2xl font-semibold">Instagram</h1></div><p className="mt-2 text-sm text-muted-foreground">Central de configurações do Pipeflow.</p><p className="mt-2 text-sm text-muted-foreground">Directs · Conta profissional</p></div>
          <Button variant="outline" size="icon" aria-label="Atualizar conexão" title="Atualizar conexão" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw className={query.isFetching ? "animate-spin" : ""} /></Button>
        </header>
        {query.isPending && <p className="py-10 text-muted-foreground">Carregando…</p>}
        {query.isError && <section className="py-10"><ShieldCheck className="mb-3 size-8 text-muted-foreground" /><h2 className="text-lg font-semibold">Acesso administrativo necessário</h2><p className="my-3 text-sm text-muted-foreground">Entre com sua conta administrativa e o acesso completo do CRM.</p><Button asChild><Link to="/auth">Entrar com minha conta</Link></Button></section>}
        {data && <>
          {notice && <p role="status" className="my-5 flex items-start gap-2 rounded-md border p-3 text-sm"><AlertCircle className="mt-0.5 size-4 shrink-0" />{notice}</p>}
          <section className="border-b py-7">
            <h2 className="mb-4 text-lg font-semibold">Instagram Business Login</h2>
            <div className="flex max-w-xl flex-wrap items-end gap-3"><div className="min-w-48 flex-1"><Label htmlFor="instagram-app-id">ID do aplicativo Instagram</Label><Input id="instagram-app-id" className="mt-2" inputMode="numeric" maxLength={40} value={appId} onChange={e => setAppId(e.target.value)} /></div><Button disabled={Boolean(busy) || !data.oauthReady || !/^\d{1,40}$/.test(appId)} onClick={() => void action("oauth", async () => { const result = await beginOAuth({ data: { appId } }); window.location.assign(result.url); }, "Abrindo Instagram…")}><Instagram />Conectar pelo Instagram</Button></div>
            <Label className="mt-5 block">URL de redirecionamento OAuth</Label><code className="mt-2 block break-all text-xs text-muted-foreground">{data.oauthCallback}</code>
            {(oauthOutcome === "failed" || data.oauthLatest?.status === "failed") && <p role="alert" className="mt-4 text-sm text-destructive">{instagramOAuthFailureText(data.oauthLatest?.diagnostic_stage ?? null, data.oauthLatest?.diagnostic_code ?? null)}</p>}
            {data.oauthLatest && <p className="mt-3 text-xs text-muted-foreground">Última tentativa: {time(data.oauthLatest.created_at)} · {data.oauthLatest.status === "failed" ? "Não concluída" : data.oauthLatest.status === "complete" ? "Concluída" : data.oauthLatest.status === "ready" ? "Aguardando confirmação" : "Em andamento"}{data.oauthLatest.diagnostic_http_status ? ` · Meta HTTP ${data.oauthLatest.diagnostic_http_status}` : ""}</p>}
            {oauthOutcome === "ready" && <Button className="mt-4" disabled={Boolean(busy)} onClick={() => void action("finish-oauth", async () => { const result = await completeOAuth(); setSelected(result.accountId); setOauthOutcome(""); window.history.replaceState(null, "", window.location.pathname); setNotice(result.preserved ? "Conta atual preservada; autorização confirmada." : "Conta profissional conectada. Assine messages para receber directs."); }, "Autorização confirmada. Conexão atual preservada.")}><ShieldCheck />Concluir conexão autorizada</Button>}
          </section>
          <section className="grid gap-6 border-b py-7 md:grid-cols-2">
            <div><h2 className="mb-4 text-lg font-semibold">Conta e conexão</h2>
              {data.accounts.length > 1 && <select className="mb-3 w-full rounded-md border bg-background p-2" value={account?.id} onChange={e => { setSelected(e.target.value); setContactId(""); }} aria-label="Conta Instagram">{data.accounts.map(a => <option key={a.id} value={a.id}>@{a.username}</option>)}</select>}
              <p className="text-xl font-semibold">{account ? `@${account.username}` : "Nenhuma conta vinculada"}</p>
              {account && <p className="mt-1 break-all text-xs text-muted-foreground">ID Instagram: {account.instagram_id}</p>}
              <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-sm"><dt className="text-muted-foreground">Credenciais privadas</dt><dd>{data.credentialsSet ? "Configuradas" : "Pendentes"}</dd><dt className="text-muted-foreground">Verificação do webhook</dt><dd>{data.verificationSet ? "Configurada" : "Pendente"}</dd><dt className="text-muted-foreground">Última consulta à Meta</dt><dd>{time(account?.checked_at ?? null)}</dd><dt className="text-muted-foreground">Assinatura de mensagens</dt><dd>{account?.subscribed_at ? "Confirmada pela Meta" : "Pendente"}</dd><dt className="text-muted-foreground">Último evento recebido</dt><dd>{time(account?.last_event_at ?? null)}</dd></dl>
              {account?.error_code && <p className="mt-4 break-words text-sm text-destructive">{account.error_code}</p>}
              <Button className="mt-5" disabled={Boolean(busy) || !data.credentialsSet} onClick={() => void action("connect", () => connect(), "Conta verificada e vinculada.")}><ShieldCheck />{busy === "connect" ? "Verificando…" : account ? "Verificar conta na Meta" : "Verificar e vincular conta"}</Button>
            </div>
            <div><h2 className="mb-4 text-lg font-semibold">Webhook</h2><Label>URL de callback</Label><div className="mt-2 flex items-start gap-2"><code className="min-w-0 flex-1 break-all rounded-md border bg-muted p-3 text-xs">{data.callback}</code><Button variant="outline" size="icon" title="Copiar URL" aria-label="Copiar URL" onClick={() => void navigator.clipboard.writeText(data.callback).then(() => setNotice("URL copiada."))}><Copy /></Button></div><dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><dt className="text-muted-foreground">Objeto</dt><dd>Instagram</dd><dt className="text-muted-foreground">Evento</dt><dd><code>messages</code></dd><dt className="text-muted-foreground">Token de verificação</dt><dd>{data.verificationSet ? "Salvo em configuração segura" : "Configuração externa pendente"}</dd></dl><Button className="mt-5" variant="outline" disabled={!account || !data.verificationSet || Boolean(busy)} onClick={() => account && void action("subscribe", () => subscribe({ data: { id: account.id } }), "Conta assinada para receber messages.")}><RefreshCw />{busy === "subscribe" ? "Assinando…" : "Assinar mensagens na Meta"}</Button></div>
          </section>
          <section className="border-b py-7"><div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">Saudação no primeiro contato</h2><Switch aria-label="Ativar saudação no primeiro contato" checked={enabled} onCheckedChange={setEnabled} disabled={!account || Boolean(busy)} /></div><Label htmlFor="instagram-greeting">Mensagem</Label><Textarea id="instagram-greeting" className="mt-2 max-w-3xl" rows={3} maxLength={1000} placeholder="Escreva a saudação da sua empresa" value={greeting} disabled={!account} onChange={e => setGreeting(e.target.value)} /><div className="mt-3 flex items-center justify-between gap-4"><span className="text-xs text-muted-foreground">{greeting.length}/1.000 · {enabled ? "Ativada" : "Desativada"}</span><Button disabled={!account || Boolean(busy) || enabled && !greeting.trim()} onClick={() => account && void action("save", () => save({ data: { id: account.id, settings: { greetingEnabled: enabled, greeting } } }), "Saudação salva.")}><Save />{busy === "save" ? "Salvando…" : "Salvar saudação"}</Button></div></section>
          <section className="border-b py-7"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Recebimento e gravação no CRM</h2><Button asChild variant="outline"><Link to="/whatsapp"><MessageCircle />Abrir Conversas</Link></Button></div><dl className="mt-5 grid gap-4 sm:grid-cols-3"><div><dt className="text-sm text-muted-foreground">Contatos gravados</dt><dd className="mt-1 text-2xl font-semibold">{data.storage.contacts ?? "—"}</dd></div><div><dt className="text-sm text-muted-foreground">Mensagens gravadas</dt><dd className="mt-1 text-2xl font-semibold">{data.storage.messages ?? "—"}</dd></div><div><dt className="text-sm text-muted-foreground">Última gravação</dt><dd className="mt-2 text-sm">{time(data.storage.latestReceivedAt)}</dd></div></dl></section>
          <section className="py-7"><h2 className="mb-5 flex items-center gap-2 text-lg font-semibold"><MessageCircle className="size-5" />Contatos e directs</h2>
            <div className="grid min-h-64 gap-6 lg:grid-cols-[280px_1fr]">
              <div className="space-y-2">{data.contacts.filter(c => !account || c.account_id === account.id).map(c => <Button key={c.id} variant={contactId === c.id ? "secondary" : "ghost"} className="h-auto w-full justify-start whitespace-normal py-3 text-left" onClick={() => setContactId(c.id)}><div className="min-w-0"><p className="break-all text-sm">Instagram · {c.sender_id}</p><p className="mt-1 text-xs font-normal text-muted-foreground">{time(c.last_inbound_at)}</p><p className="mt-1 text-xs font-normal text-muted-foreground">{greetingStatus[c.greeting_state]}</p></div></Button>)}{!data.contacts.length && <p className="text-sm text-muted-foreground">Nenhum direct recebido.</p>}</div>
              <div className="min-w-0 border-l pl-5">{!contactId ? <p className="text-sm text-muted-foreground">Nenhuma conversa selecionada.</p> : conversation.isError ? <p className="text-destructive">Não foi possível consultar a conversa.</p> : conversation.isPending ? <p>Carregando conversa…</p> : <div className="flex max-h-[600px] flex-col gap-4 overflow-y-auto">{conversation.data?.messages.map(m => <article key={m.id} className={`max-w-[90%] rounded-md border p-3 ${m.from_me ? "self-end bg-muted" : "self-start bg-card"}`}><p className="mb-1 text-xs font-medium text-muted-foreground">{m.from_me ? "Sua conta" : "Contato Instagram"}</p><p className="whitespace-pre-wrap break-words text-sm">{m.kind === "deleted" ? "Mensagem removida" : m.body || (m.kind === "attachment" ? "Anexo recebido" : "Evento sem texto")}</p><p className="mt-2 text-xs text-muted-foreground">{time(m.sent_at)}{m.send_state === "accepted" ? " · Aceita pela Meta, entrega não confirmada" : ""}</p></article>)}</div>}</div>
            </div>
          </section>
        </>}
      </div>
    </main>
  </SettingsLayout>;
}