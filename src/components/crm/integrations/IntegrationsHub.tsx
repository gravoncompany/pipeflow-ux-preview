import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Blocks, ChevronRight } from "lucide-react";
import { getIntegrationsHub } from "@/lib/integrations-hub.functions";
import metaLogo from "@/assets/meta-logo.png.asset.json";
import googleAdsLogo from "@/assets/google-ads-logo.svg.asset.json";
import hypercashLogo from "@/assets/hypercash-logo.png.asset.json";

type Tone = "ok" | "warn" | "off" | "loading";
function Dot({ tone }: { tone: Tone }) {
  const c = tone === "ok" ? "bg-success" : tone === "warn" ? "bg-destructive" : tone === "loading" ? "bg-muted-foreground/40 animate-pulse" : "bg-muted-foreground/50";
  return <span className={`inline-block size-2 rounded-full ${c}`} aria-hidden />;
}

/** Central de Integrações Externas: uma caixa por serviço, cada uma abre sua própria página. */
export function IntegrationsHub() {
  const fn = useServerFn(getIntegrationsHub);
  const q = useQuery({ queryKey: ["integrations-hub"], queryFn: () => fn(), retry: false, staleTime: 60_000 });
  const d = q.data?.data;
  const hc = d?.hypercash;
  const cards: { to: string; name: string; logo?: string; tone: Tone; status: string }[] = [
    { to: "/configuracoes/integracoes/hypercash", name: "HyperCash", logo: hypercashLogo.url, tone: !d ? "loading" : hc === "conectado" ? "ok" : hc === "erro" ? "warn" : "off",
      status: !d ? "Verificando…" : ({ conectado: "Conectada", erro: "Com erro", configurado: "Configurada, não ativa", nao_configurado: "Não configurada" } as Record<string, string>)[hc!] },
    { to: "/configuracoes/integracoes/meta-ads", name: "Meta Ads", logo: metaLogo.url, tone: !d ? "loading" : d.meta.connected ? "ok" : "off",
      status: !d ? "Verificando…" : d.meta.state === "unverified" ? (d.meta.connected ? `Conectada · ${d.meta.accounts} conta(s) · verificação adiada` : "Verificação adiada (limite da Meta)") : d.meta.connected ? `Conectada · ${d.meta.accounts} conta(s)` : "Não conectada" },
    { to: "/configuracoes/integracoes/google-ads", name: "Google Ads", logo: googleAdsLogo.url, tone: !d ? "loading" : d.google.connected ? "ok" : "off",
      status: !d ? "Verificando…" : d.google.connected ? `Conectada · ${d.google.accounts} conta(s)` : "Não conectada" },
    { to: "/configuracoes/integracoes/outras", name: "Outras Integrações", tone: !d ? "loading" : d.custom.active ? "ok" : "off",
      status: !d ? "Verificando…" : d.custom.total ? `${d.custom.total} cadastrada(s) · ${d.custom.active} ativa(s)` : "Nenhuma cadastrada" },
  ];
  return <div className="mt-5 space-y-2">
    {q.data?.error && <p className="text-sm text-destructive">{q.data.error}</p>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((c) => <Link key={c.to} to={c.to as never} className="group flex flex-col gap-4 rounded-xl border bg-card p-5 transition-colors hover:border-primary">
        <div className="flex h-12 items-center justify-between">
          {c.logo ? <img src={c.logo} alt={`Logotipo ${c.name}`} className="h-10 max-w-[120px] object-contain" /> : <Blocks className="size-10 text-primary" />}
          <ChevronRight className="size-5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
        </div>
        <div><p className="font-semibold">{c.name}</p><p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground"><Dot tone={c.tone} />{c.status}</p></div>
      </Link>)}
    </div>
  </div>;
}
