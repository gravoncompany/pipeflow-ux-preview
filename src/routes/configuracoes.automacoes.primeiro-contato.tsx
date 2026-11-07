import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { MessageCircle, Save, RefreshCw, ShieldCheck, Send } from "lucide-react";
import { SettingsLayout } from "@/components/crm/SettingsLayout";
import { CrmAuthGate } from "@/components/crm/CrmAuthGate";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { getFirstContact, saveFirstContact, runFirstContactTest, runFullFirstContactTest } from "@/lib/first-contact.functions";
import { FIRST_CONTACT_MESSAGES, FIRST_CONTACT_TEST_PHONE, fixedFirstContactText } from "@/lib/first-contact";

export const Route = createFileRoute("/configuracoes/automacoes/primeiro-contato")({ head: () => ({ meta: [
  { title: "Primeiro Contato · Automações — Gravon CRM" },
  { name: "description", content: "Configuração privada e histórico da abordagem inicial de leads da Gravon." },
  { property: "og:title", content: "Primeiro Contato · Automações — Gravon CRM" },
  { property: "og:description", content: "Mensagens iniciais e acompanhamento de envios autorizados." },
  { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
] }), component: FirstContactPage });
const time = (value: string | null) => value ? new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—";
const statuses: Record<string, string> = { pending: "Aguardando próximo envio", sending: "Envio em verificação", accepted: "Aceita pela Evolution", unknown: "Resultado incerto · não repetir", failed: "Falha", cancelled: "Interrompida", completed: "Concluída" };
function FirstContactPage() {
  const fetch = useServerFn(getFirstContact); const save = useServerFn(saveFirstContact);
  const testSend = useServerFn(runFirstContactTest);
  const fullTestSend = useServerFn(runFullFirstContactTest);
  const query = useQuery({ queryKey: ["first-contact"], queryFn: () => fetch(), retry: false, refetchInterval: q => q.state.data?.fullTest?.state === "running" ? 2000 : false });
  const [enabled, setEnabled] = useState(false); const [interval, setInterval] = useState(10); const [instance, setInstance] = useState("");
  const [stopOnReply, setStopOnReply] = useState(true);
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState("");
  const [firstName, setFirstName] = useState(""); const [testConsent, setTestConsent] = useState(false);
  const [fullName, setFullName] = useState(""); const [fullConsent, setFullConsent] = useState(false);
  const data = query.data;
  useEffect(() => { if (data) { setEnabled(data.settings.enabled); setInterval(data.settings.interval_seconds); setStopOnReply(data.settings.stop_on_reply); setInstance(data.settings.instance || data.channels[0]?.instance || ""); } }, [data]);
  async function submit() {
    if (!data || busy) return; setBusy(true); setNotice("");
    try { await save({ data: { enabled, interval, stopOnReply, instance, revision: data.settings.revision } }); setNotice("Configuração salva."); await query.refetch(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível salvar."); }
    finally { setBusy(false); }
  }
  async function sendTest() {
    if (!data || busy || !testConsent || data.controlledTest) return;
    setBusy(true); setNotice("");
    try {
      const result = await testSend({ data: { phone: FIRST_CONTACT_TEST_PHONE, firstName, consent: true, instance } });
      setNotice(result?.historySaved ? "Teste registrado em Conversas. Confira o estado de entrega abaixo." : "Confira o resultado do teste; não repita o envio.");
      await query.refetch();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível concluir o teste."); await query.refetch(); }
    finally { setBusy(false); }
  }
  async function sendFullTest() {
    if (!data || busy || !fullConsent || data.fullTest) return;
    setBusy(true); setNotice("Sequência de teste iniciada.");
    const refresh = window.setInterval(() => void query.refetch(), 2000);
    try {
      const result = await fullTestSend({ data: { phone: FIRST_CONTACT_TEST_PHONE, firstName: fullName, consent: true, instance } });
      setNotice(result?.state === "completed" ? "Quatro mensagens aceitas e registradas em Conversas." : result?.state === "cancelled" ? "Sequência interrompida; os envios restantes foram cancelados." : "Confira o resultado; não repita o teste.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Resultado pendente; não repita o teste."); }
    finally { window.clearInterval(refresh); setBusy(false); await query.refetch(); }
  }
  if (query.isError && query.error instanceof Error && query.error.message === "Entre com acesso completo ao CRM.") return <CrmAuthGate onUnlock={() => void query.refetch()} />;
  return <SettingsLayout><main className="min-w-0 flex-1 px-5 py-7 md:px-10"><div className="mx-auto max-w-5xl">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-6"><h1 className="flex items-center gap-3 text-2xl font-semibold"><MessageCircle className="size-7 text-primary" />Primeiro Contato</h1><Button variant="outline" size="icon" title="Atualizar histórico" aria-label="Atualizar histórico" onClick={() => void query.refetch()} disabled={query.isFetching}><RefreshCw className={query.isFetching ? "animate-spin" : ""} /></Button></header>
    {query.isPending && <p className="py-10 text-muted-foreground">Carregando…</p>}
    {query.isError && <section className="py-10"><ShieldCheck className="mb-4 size-8 text-muted-foreground" /><h2 className="text-lg font-semibold">Acesso administrativo necessário</h2><p className="my-4 text-muted-foreground">Entre com sua conta administrativa e o acesso completo ao CRM.</p><Button asChild><Link to="/auth">Entrar com minha conta</Link></Button></section>}
    {data && <>
      {notice && <p role="status" className="mt-5 rounded-md border p-3 text-sm">{notice}</p>}
      <section className="border-b py-7"><div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-lg font-semibold">Automação</h2><p className="mt-1 text-sm text-muted-foreground">{data.settings.enabled ? "Ativada" : "Desativada"} · Funil principal</p></div><Switch aria-label="Ativar primeiro contato" checked={enabled} onCheckedChange={setEnabled} disabled={busy || !data.settings.runtime_ready && !enabled} /></div>
        {!data.settings.runtime_ready && <p className="mt-4 text-sm text-muted-foreground">Ativação bloqueada · publicação e preparação do agendamento privado pendentes.</p>}
        <div className="mt-6 grid gap-5 sm:grid-cols-2"><div><Label htmlFor="first-contact-instance">WhatsApp conectado</Label><select id="first-contact-instance" className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm" value={instance} onChange={e => setInstance(e.target.value)}>{data.channels.map((c, i) => <option key={`${c.instance}-${i}`} value={c.instance}>{c.instance}</option>)}</select></div><div><Label htmlFor="first-contact-interval">Intervalo entre mensagens · segundos</Label><Input id="first-contact-interval" className="mt-2" type="number" min={5} max={300} value={interval} onChange={e => setInterval(Number(e.target.value))} /></div></div>
        <div className="mt-6 flex items-center justify-between gap-4"><Label htmlFor="first-contact-stop-reply">Interromper sequência quando o lead responder</Label><Switch id="first-contact-stop-reply" checked={stopOnReply} onCheckedChange={setStopOnReply} disabled={busy} /></div>
        <div className="mt-5 flex justify-end"><Button disabled={busy || !instance || !Number.isInteger(interval) || interval < 5 || interval > 300} onClick={() => void submit()}><Save />{busy ? "Salvando…" : "Salvar configuração"}</Button></div>
      </section>
      <section className="border-b py-7"><h2 className="mb-3 text-lg font-semibold">Teste controlado · sequência completa</h2>
        <p className="text-sm text-muted-foreground">+55 (51) 99998-6839 · 4 mensagens · intervalo de 10 segundos · interromper ao responder</p>
        {data.fullTest ? <div className="mt-5 space-y-4">
          <p className="font-medium">{data.fullTest.state === "running" ? "Teste em andamento" : statuses[data.fullTest.state]}</p>
          <p className="text-xs text-muted-foreground">{time(data.fullTest.started_at)}{data.fullTest.reason ? ` · ${data.fullTest.reason === "lead_replied" || data.fullTest.reason === "reply_or_authorization_changed" ? "Resposta recebida ou autorização alterada; sequência encerrada" : data.fullTest.reason}` : ""}</p>
          <ol className="space-y-3">{data.fullTest.attempts.map(a => <li key={a.step} className="border-l pl-3"><p className="text-sm">{a.step}. {a.body}</p><p className="mt-1 text-xs text-muted-foreground">{statuses[a.state]} · {time(a.accepted_at ?? a.attempted_at)} · {a.historySaved ? "Salvo em Conversas" : "Histórico pendente"}</p></li>)}</ol>
          <Button asChild variant="outline"><Link to="/whatsapp"><MessageCircle />Conversas</Link></Button>
        </div> : <div className="mt-5 space-y-4">
          <div className="max-w-sm"><Label htmlFor="full-test-first-name">Primeiro nome do destinatário</Label><Input id="full-test-first-name" className="mt-2" value={fullName} onChange={e => setFullName(e.target.value)} maxLength={80} disabled={busy} /></div>
          <div className="flex items-start gap-3"><Checkbox id="full-test-consent" checked={fullConsent} onCheckedChange={v => setFullConsent(v === true)} disabled={busy} /><Label htmlFor="full-test-consent" className="leading-relaxed">Autorizo as quatro mensagens de teste exclusivamente para meu número acima.</Label></div>
          <Button onClick={() => void sendFullTest()} disabled={busy || !instance || !fullConsent || !fullName.trim() || data.settings.enabled || data.settings.runtime_ready}><Send />{busy ? "Teste em andamento…" : "Iniciar teste completo"}</Button>
        </div>}
      </section>
      <section className="border-b py-7"><h2 className="mb-5 text-lg font-semibold">Teste controlado · mensagem inicial</h2>
        <p className="text-sm text-muted-foreground">Destinatário autorizado: +55 (51) 99998-6839</p>
        {data.controlledTest ? <div className="mt-4 space-y-3"><p className="text-sm">{data.controlledTest.body}</p><p className="text-sm font-medium">{data.controlledTest.delivery === "read" ? "Leitura confirmada" : data.controlledTest.delivery === "delivered" ? "Entrega confirmada" : statuses[data.controlledTest.state]}</p><p className="text-xs text-muted-foreground">{time(data.controlledTest.accepted_at ?? data.controlledTest.created_at)} · {data.controlledTest.historySaved ? "Salvo em Conversas" : "Histórico ainda não confirmado"}</p>{data.controlledTest.error_code && <p className="text-xs text-muted-foreground">{data.controlledTest.error_code}</p>}</div> : <div className="mt-5 space-y-4">
          <div className="max-w-sm"><Label htmlFor="test-first-name">Primeiro nome do destinatário</Label><Input id="test-first-name" className="mt-2" value={firstName} onChange={e => setFirstName(e.target.value)} maxLength={80} disabled={busy} /></div>
          {firstName.trim() && <p className="border-l pl-3 text-sm">{fixedFirstContactText(1, firstName.trim())}</p>}
          <div className="flex items-start gap-3"><Checkbox id="test-consent" checked={testConsent} onCheckedChange={v => setTestConsent(v === true)} disabled={busy} /><Label htmlFor="test-consent" className="leading-relaxed">Autorizo uma única mensagem de teste para este número pelo WhatsApp selecionado.</Label></div>
          <Button onClick={() => void sendTest()} disabled={busy || !instance || !testConsent || !firstName.trim() || data.settings.enabled || data.settings.runtime_ready}><Send />{busy ? "Conferindo teste…" : "Enviar mensagem inicial de teste"}</Button>
        </div>}
      </section>
      <section className="border-b py-7"><h2 className="mb-5 text-lg font-semibold">Mensagens · ordem de envio</h2><ol className="divide-y">{FIRST_CONTACT_MESSAGES.map((text, i) => <li key={i} className="flex gap-4 py-4"><span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium">{i + 1}</span><p className="min-w-0 pt-1 text-sm leading-relaxed">{text}</p></li>)}</ol></section>
      <section className="py-7"><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Histórico da automação</h2><Button asChild variant="outline"><Link to="/whatsapp"><MessageCircle />Conversas</Link></Button></div>
        {!data.sequences.length && <p className="py-8 text-sm text-muted-foreground">Nenhuma sequência registrada.</p>}
        <div className="divide-y">{data.sequences.map(q => <article key={q.id} className="py-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{q.lead_name}</h3><p className="mt-1 text-sm text-muted-foreground">{q.phone} · {time(q.started_at)}</p></div><span className="text-sm font-medium">{statuses[q.state] ?? q.state}</span></div><dl className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2"><div>Conclusão: {time(q.completed_at)}</div><div>Movimentação: {q.moved_at ? `Tentando Contato · ${time(q.moved_at)}` : "Não realizada"}</div></dl>{q.reason && <p className="mt-3 break-words text-xs text-muted-foreground">{q.reason}</p>}<ol className="mt-4 space-y-3">{data.attempts.filter(a => a.sequence_id === q.id).map(a => <li key={a.step} className="border-l pl-3"><p className="text-sm">{a.step}. {a.body}</p><p className="mt-1 break-words text-xs text-muted-foreground">{statuses[a.state]} · {time(a.accepted_at ?? a.attempted_at)}{a.error_code ? ` · ${a.error_code}` : ""}</p></li>)}</ol></article>)}</div>
      </section>
    </>}
  </div></main></SettingsLayout>;
}