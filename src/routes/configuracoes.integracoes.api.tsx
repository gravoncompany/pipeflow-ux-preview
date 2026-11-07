import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Check, Copy, KeyRound, Pencil, Plug, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { SettingsLayout } from "@/components/crm/SettingsLayout";
import { CrmAuthGate } from "@/components/crm/CrmAuthGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { createApiKeyFn, getApiIntegrations, renameApiKeyFn, revokeApiKeyFn } from "@/lib/api-keys.functions";
import { DIAGNOSIS_ENDPOINT_PATH, DIAGNOSIS_OUTCOME_LABEL, PUBLIC_BASE_URL } from "@/lib/api-keys";
import { IntegrationsHub } from "@/components/crm/integrations/IntegrationsHub";

export const Route = createFileRoute("/configuracoes/integracoes/api")({
  head: () => ({ meta: [
    { title: "API e Integrações · Configurações — Gravon CRM" },
    { name: "description", content: "Chaves de API privadas e endpoint autenticado para receber formulários externos no Pipeflow." },
    { property: "og:title", content: "API e Integrações · Configurações — Gravon CRM" },
    { property: "og:description", content: "Gerencie chaves de API e o recebimento de diagnósticos pelo Zapier." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: ApiIntegrationsPage,
});

const ENDPOINT = PUBLIC_BASE_URL + DIAGNOSIS_ENDPOINT_PATH;
const when = (v: string | null) => v ? new Date(v).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "—";
const EXAMPLE = `{
  "nome": "Maria Souza",
  "empresa": "Clínica Exemplo",
  "email": "maria@clinicaexemplo.com.br",
  "whatsapp": "+55 62 99999-0000",
  "objetivo_comercial": "Atrair mais pacientes para implantes",
  "event_id": "id-unico-do-envio",
  "utm_content": "pf-…",
  "whatsapp_consent": {
    "granted": true,
    "at": "2026-11-05T03:00:00Z",
    "version": "diagnostico-whatsapp-v1"
  }
}`;

function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return <Button type="button" variant="outline" size="sm" onClick={() => { void navigator.clipboard.writeText(value).then(() => { setDone(true); window.setTimeout(() => setDone(false), 1500); }); }}>
    {done ? <Check className="size-4" /> : <Copy className="size-4" />}{done ? "Copiado" : label}
  </Button>;
}

function ApiIntegrationsPage() {
  const fetch = useServerFn(getApiIntegrations);
  const create = useServerFn(createApiKeyFn);
  const rename = useServerFn(renameApiKeyFn);
  const revoke = useServerFn(revokeApiKeyFn);
  const query = useQuery({ queryKey: ["api-integrations"], queryFn: () => fetch(), retry: false });
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("Zapier");
  const [created, setCreated] = useState<{ name: string; key: string } | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [revoking, setRevoking] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function run(action: () => Promise<unknown>, ok: string) {
    if (busy) return;
    setBusy(true); setNotice("");
    try { await action(); if (ok) setNotice(ok); await query.refetch(); }
    catch (e) { setNotice(e instanceof Error ? e.message : "Não foi possível concluir."); }
    finally { setBusy(false); }
  }

  const err = query.error instanceof Error ? query.error.message : "";
  if (err.startsWith("Entre") || err.includes("acesso completo")) return <CrmAuthGate onUnlock={() => void query.refetch()} />;
  const data = query.data;
  const active = data?.keys.filter((k) => !k.revoked_at) ?? [];
  const revoked = data?.keys.filter((k) => k.revoked_at) ?? [];

  return <SettingsLayout><main className="min-w-0 flex-1 px-5 py-7 md:px-10"><div className="mx-auto max-w-5xl">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-6">
      <div><h1 className="flex items-center gap-3 text-2xl font-semibold"><Plug className="size-7 text-primary" />API e Integrações</h1>
        <p className="mt-1 text-sm text-muted-foreground">Chaves privadas para sistemas externos enviarem dados ao Pipeflow.</p></div>
      <Button variant="outline" size="icon" title="Atualizar" aria-label="Atualizar" onClick={() => void query.refetch()} disabled={query.isFetching}><RefreshCw className={query.isFetching ? "animate-spin" : ""} /></Button>
    </header>
    {query.isPending && <p className="py-10 text-muted-foreground">Carregando…</p>}
    {query.isError && <section className="py-10"><ShieldCheck className="mb-4 size-8 text-muted-foreground" /><h2 className="text-lg font-semibold">Não foi possível abrir</h2><p className="mt-2 text-muted-foreground">{err || "Tente novamente."}</p></section>}
    {notice && <p role="status" className="mt-5 rounded-md border bg-muted/40 p-3 text-sm">{notice}</p>}

    {data && <>
      <section className="border-b py-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="flex items-center gap-2 text-lg font-semibold"><KeyRound className="size-5 text-primary" />Chaves de API</h2>
            <p className="mt-1 text-sm text-muted-foreground">A chave completa aparece só uma vez, na criação. O Pipeflow guarda apenas uma impressão irreversível dela.</p></div>
          <Button onClick={() => { setName("Zapier"); setCreating(true); }} disabled={busy}><Plus className="size-4" />Nova chave</Button>
        </div>
        <div className="mt-5 overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2.5">Nome</th><th className="px-4 py-2.5">Chave</th><th className="px-4 py-2.5">Criada</th><th className="px-4 py-2.5">Último uso</th><th className="px-4 py-2.5">Usos</th><th className="px-4 py-2.5 text-right">Ações</th></tr></thead>
            <tbody>
              {active.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">Nenhuma chave ativa. Crie uma para conectar o Zapier.</td></tr>}
              {active.map((k) => <tr key={k.id} className="border-t">
                <td className="px-4 py-3 font-medium">{k.name}</td>
                <td className="px-4 py-3 font-mono text-xs">{k.prefix}…</td>
                <td className="px-4 py-3">{when(k.created_at)}</td>
                <td className="px-4 py-3">{when(k.last_used_at)}</td>
                <td className="px-4 py-3">{k.use_count}</td>
                <td className="px-4 py-3"><div className="flex justify-end gap-1">
                  <Button variant="ghost" size="icon" title="Renomear" aria-label={`Renomear ${k.name}`} onClick={() => setEditing({ id: k.id, name: k.name })}><Pencil className="size-4" /></Button>
                  <Button variant="ghost" size="icon" title="Revogar" aria-label={`Revogar ${k.name}`} onClick={() => setRevoking({ id: k.id, name: k.name })}><Trash2 className="size-4 text-destructive" /></Button>
                </div></td>
              </tr>)}
              {revoked.map((k) => <tr key={k.id} className="border-t text-muted-foreground">
                <td className="px-4 py-3">{k.name} <Badge variant="outline" className="ml-1">Revogada</Badge></td>
                <td className="px-4 py-3 font-mono text-xs line-through">{k.prefix}…</td>
                <td className="px-4 py-3">{when(k.created_at)}</td>
                <td className="px-4 py-3">{when(k.last_used_at)}</td>
                <td className="px-4 py-3">{k.use_count}</td>
                <td className="px-4 py-3 text-right text-xs">em {when(k.revoked_at)}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </section>

      <section className="border-b py-7">
        <h2 className="flex items-center gap-2 text-lg font-semibold"><Plug className="size-5 text-primary" />Integrações Externas</h2>
        <p className="mt-1 text-sm text-muted-foreground">Cada serviço tem sua própria página de configuração. Credenciais ficam só no servidor e o status só aparece como conectado depois de um teste real.</p>
        <IntegrationsHub />
      </section>

      <section className="border-b py-7">
        <h2 className="text-lg font-semibold">Endpoint · Formulário de diagnóstico</h2>
        <p className="mt-1 text-sm text-muted-foreground">Recebe o diagnóstico estratégico, localiza o contato no funil Outbound, registra no card e pausa a sequência automática de e-mails.</p>
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-3">
          <Badge>POST</Badge><code className="min-w-0 flex-1 break-all text-sm">{ENDPOINT}</code><CopyButton value={ENDPOINT} label="Copiar endereço" />
        </div>
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="font-medium">Autenticação</h3>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
              <li>Envie a chave no cabeçalho <code className="text-foreground">Authorization: Bearer pfk_…</code></li>
              <li>Alternativa: cabeçalho <code className="text-foreground">X-API-Key: pfk_…</code></li>
              <li>Nunca coloque a chave no endereço (URL) nem no corpo.</li>
              <li>Corpo em JSON ou formulário (<code className="text-foreground">x-www-form-urlencoded</code>).</li>
              <li>No Zapier: ação <b className="text-foreground">Webhooks by Zapier → POST</b>, adicione o cabeçalho acima em <i>Headers</i>.</li>
            </ul>
            <h3 className="mt-5 font-medium">Campos</h3>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              <li><code className="text-foreground">event_id</code> — obrigatório, único por envio (evita duplicidade)</li>
              <li><code className="text-foreground">nome</code>, <code className="text-foreground">empresa</code>, <code className="text-foreground">email</code>, <code className="text-foreground">whatsapp</code></li>
              <li><code className="text-foreground">objetivo_comercial</code> — registrado no histórico do card</li>
              <li><code className="text-foreground">utm_content</code> — identificador do link da automação, se houver</li>
              <li><code className="text-foreground">whatsapp_consent</code> — autorização explícita da pessoa: <code>granted</code>, data <code>at</code> e versão do texto <code>version</code>. Não marque automaticamente; sem autorização nenhum WhatsApp é enviado.</li>
            </ul>
          </div>
          <div>
            <div className="flex items-center justify-between"><h3 className="font-medium">Exemplo de corpo</h3><CopyButton value={EXAMPLE} label="Copiar" /></div>
            <pre className="mt-2 overflow-x-auto rounded-lg border bg-muted/30 p-3 text-xs">{EXAMPLE}</pre>
            <h3 className="mt-5 font-medium">Respostas</h3>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              <li><b className="text-foreground">200</b> — recebido; <code>outcome</code>: <code>matched</code>, <code>ambiguous</code>, <code>not_found</code> ou <code>no_outbound</code></li>
              <li><b className="text-foreground">200</b> com <code>duplicate: true</code> — event_id já recebido, nada repetido</li>
              <li><b className="text-foreground">400</b> — campos inválidos · <b className="text-foreground">401</b> — chave ausente, inválida ou revogada</li>
            </ul>
          </div>
        </div>
        <div className="mt-6 rounded-lg border p-4 text-sm">
          <h3 className="font-medium">Como o contato é identificado</h3>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
            <li>Pelo <code>utm_content</code> do link enviado pela automação (mais seguro).</li>
            <li>Sem ele, pelo e-mail exato ou pelo WhatsApp, somente entre os cards do funil Outbound.</li>
            <li>Se mais de um card corresponder, nada é pausado nem alterado — o envio fica registrado como ambíguo abaixo.</li>
            <li>A etapa do card não muda; a sequência pausada pode ser retomada manualmente no card.</li>
            <li>Campos já preenchidos são preservados; o diagnóstico adiciona a etiqueta “Diagnóstico solicitado”. O atendimento WhatsApp é ativado separadamente em Automações e vale somente para novos formulários autorizados.</li>
          </ol>
        </div>
      </section>

      <section className="py-7">
        <h2 className="text-lg font-semibold">Recebimentos recentes</h2>
        {data.submissions.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">Nenhum formulário recebido ainda.</p> :
          <div className="mt-4 overflow-x-auto rounded-lg border"><table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-2.5">Recebido</th><th className="px-4 py-2.5">Contato</th><th className="px-4 py-2.5">Resultado</th><th className="px-4 py-2.5">Sequências pausadas</th></tr></thead>
            <tbody>{data.submissions.map((s) => <tr key={s.id} className="border-t">
              <td className="px-4 py-3">{when(s.received_at)}</td>
              <td className="px-4 py-3">{s.name || "—"}{s.company ? <span className="text-muted-foreground"> · {s.company}</span> : null}</td>
              <td className="px-4 py-3"><Badge variant={s.outcome === "matched" ? "default" : "outline"}>{DIAGNOSIS_OUTCOME_LABEL[s.outcome] ?? s.outcome}</Badge></td>
              <td className="px-4 py-3">{s.paused_count}</td>
            </tr>)}</tbody>
          </table></div>}
      </section>
    </>}

    <Dialog open={creating} onOpenChange={(o) => { if (!busy) setCreating(o); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Nova chave de API</DialogTitle><DialogDescription>Use um nome que identifique onde ela será usada.</DialogDescription></DialogHeader>
        <div className="space-y-2"><Label htmlFor="key-name">Nome</Label><Input id="key-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></div>
        <DialogFooter><Button variant="outline" onClick={() => setCreating(false)} disabled={busy}>Cancelar</Button>
          <Button disabled={busy || name.trim().length < 2} onClick={() => void run(async () => { const r = await create({ data: { name } }); setCreating(false); setCreated({ name: r.name, key: r.key }); }, "")}>Criar chave</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={Boolean(created)} onOpenChange={(o) => { if (!o) setCreated(null); }}>
      <DialogContent onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader><DialogTitle>Chave “{created?.name}” criada</DialogTitle>
          <DialogDescription>Copie agora. Por segurança, ela não será exibida novamente — se perder, revogue e crie outra.</DialogDescription></DialogHeader>
        <code className="block break-all rounded-lg border bg-muted/30 p-3 text-sm">{created?.key}</code>
        <DialogFooter>{created && <CopyButton value={created.key} label="Copiar chave" />}<Button onClick={() => setCreated(null)}>Já copiei</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={Boolean(editing)} onOpenChange={(o) => { if (!o && !busy) setEditing(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Renomear chave</DialogTitle><DialogDescription>O valor da chave não muda.</DialogDescription></DialogHeader>
        <Input aria-label="Nome da chave" value={editing?.name ?? ""} maxLength={80} onChange={(e) => setEditing((c) => c && { ...c, name: e.target.value })} />
        <DialogFooter><Button variant="outline" onClick={() => setEditing(null)} disabled={busy}>Cancelar</Button>
          <Button disabled={busy || (editing?.name.trim().length ?? 0) < 2} onClick={() => editing && void run(async () => { await rename({ data: editing }); setEditing(null); }, "Nome atualizado.")}>Salvar</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog open={Boolean(revoking)} onOpenChange={(o) => { if (!o && !busy) setRevoking(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Revogar “{revoking?.name}”?</AlertDialogTitle>
          <AlertDialogDescription>Integrações que usam esta chave param de funcionar na hora. Não é possível desfazer.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
          <AlertDialogAction disabled={busy} onClick={() => revoking && void run(async () => { await revoke({ data: { id: revoking.id } }); setRevoking(null); }, "Chave revogada.")}>Revogar</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div></main></SettingsLayout>;
}
