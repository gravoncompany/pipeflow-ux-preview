import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SettingsLayout } from "@/components/crm/SettingsLayout";
import { CrmAuthGate } from "@/components/crm/CrmAuthGate";
import { getGoogleAdsIntegration, getMetaAdsIntegration, queryAdsMetrics } from "@/lib/integrations-hub.functions";
import { MetaAccountsManager } from "./MetaAccountsManager";
import type { AdsMetrics } from "@/lib/ads-metrics";

const isoDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
type StatusResult = { needsAuth: boolean; error: string | null; data: null | { state?: string; missing?: string[]; checkedAt?: string; connected: boolean; error: string | null; accounts: Account[]; user?: string; permissions?: string[] } };
type Account = { id: string; name: string; currency: string; active: boolean; manager?: boolean; readable?: boolean };

/** Página própria de Meta Ads / Google Ads: status validado, contas autorizadas, teste e métricas (somente leitura). */
export function AdsPlatformPage({ platform, logo }: { platform: "meta_ads" | "google_ads"; logo: string }) {
  const isMeta = platform === "meta_ads", name = isMeta ? "Meta Ads" : "Google Ads";
  const metaFn = useServerFn(getMetaAdsIntegration), googleFn = useServerFn(getGoogleAdsIntegration), metricsFn = useServerFn(queryAdsMetrics);
  const forceRef = useRef(false);
  const q = useQuery({ queryKey: ["ads-integration", platform], queryFn: async (): Promise<StatusResult> => (isMeta ? await metaFn({ data: { force: forceRef.current } }).finally(() => { forceRef.current = false; }) : await googleFn()) as StatusResult, retry: false });
  const [since, setSince] = useState(() => isoDay(new Date(Date.now() - 29 * 86400000))), [until, setUntil] = useState(() => isoDay(new Date()));
  const [sel, setSel] = useState(""), [busy, setBusy] = useState(false), [m, setM] = useState<AdsMetrics | null>(null), [err, setErr] = useState("");
  if (q.data?.needsAuth) return <CrmAuthGate onUnlock={() => void q.refetch()} />;
  const s = q.data?.data as (null | { state?: string; missing?: string[]; checkedAt?: string; connected: boolean; error: string | null; accounts: Account[]; user?: string; permissions?: string[] });
  const accounts = (s?.accounts ?? []).filter((a) => !a.manager);
  const money = (v: number | null) => v == null ? "Não disponível" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: m?.currency || "BRL" }).format(v);
  const n = (v: number | null, d = 0) => v == null ? "Não disponível" : v.toLocaleString("pt-BR", { maximumFractionDigits: d });
  return <SettingsLayout>
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-8">
      <Link to="/configuracoes/integracoes/api" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"><ArrowLeft className="size-4" />Integrações Externas</Link>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-5">
        <div className="flex items-center gap-4"><img src={logo} alt={`Logotipo ${name}`} className="h-10 max-w-[120px] object-contain" /><div><h1 className="text-2xl font-semibold">{name}</h1><p className="text-sm text-muted-foreground">{isMeta ? "Meta Marketing API" : "Google Ads API"} · somente leitura</p></div></div>
        <Button variant="outline" disabled={q.isFetching} onClick={() => { forceRef.current = true; void q.refetch(); }}><RefreshCw className="size-4" />{q.isFetching ? "Testando…" : "Testar integração"}</Button>
      </div>

      <section className="border-b py-6">
        <h2 className="font-semibold">Conexão</h2>
        {q.isPending && <p className="mt-2 text-sm text-muted-foreground">Verificando autenticação…</p>}
        {q.data?.error && <p className="mt-2 text-sm text-destructive">{q.data.error}</p>}
        {s && <div className="mt-2 space-y-2 text-sm">
          <p className="flex items-center gap-2">{s.state === "unverified" ? <Badge variant="outline">Verificação adiada</Badge> : s.connected ? <Badge>Conectada</Badge> : <Badge variant="secondary">Não conectada</Badge>}{s.checkedAt && <span className="text-xs text-muted-foreground">verificada às {new Date(s.checkedAt).toLocaleTimeString("pt-BR")}</span>}{s.user && <span className="text-muted-foreground">Autorizada por {s.user}</span>}</p>
          {s.error && <p className="text-muted-foreground">{s.error}</p>}
          {s.permissions && s.permissions.length > 0 && <p className="text-xs text-muted-foreground">Permissões concedidas: {s.permissions.join(", ")}. O Pipeflow só faz leituras; nenhuma campanha é alterada.</p>}
          {isMeta && s.missing && s.missing.length > 0 && <p className="text-destructive">Permissões ausentes: {s.missing.join(", ")}. Reconecte a Meta e aprove esse acesso.</p>}
          {isMeta && <div className="rounded-lg border border-dashed p-3 text-muted-foreground">
            <p className="font-medium text-foreground">{s.connected ? "Reconectar Meta / incluir contas de clientes" : "Conectar Meta"}</p>
            <p className="mt-1">A autorização usa o login OAuth da Meta pelo aplicativo gerenciado do Lovable (não o app Gravon Portal). Para conectar, reconectar ou incluir portfólios de clientes, peça no chat do Lovable: “Reconectar Meta Ads”. Na janela da Meta, escolha alterar as configurações e marque os portfólios empresariais e as contas de anúncios dos clientes. O token fica só no servidor; o Pipeflow faz apenas leituras.</p>
          </div>}
          {!isMeta && !s.connected && <div className="rounded-lg border border-dashed p-3 text-muted-foreground">
            <p className="font-medium text-foreground">Como conectar</p>
            <p className="mt-1">{isMeta ? "A autorização é feita pela conta do Facebook com acesso às contas de anúncios (login OAuth da Meta). O token fica guardado só no servidor." : "A autorização é feita pela conta Google com acesso às contas do Google Ads (login OAuth do Google). O token fica guardado só no servidor."} Depois que a conta for autorizada, clique em “Testar integração”.</p>
          </div>}
        </div>}
      </section>

      {isMeta ? <MetaAccountsManager selected={sel} onMetrics={(id) => { setSel(id); setM(null); setErr(""); }} /> : <section className="border-b py-6">
        <h2 className="font-semibold">Contas de anúncios autorizadas ({accounts.length})</h2>
        <p className="text-xs text-muted-foreground">Vincule cada conta ao cliente em Clientes › ficha › Visão geral › Campanhas.</p>
        <ul className="mt-3 divide-y rounded-lg border">{accounts.map((a) => <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
          <span><b>{a.name || a.id}</b><span className="block text-xs text-muted-foreground">{a.id}{a.currency ? ` · ${a.currency}` : ""}{a.readable === false ? " · sem acesso de leitura" : ""}</span></span>
          <span className="flex items-center gap-2">{a.active ? <Badge variant="secondary">Ativa</Badge> : <Badge variant="outline">Inativa</Badge>}<Button size="sm" variant={sel === a.id ? "default" : "outline"} onClick={() => { setSel(a.id); setM(null); setErr(""); }}>Métricas</Button></span>
        </li>)}{s?.connected && !accounts.length && <li className="px-3 py-3 text-sm text-muted-foreground">Nenhuma conta liberada para esta conexão.</li>}</ul>
      </section>}

      {sel && <section className="py-6">
        <div className="flex flex-wrap items-end justify-between gap-2"><h2 className="font-semibold">Métricas · {accounts.find((a) => a.id === sel)?.name || sel.replace("act_", "")}</h2>
          <div className="flex items-end gap-2 text-xs"><label>De<Input type="date" value={since} onChange={(e) => setSince(e.target.value)} className="h-8" /></label><label>Até<Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="h-8" /></label>
          <Button size="sm" disabled={busy} onClick={() => void (async () => { setBusy(true); setErr(""); try { const r = await metricsFn({ data: { platform, accountId: sel, since, until } }); if (r.error) setErr(r.error); else if (r.data?.error) setErr(r.data.error); setM(r.data?.metrics ?? null); } finally { setBusy(false); } })()}>{busy ? "Consultando…" : "Consultar"}</Button></div></div>
        {err && <p className="mt-2 text-sm text-destructive">{err}</p>}
        {m && <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">{[
          ["Investimento", money(m.spend)], ["Impressões", n(m.impressions)], ["Alcance", n(m.reach)], ["Cliques", n(m.clicks)], ["CPC", money(m.cpc)],
          ["CTR", m.ctr == null ? "Não disponível" : `${n(m.ctr, 2)}%`], [m.resultLabel, n(m.results, 1)], ["Custo por resultado", money(m.costPerResult)], ["Campanhas ativas", n(m.activeCampaigns)],
        ].map(([l, v]) => <div key={l} className="rounded-lg border p-3"><dt className="text-xs text-muted-foreground">{l}</dt><dd className="mt-1 font-semibold">{v}</dd></div>)}</dl>}
      </section>}
    </div>
  </SettingsLayout>;
}
