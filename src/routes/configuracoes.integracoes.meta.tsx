import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AlertCircle, CheckCircle2, KeyRound, RefreshCw, Save, Send, ShieldCheck, Trash2, Activity } from "lucide-react";
import { SettingsLayout } from "@/components/crm/SettingsLayout";
import { CrmAuthGate } from "@/components/crm/CrmAuthGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { capiFailureText, pixelIdSchema, capiTokenSchema, testEventCodeSchema } from "@/lib/meta-capi";
import { getQualifiedLeadEventsSummary } from "@/lib/lead-ai-qualification.functions";
import { metaEventLabel } from "@/lib/lead-ai-qualification";
import { getMetaCapi, saveMetaCapi, checkMetaCapi, testMetaCapiEvent, toggleMetaCapi, removeMetaCapi } from "@/lib/meta-capi.functions";

export const Route = createFileRoute("/configuracoes/integracoes/meta")({
  head: () => ({ meta: [
    { title: "Meta · API de Conversões — PipeFlow CRM" },
    { name: "description", content: "Configuração privada do Pixel e do token da API de Conversões da Meta, com teste de conexão." },
    { property: "og:title", content: "Meta · API de Conversões — PipeFlow CRM" },
    { property: "og:description", content: "ID do Pixel, token guardado só no servidor e teste de conexão com a Meta." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: MetaCapiPage,
});

const time = (v: string | null | undefined) => (v ? new Date(v).toLocaleString("pt-BR") : "Nunca");
type Notice = { kind: "ok" | "error"; text: string } | null;

function MetaCapiPage() {
  const fetchOverview = useServerFn(getMetaCapi); const save = useServerFn(saveMetaCapi); const check = useServerFn(checkMetaCapi);
  const sendTest = useServerFn(testMetaCapiEvent); const toggle = useServerFn(toggleMetaCapi); const remove = useServerFn(removeMetaCapi);
  const query = useQuery({ queryKey: ["meta-capi"], queryFn: () => fetchOverview(), retry: false });
  const [pixel, setPixel] = useState<string | null>(null); const [token, setToken] = useState(""); const [testCode, setTestCode] = useState("");
  const [busy, setBusy] = useState(""); const [notice, setNotice] = useState<Notice>(null); const [confirmRemove, setConfirmRemove] = useState(false);
  const data = query.data && !query.data.needsAuth ? query.data : undefined;
  const s = data?.settings ?? null;
  const pixelValue = pixel ?? s?.pixel_id ?? "";
  const pixelOk = pixelIdSchema.safeParse(pixelValue).success;
  const tokenOk = token === "" ? Boolean(s) : capiTokenSchema.safeParse(token).success;
  const codeOk = testEventCodeSchema.safeParse(testCode).success;

  async function run(name: string, work: () => Promise<Notice>) {
    if (busy) return; setBusy(name); setNotice(null);
    try { setNotice(await work()); await query.refetch(); }
    catch (error) { setNotice({ kind: "error", text: error instanceof Error ? error.message : "Não foi possível concluir." }); }
    finally { setBusy(""); }
  }
  if (query.data?.needsAuth) return <CrmAuthGate onUnlock={() => void query.refetch()} />;

  return <SettingsLayout>
    <main className="min-w-0 flex-1 px-5 py-7 md:px-10">
      <div className="mx-auto max-w-4xl">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
          <div>
            <div className="flex items-center gap-3"><Activity className="size-7 text-primary" /><h1 className="text-2xl font-semibold">API de Conversões da Meta</h1></div>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Liga o Pipeflow ao seu Pixel para, no futuro, avisar a Meta quando um lead vira oportunidade ou venda. Nesta etapa só configuramos e testamos a conexão: nenhum evento real é enviado.</p>
          </div>
          <Button variant="outline" size="icon" aria-label="Atualizar" title="Atualizar" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw className={query.isFetching ? "animate-spin" : ""} /></Button>
        </header>

        {query.isPending && <p className="py-10 text-muted-foreground">Carregando…</p>}
        {query.isError && <section className="py-10"><ShieldCheck className="mb-3 size-8 text-muted-foreground" /><h2 className="text-lg font-semibold">Acesso administrativo necessário</h2><p className="my-3 text-sm text-muted-foreground">{query.error instanceof Error ? query.error.message : "Entre com sua conta administrativa."}</p><Button asChild><Link to="/auth">Entrar com minha conta</Link></Button></section>}

        {data && <>
          {notice && <p role={notice.kind === "error" ? "alert" : "status"} className={`my-5 flex items-start gap-2 rounded-md border p-3 text-sm ${notice.kind === "error" ? "border-destructive/40 text-destructive" : "border-primary/30 text-foreground"}`}>
            {notice.kind === "error" ? <AlertCircle className="mt-0.5 size-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />}{notice.text}</p>}

          <section className="grid gap-4 border-b py-7 sm:grid-cols-3">
            <Status label="Situação" value={!s ? "Não configurada" : s.enabled ? "Ativa" : "Desativada"} tone={!s ? "muted" : s.enabled ? "ok" : "muted"} />
            <Status label="Última verificação" value={!s?.last_check_at ? "Nunca" : s.last_check_status === "ok" ? "Conexão confirmada" : s.last_check_status === "limited" ? "Token válido" : "Falhou"} detail={s?.last_check_status === "limited" ? "Envie o evento de teste para confirmar o Pixel." : s?.last_check_at ? time(s.last_check_at) : undefined} tone={s?.last_check_status === "ok" ? "ok" : s?.last_check_status === "failed" ? "error" : "muted"} />
            <Status label="Envios reais" value="Desligados" detail="Só eventos de teste, até você validar." tone="muted" />
          </section>

          <section className="border-b py-7">
            <h2 className="text-lg font-semibold">Pixel e token</h2>
            <p className="mt-1 text-sm text-muted-foreground">No Gerenciador de Eventos da Meta, abra o Pixel → Configurações → API de Conversões → Gerar token de acesso.</p>
            <div className="mt-5 grid gap-5 md:grid-cols-2">
              <div>
                <Label htmlFor="pixel-id">ID do Pixel</Label>
                <Input id="pixel-id" className="mt-2" inputMode="numeric" maxLength={25} placeholder="Ex.: 123456789012345" value={pixelValue} onChange={(e) => setPixel(e.target.value.replace(/\D/g, ""))} />
                {s?.pixel_name && <p className="mt-2 text-xs text-muted-foreground">Pixel encontrado: {s.pixel_name}</p>}
              </div>
              <div>
                <Label htmlFor="capi-token">Token de acesso</Label>
                <Input id="capi-token" className="mt-2" type="password" autoComplete="off" spellCheck={false} placeholder={s ? "Token salvo — cole um novo só para trocar" : "Cole o token gerado na Meta"} value={token} onChange={(e) => setToken(e.target.value.trim())} />
                <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><KeyRound className="size-3.5" />Fica guardado cifrado no servidor e nunca volta para a tela.</p>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button disabled={Boolean(busy) || !pixelOk || !tokenOk || !data.keyReady} onClick={() => void run("save", async () => {
                const r = await save({ data: { pixelId: pixelValue, token: token || undefined, revision: s?.revision ?? null } });
                if (!r.saved) return { kind: "error", text: `Nada foi salvo. ${capiFailureText(r.failure)}` };
                setToken(""); setPixel(null);
                return r.limited
                  ? { kind: "ok", text: "Salvo. A Meta confirmou que o token é válido. Tokens gerados no Gerenciador de Eventos servem só para enviar eventos, então o acesso ao Pixel é confirmado pelo evento de teste abaixo." }
                  : { kind: "ok", text: `Salvo. A Meta confirmou acesso ao Pixel${r.pixelName ? ` "${r.pixelName}"` : ""}.` };
              })}><Save />{busy === "save" ? "Verificando com a Meta…" : "Salvar e verificar"}</Button>
              {s && <Button variant="outline" disabled={Boolean(busy)} onClick={() => void run("check", async () => {
                const r = await check();
                if (r.ok && r.limited) return { kind: "ok", text: "Token válido. Para confirmar o Pixel, envie o evento de teste abaixo." };
                return r.ok ? { kind: "ok", text: `Conexão confirmada${r.pixelName ? ` com o Pixel "${r.pixelName}"` : ""}. ${r.lastFired ? `Último evento recebido pela Meta: ${time(r.lastFired)}.` : "A Meta ainda não registrou eventos nesse Pixel."}` } : { kind: "error", text: capiFailureText(r.failure) };
              })}><RefreshCw className={busy === "check" ? "animate-spin" : ""} />Testar conexão</Button>}
            </div>
            {pixelValue && !pixelOk && <p className="mt-3 text-xs text-destructive">O ID do Pixel tem só números (6 a 25 dígitos).</p>}
            {token && !capiTokenSchema.safeParse(token).success && <p className="mt-3 text-xs text-destructive">{capiTokenSchema.safeParse(token).error?.issues[0]?.message}</p>}
          </section>

          {s && <section className="border-b py-7">
            <h2 className="text-lg font-semibold">Evento de teste</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Envia um único evento "Lead" de teste, sem dados de pessoas. Ele aparece só na aba Eventos de teste do Gerenciador de Eventos e não conta como conversão. Copie o código que começa com TEST nessa aba.</p>
            <div className="mt-5 flex max-w-xl flex-wrap items-end gap-3">
              <div className="min-w-48 flex-1"><Label htmlFor="test-code">Código de teste</Label><Input id="test-code" className="mt-2" maxLength={24} placeholder="TEST12345" value={testCode} onChange={(e) => setTestCode(e.target.value.trim())} /></div>
              <Button variant="outline" disabled={Boolean(busy) || !codeOk || !s.enabled} onClick={() => void run("test", async () => {
                const r = await sendTest({ data: { testEventCode: testCode } });
                return r.ok ? { kind: "ok", text: `A Meta aceitou ${r.received} evento de teste. Confira na aba Eventos de teste; pode levar alguns segundos para aparecer.` } : { kind: "error", text: capiFailureText(r.failure) };
              })}><Send />Enviar evento de teste</Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Último teste: {s.last_test_event_at ? `${time(s.last_test_event_at)} · ${s.last_test_event_status === "accepted" ? "aceito pela Meta" : "não aceito"}` : "nunca"}</p>
          </section>}

          {s && <section className="py-7">
            <h2 className="text-lg font-semibold">Ativar ou remover</h2>
            <div className="mt-4 flex items-center gap-3">
              <Switch id="capi-enabled" checked={s.enabled} disabled={Boolean(busy)} onCheckedChange={(v) => void run("toggle", async () => { await toggle({ data: { enabled: v, revision: s.revision } }); return { kind: "ok", text: v ? "Integração ativada (somente testes)." : "Integração desativada. Nada será enviado à Meta." }; })} />
              <Label htmlFor="capi-enabled">{s.enabled ? "Integração ativa" : "Integração desativada"}</Label>
            </div>
            <div className="mt-6">
              {!confirmRemove ? <Button variant="ghost" className="text-destructive" disabled={Boolean(busy)} onClick={() => setConfirmRemove(true)}><Trash2 />Remover Pixel e token</Button>
                : <div className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 p-3 text-sm"><span>Apagar o Pixel e o token salvos? Você precisará colar o token de novo.</span>
                  <Button variant="destructive" size="sm" disabled={Boolean(busy)} onClick={() => void run("remove", async () => { await remove({ data: { revision: s.revision } }); setConfirmRemove(false); setPixel(""); return { kind: "ok", text: "Pixel e token removidos." }; })}>Remover</Button>
                  <Button variant="outline" size="sm" onClick={() => setConfirmRemove(false)}>Cancelar</Button></div>}
            </div>
          </section>}
          <QualifiedLeadEvents />
          {!data.keyReady && <p className="text-sm text-destructive">A chave de proteção do token não está disponível no servidor.</p>}
        </>}
      </div>
    </main>
  </SettingsLayout>;
}

function Status({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone: "ok" | "error" | "muted" }) {
  return <div className="rounded-lg border bg-card p-4">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className={`mt-1 font-semibold ${tone === "ok" ? "text-primary" : tone === "error" ? "text-destructive" : "text-foreground"}`}>{value}</p>
    {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
  </div>;
}

function QualifiedLeadEvents() {
  const get = useServerFn(getQualifiedLeadEventsSummary);
  const q = useQuery({ queryKey: ["meta-qualified-events"], queryFn: () => get(), retry: false });
  const counts = q.data?.authorized ? q.data.counts : {};
  const entries = Object.entries(counts);
  return <section className="border-t py-7">
    <h2 className="text-lg font-semibold">Eventos de lead qualificado</h2>
    <p className="mt-2 text-sm text-muted-foreground">Quando a Pipeflow IA marca um lead do funil principal como Qualificado, um evento é preparado uma única vez para o Pixel desta empresa. O envio real continua desligado até a validação final.</p>
    {entries.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">Nenhum evento preparado ainda.</p>
      : <ul className="mt-3 space-y-1 text-sm">{entries.map(([k, n]) => <li key={k}><span className="font-medium">{n}</span> · {metaEventLabel[k] ?? k}</li>)}</ul>}
  </section>;
}
