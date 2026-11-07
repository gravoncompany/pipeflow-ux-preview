import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AlertCircle, CheckCircle2, KeyRound, RefreshCw, Save, Search, ShieldCheck, Trash2 } from "lucide-react";
import { SettingsLayout } from "@/components/crm/SettingsLayout";
import { CrmAuthGate } from "@/components/crm/CrmAuthGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { capiFailureText } from "@/lib/meta-capi";
import { igTokenSchema, igUserIdSchema } from "@/lib/company-insights";
import { getIgResearch, removeIgResearch, saveIgResearch, testIgResearch } from "@/lib/company-insights.functions";

export const Route = createFileRoute("/configuracoes/integracoes/instagram-pesquisa")({
  head: () => ({ meta: [
    { title: "Instagram para pesquisa de empresas — PipeFlow CRM" },
    { name: "description", content: "Conexão oficial da Meta para a Pipeflow IA ler perfis comerciais públicos do Instagram na Prospecção B2B." },
    { property: "og:title", content: "Instagram para pesquisa de empresas — PipeFlow CRM" },
    { property: "og:description", content: "Conta comercial e token da Meta guardados só no servidor, com teste de leitura." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: IgResearchPage,
});

type Notice = { kind: "ok" | "error"; text: string } | null;

function IgResearchPage() {
  const fetchOverview = useServerFn(getIgResearch), save = useServerFn(saveIgResearch), test = useServerFn(testIgResearch), remove = useServerFn(removeIgResearch);
  const query = useQuery({ queryKey: ["ig-research"], queryFn: () => fetchOverview(), retry: false });
  const [igId, setIgId] = useState<string | null>(null), [token, setToken] = useState(""), [probe, setProbe] = useState("");
  const [busy, setBusy] = useState(""), [notice, setNotice] = useState<Notice>(null), [confirmRemove, setConfirmRemove] = useState(false);
  const data = query.data && !query.data.needsAuth ? query.data : undefined;
  const s = data?.settings ?? null;
  const idValue = igId ?? s?.ig_user_id ?? "";
  const idOk = igUserIdSchema.safeParse(idValue).success;
  const tokenOk = token === "" ? Boolean(s) : igTokenSchema.safeParse(token).success;

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
            <div className="flex items-center gap-3"><Search className="size-7 text-primary" /><h1 className="text-2xl font-semibold">Instagram para pesquisa de empresas</h1></div>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Permite que a Pipeflow IA leia a bio, os números e as publicações recentes de perfis comerciais públicos pela API oficial da Meta (Business Discovery). Perfis pessoais não podem ser lidos. Nada é publicado nem enviado.</p>
          </div>
          <Button variant="outline" size="icon" aria-label="Atualizar" title="Atualizar" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw className={query.isFetching ? "animate-spin" : ""} /></Button>
        </header>

        {query.isPending && <p className="py-10 text-muted-foreground">Carregando…</p>}
        {query.isError && <section className="py-10"><ShieldCheck className="mb-3 size-8 text-muted-foreground" /><h2 className="text-lg font-semibold">Acesso administrativo necessário</h2><p className="my-3 text-sm text-muted-foreground">{query.error instanceof Error ? query.error.message : "Entre com sua conta administrativa."}</p><Button asChild><Link to="/auth">Entrar com minha conta</Link></Button></section>}

        {data && <>
          {notice && <p role={notice.kind === "error" ? "alert" : "status"} className={`my-5 flex items-start gap-2 rounded-md border p-3 text-sm ${notice.kind === "error" ? "border-destructive/40 text-destructive" : "border-primary/30 text-foreground"}`}>
            {notice.kind === "error" ? <AlertCircle className="mt-0.5 size-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />}{notice.text}</p>}

          <section className="border-b py-7 text-sm">
            <h2 className="text-lg font-semibold">Como obter os dados na Meta</h2>
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-muted-foreground">
              <li>O Instagram da Gravon precisa ser conta comercial e estar ligado a uma Página do Facebook.</li>
              <li>No Gerenciador de Negócios → Usuários do sistema, gere um token para o seu app com as permissões <b>instagram_basic</b>, <b>instagram_manage_insights</b>, <b>pages_read_engagement</b> e <b>pages_show_list</b>.</li>
              <li>Copie o ID da conta do Instagram comercial (aparece em Contas → Contas do Instagram).</li>
            </ol>
          </section>

          <section className="border-b py-7">
            <h2 className="text-lg font-semibold">Conta e token</h2>
            <div className="mt-5 grid gap-5 md:grid-cols-2">
              <div>
                <Label htmlFor="ig-id">ID da conta comercial do Instagram</Label>
                <Input id="ig-id" className="mt-2" inputMode="numeric" maxLength={25} placeholder="Ex.: 17841400000000000" value={idValue} onChange={(e) => setIgId(e.target.value.replace(/\D/g, ""))} />
                {s?.ig_username && <p className="mt-2 text-xs text-muted-foreground">Conta confirmada: @{s.ig_username}</p>}
              </div>
              <div>
                <Label htmlFor="ig-token">Token de acesso</Label>
                <Input id="ig-token" className="mt-2" type="password" autoComplete="off" spellCheck={false} placeholder={s ? "Token salvo — cole um novo só para trocar" : "Cole o token gerado na Meta"} value={token} onChange={(e) => setToken(e.target.value.trim())} />
                <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><KeyRound className="size-3.5" />Fica guardado cifrado no servidor e nunca volta para a tela.</p>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button disabled={Boolean(busy) || !idOk || !tokenOk || !data.keyReady} onClick={() => void run("save", async () => {
                const r = await save({ data: { igUserId: idValue, token: token || undefined, revision: s?.revision ?? null } });
                if (!r.saved) return { kind: "error", text: `Nada foi salvo. ${capiFailureText(r.failure).replace("esse Pixel", "essa conta").replace("Pixel", "conta")}` };
                setToken(""); setIgId(null);
                return { kind: "ok", text: `Salvo. A Meta confirmou acesso à conta${r.username ? ` @${r.username}` : ""}.` };
              })}><Save />{busy === "save" ? "Verificando com a Meta…" : "Salvar e verificar"}</Button>
            </div>
            {idValue && !idOk && <p className="mt-3 text-xs text-destructive">O ID tem só números (6 a 25 dígitos).</p>}
            {token && !igTokenSchema.safeParse(token).success && <p className="mt-3 text-xs text-destructive">{igTokenSchema.safeParse(token).error?.issues[0]?.message}</p>}
          </section>

          {s && <section className="border-b py-7">
            <h2 className="text-lg font-semibold">Testar leitura de um perfil</h2>
            <p className="mt-1 text-sm text-muted-foreground">Digite o nome de um perfil comercial público (sem @). Só leitura.</p>
            <div className="mt-4 flex max-w-xl flex-wrap items-end gap-3">
              <div className="min-w-48 flex-1"><Label htmlFor="ig-probe">Perfil</Label><Input id="ig-probe" className="mt-2" maxLength={30} placeholder="gravoncompany" value={probe} onChange={(e) => setProbe(e.target.value.replace(/^@/, "").trim().toLowerCase())} /></div>
              <Button variant="outline" disabled={Boolean(busy) || !/^[a-z0-9._]{1,30}$/.test(probe)} onClick={() => void run("test", async () => {
                const r = await test({ data: { username: probe } });
                return r.ok ? { kind: "ok", text: `Leitura confirmada: @${r.username}${r.followers !== null ? ` · ${r.followers.toLocaleString("pt-BR")} seguidores` : ""} · ${r.posts} publicação(ões) recente(s) lida(s).` } : { kind: "error", text: r.message };
              })}><Search className={busy === "test" ? "animate-pulse" : ""} />Testar</Button>
            </div>
            {s.last_check_at && <p className="mt-3 text-xs text-muted-foreground">Última verificação: {new Date(s.last_check_at).toLocaleString("pt-BR")} · {s.last_check_status === "ok" ? "funcionou" : "falhou"}</p>}
          </section>}

          {s && <section className="py-7">
            {!confirmRemove ? <Button variant="outline" onClick={() => setConfirmRemove(true)}><Trash2 />Remover conexão</Button> : <div className="flex flex-wrap items-center gap-3 text-sm">
              <span>Remover a conta e o token? A análise passará a ler só os sites.</span>
              <Button variant="destructive" disabled={Boolean(busy)} onClick={() => void run("remove", async () => { await remove({ data: { revision: s.revision } }); setConfirmRemove(false); return { kind: "ok", text: "Conexão removida." }; })}>Remover</Button>
              <Button variant="ghost" onClick={() => setConfirmRemove(false)}>Cancelar</Button>
            </div>}
          </section>}
        </>}
      </div>
    </main>
  </SettingsLayout>;
}
