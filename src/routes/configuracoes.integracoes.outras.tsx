import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, Blocks, Plus, Trash2 } from "lucide-react";
import { SettingsLayout } from "@/components/crm/SettingsLayout";
import { CrmAuthGate } from "@/components/crm/CrmAuthGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { deleteCustomIntegration, listCustomIntegrations, saveCustomIntegration, setCustomIntegrationActive, testCustomIntegration } from "@/lib/integrations-hub.functions";
import { AUTH_METHODS } from "@/lib/custom-integrations";

export const Route = createFileRoute("/configuracoes/integracoes/outras")({
  head: () => ({ meta: [
    { title: "Outras Integrações — PipeFlow CRM" }, { name: "description", content: "Cadastre integrações externas com URL, autenticação, credenciais protegidas e endpoints." },
    { property: "og:title", content: "Outras Integrações — PipeFlow CRM" }, { property: "og:description", content: "Cadastro, teste, ativação e desativação de integrações externas." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: OtherIntegrationsPage,
});

type Endpoint = { name: string; method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; path: string };
type Form = { id: string | null; revision: number; name: string; baseUrl: string; authMethod: keyof typeof AUTH_METHODS; authHeader: string; credential: string; endpoints: Endpoint[]; credentialSaved: boolean };
const blank: Form = { id: null, revision: 0, name: "", baseUrl: "https://", authMethod: "bearer", authHeader: "", credential: "", endpoints: [{ name: "Teste", method: "GET", path: "/" }], credentialSaved: false };
const sel = "h-10 w-full rounded-md border bg-background px-3 text-sm";

function OtherIntegrationsPage() {
  const listFn = useServerFn(listCustomIntegrations), saveFn = useServerFn(saveCustomIntegration), testFn = useServerFn(testCustomIntegration), activeFn = useServerFn(setCustomIntegrationActive), delFn = useServerFn(deleteCustomIntegration);
  const q = useQuery({ queryKey: ["custom-integrations"], queryFn: () => listFn(), retry: false });
  const [form, setForm] = useState<Form | null>(null), [busy, setBusy] = useState(""), [msg, setMsg] = useState("");
  if (q.data?.needsAuth) return <CrmAuthGate onUnlock={() => void q.refetch()} />;
  const run = async (k: string, fn: () => Promise<unknown>, ok?: string) => { setBusy(k); setMsg(""); try { await fn(); if (ok) setMsg(ok); await q.refetch(); } catch (e) { setMsg(e instanceof Error ? e.message : "Falha."); } finally { setBusy(""); } };
  const items = q.data?.data ?? [];
  return <SettingsLayout><div className="mx-auto max-w-5xl px-4 py-8 md:px-8">
    <Link to="/configuracoes/integracoes/api" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"><ArrowLeft className="size-4" />Integrações Externas</Link>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-5">
      <h1 className="flex items-center gap-3 text-2xl font-semibold"><Blocks className="size-7 text-primary" />Outras Integrações</h1>
      <Button onClick={() => setForm(blank)}><Plus className="size-4" />Nova integração</Button>
    </div>
    {q.data?.error && <p className="mt-4 text-sm text-destructive">{q.data.error}</p>}
    {msg && <p className="mt-4 text-sm text-muted-foreground">{msg}</p>}
    <div className="mt-5 grid gap-3 sm:grid-cols-2">
      {items.map((it) => <div key={it.id} className="rounded-xl border bg-card p-4">
        <div className="flex items-start justify-between gap-2"><div><p className="font-semibold">{it.name}</p><p className="break-all text-xs text-muted-foreground">{it.base_url}</p></div>
          <Badge variant={it.status === "ativa" ? "default" : "secondary"}>{it.status === "ativa" ? "Ativa" : "Desativada"}</Badge></div>
        <p className="mt-2 text-xs text-muted-foreground">{AUTH_METHODS[it.auth_method as keyof typeof AUTH_METHODS]} · {(it.endpoints as Endpoint[]).length} endpoint(s) · credencial {it.credentialSaved ? "guardada" : "não cadastrada"}</p>
        <p className="text-xs text-muted-foreground">Último teste: {it.last_check_at ? `${new Date(it.last_check_at).toLocaleString("pt-BR")} · ${it.last_check_status === "ok" ? "sucesso" : it.last_check_status}` : "nunca"}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setForm({ id: it.id, revision: it.revision, name: it.name, baseUrl: it.base_url ?? "", authMethod: it.auth_method as Form["authMethod"], authHeader: it.auth_header ?? "", credential: "", endpoints: it.endpoints as Endpoint[], credentialSaved: it.credentialSaved })}>Editar</Button>
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void run(`t${it.id}`, async () => { const r = await testFn({ data: { id: it.id } }); setTimeout(() => setMsg(r.ok ? `${it.name}: teste concluído com sucesso.` : `${it.name}: o teste falhou (${r.status}).`)); })}>{busy === `t${it.id}` ? "Testando…" : "Testar"}</Button>
          <label className="flex items-center gap-2 text-xs"><Switch checked={it.status === "ativa"} disabled={!!busy} onCheckedChange={(v) => void run(`a${it.id}`, () => activeFn({ data: { id: it.id, active: v } }))} />Ativa</label>
          <Button size="icon" variant="ghost" aria-label="Remover" disabled={!!busy} onClick={() => { if (window.confirm(`Remover a integração ${it.name}?`)) void run(`d${it.id}`, () => delFn({ data: { id: it.id, confirmed: true } }), "Integração removida."); }}><Trash2 className="size-4" /></Button>
        </div>
      </div>)}
      {q.data?.data && !items.length && <p className="text-sm text-muted-foreground">Nenhuma integração cadastrada ainda.</p>}
    </div>

    <Dialog open={!!form} onOpenChange={(o) => { if (!o) setForm(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader><DialogTitle>{form?.id ? "Editar integração" : "Nova integração"}</DialogTitle></DialogHeader>
      {form && <div className="space-y-3 text-sm">
        <div className="space-y-1"><Label>Nome</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="space-y-1"><Label>URL da API</Label><Input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://api.exemplo.com/v1" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label>Autenticação</Label><select className={sel} value={form.authMethod} onChange={(e) => setForm({ ...form, authMethod: e.target.value as Form["authMethod"] })}>{Object.entries(AUTH_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          {form.authMethod === "api_key_header" && <div className="space-y-1"><Label>Nome do cabeçalho</Label><Input value={form.authHeader} onChange={(e) => setForm({ ...form, authHeader: e.target.value })} placeholder="X-API-Key" /></div>}
        </div>
        {form.authMethod !== "none" && <div className="space-y-1"><Label>{form.authMethod === "basic" ? "usuário:senha" : "Credencial"}</Label><Input type="password" autoComplete="off" value={form.credential} onChange={(e) => setForm({ ...form, credential: e.target.value })} placeholder={form.credentialSaved ? "Guardada — deixe vazio para manter" : ""} /><p className="text-xs text-muted-foreground">Fica criptografada no servidor e nunca volta para a tela.</p></div>}
        <div className="space-y-2"><Label>Endpoints</Label>
          {form.endpoints.map((ep, i) => <div key={i} className="flex gap-2">
            <Input className="w-28" value={ep.name} onChange={(e) => setForm({ ...form, endpoints: form.endpoints.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })} placeholder="Nome" />
            <select className="h-10 rounded-md border bg-background px-2" value={ep.method} onChange={(e) => setForm({ ...form, endpoints: form.endpoints.map((x, j) => j === i ? { ...x, method: e.target.value as Endpoint["method"] } : x) })}>{["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => <option key={m}>{m}</option>)}</select>
            <Input value={ep.path} onChange={(e) => setForm({ ...form, endpoints: form.endpoints.map((x, j) => j === i ? { ...x, path: e.target.value } : x) })} placeholder="/recurso" />
            <Button size="icon" variant="ghost" aria-label="Remover endpoint" onClick={() => setForm({ ...form, endpoints: form.endpoints.filter((_, j) => j !== i) })}><Trash2 className="size-4" /></Button>
          </div>)}
          <Button size="sm" variant="outline" onClick={() => setForm({ ...form, endpoints: [...form.endpoints, { name: "", method: "GET", path: "/" }] })}><Plus className="size-4" />Endpoint</Button>
          <p className="text-xs text-muted-foreground">O teste chama o primeiro endpoint GET e guarda só o resultado (sucesso ou código de erro).</p>
        </div>
      </div>}
      <DialogFooter><Button variant="outline" onClick={() => setForm(null)}>Cancelar</Button>
        <Button disabled={!!busy || !form} onClick={() => form && void run("save", async () => { await saveFn({ data: { id: form.id, revision: form.revision, name: form.name, baseUrl: form.baseUrl, authMethod: form.authMethod, authHeader: form.authHeader, credential: form.credential || undefined, endpoints: form.endpoints } }); setForm(null); }, "Integração salva. Teste antes de ativar.")}>Salvar</Button></DialogFooter>
    </DialogContent></Dialog>
  </div></SettingsLayout>;
}
