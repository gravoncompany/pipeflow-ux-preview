import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Sparkles, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getCompanyInsight, runCompanyInsight } from "@/lib/company-insights.functions";
import { insightErrorText } from "@/lib/company-insights";

/** Análise do site e do Instagram público dentro do card. Só lê fontes públicas; nunca altera o card nem envia nada. */
export function LeadCompanyInsight({ leadId }: { leadId: string }) {
  const get = useServerFn(getCompanyInsight), run = useServerFn(runCompanyInsight);
  const q = useQuery({ queryKey: ["lead-company-insight", leadId], queryFn: () => get({ data: { leadId } }), retry: false, gcTime: 0 });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  if (q.isPending || q.isError || !q.data?.allowed) return null;
  const v = q.data.view, i = v?.insight ?? null;

  async function doRun() {
    setBusy(true); setError("");
    try {
      const out = await run({ data: { leadId } });
      if (out.status === "error") setError(insightErrorText(out.error));
      await q.refetch();
    } catch (e) { setError(e instanceof Error ? e.message : "A análise não foi concluída."); }
    finally { setBusy(false); }
  }

  return <section className="space-y-3 border-t pt-5" aria-label="Análise do site e Instagram">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2"><h3 className="text-base font-semibold">Análise do site e Instagram</h3>{i && <Badge>Pipeflow IA</Badge>}</div>
      <Button type="button" size="sm" variant="outline" disabled={busy || v?.status === "running"} onClick={() => void doRun()}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}{i ? "Analisar de novo" : "Analisar site e Instagram"}
      </Button>
    </div>
    <p className="text-xs text-muted-foreground">A Pipeflow IA lê o site oficial (respeitando as regras do site) e o Instagram comercial pela API oficial da Meta. O resumo personaliza o primeiro e-mail e os follow-ups dos fluxos aprovados. Nada é enviado nem alterado no card.</p>
    {busy && <p role="status" className="text-sm text-muted-foreground">Lendo o site e o Instagram e preparando o resumo…</p>}
    {i && <div className="space-y-3 rounded-md border p-3 text-sm">
      <p>{i.summary}</p>
      {i.services.length > 0 && <div><p className="text-xs font-medium text-muted-foreground">Serviços identificados</p><ul className="mt-1 flex flex-wrap gap-1.5">{i.services.map((s) => <li key={`${s.name}-${s.source}`}><Badge variant="secondary">{s.name} · {s.source === "site" ? "site" : "Instagram"}</Badge></li>)}</ul></div>}
      {i.positioning && <div><p className="text-xs font-medium text-muted-foreground">Posicionamento</p><p className="mt-1">{i.positioning}</p></div>}
      {i.recentPosts && <div><p className="text-xs font-medium text-muted-foreground">Publicações recentes</p><p className="mt-1">{i.recentPosts}</p></div>}
      {i.opportunities.length > 0 && <div><p className="text-xs font-medium text-muted-foreground">Oportunidades de marketing</p><ul className="mt-1 list-disc space-y-1 pl-5">{i.opportunities.map((o) => <li key={o}>{o}</li>)}</ul></div>}
      {i.emailAngle && <div><p className="text-xs font-medium text-muted-foreground">Gancho para o e-mail</p><p className="mt-1">{i.emailAngle}</p></div>}
    </div>}
    {v && v.sources.length > 0 && <ul className="space-y-1 text-xs text-muted-foreground">
      {v.sources.map((s) => <li key={s.name}>{s.name}: {s.url ? <a className="underline" href={s.url} target="_blank" rel="noreferrer">{s.url.replace(/^https:\/\//, "")}<ExternalLink className="ml-1 inline size-3" /></a> : null} {s.outcome}</li>)}
      {v.analyzedAt && <li>Analisado em {new Date(v.analyzedAt).toLocaleString("pt-BR")}</li>}
    </ul>}
    {!busy && !error && v?.status === "error" && <p role="alert" className="text-sm text-destructive">{insightErrorText(v.error)}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
