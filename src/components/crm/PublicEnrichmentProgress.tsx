import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { getPublicEnrichmentStatus, processPublicEnrichment, queuePublicEnrichment } from "@/lib/b2b-public-enrichment.functions";
import { PUBLIC_STATUS_LABEL, type PublicJobStatus } from "@/lib/b2b-public-enrichment";

/**
 * Consulta Pública Gratuita em segundo plano após o cadastro em massa: enfileira os cards criados (um registro por card,
 * sem repetir) e processa lotes de 2 enquanto esta página estiver aberta; consultas pendentes de visitas anteriores
 * também são retomadas. O cadastro nunca espera por isso.
 */
export function PublicEnrichmentProgress({ leadIds }: { leadIds: string[] }) {
  const queue = useServerFn(queuePublicEnrichment), process = useServerFn(processPublicEnrichment), status = useServerFn(getPublicEnrichmentStatus);
  const [counts, setCounts] = useState<Record<PublicJobStatus, number> | null>(null), [remaining, setRemaining] = useState(0), [error, setError] = useState("");
  const queued = useRef(new Set<string>()), running = useRef(false), idsRef = useRef<string[]>([]);
  idsRef.current = leadIds;

  async function refresh() {
    const s = await status({ data: { leadIds: idsRef.current.slice(-200) } });
    const c: Record<PublicJobStatus, number> = { queued: 0, running: 0, found: 0, no_data: 0, error: 0 };
    for (const j of s.jobs) c[j.status]++;
    setCounts(idsRef.current.length ? c : null); setRemaining(s.remaining);
    return s.remaining;
  }
  async function loop() {
    if (running.current) return;
    running.current = true; setError("");
    try {
      for (let i = 0; i < 80; i++) {
        const r = await process();
        await refresh();
        if (!r.remaining) break;
        // Intervalo entre lotes para respeitar os limites das fontes gratuitas.
        await new Promise(res => setTimeout(res, r.processed ? 1500 : 8000));
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Erro na consulta."); }
    finally { running.current = false; }
  }
  useEffect(() => {
    const fresh = leadIds.filter(id => !queued.current.has(id));
    if (!fresh.length) return;
    fresh.forEach(id => queued.current.add(id));
    void (async () => {
      try { for (let i = 0; i < fresh.length; i += 200) await queue({ data: { leadIds: fresh.slice(i, i + 200) } }); }
      catch (e) { setError(e instanceof Error ? e.message : "Não foi possível iniciar a consulta pública."); return; }
      void loop();
    })();
  }, [leadIds]); // eslint-disable-line react-hooks/exhaustive-deps
  // Retoma consultas que ficaram pendentes (por exemplo, a página foi fechada no meio).
  useEffect(() => { void refresh().then(r => { if (r) void loop(); }).catch(() => undefined); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!counts && !remaining && !error) return null;
  const active = remaining > 0;
  return <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
    <span className="flex items-center gap-2 font-medium">{active && <Loader2 className="size-4 animate-spin" />}Consulta Pública Gratuita</span>
    {counts ? (["running", "found", "no_data", "error"] as const).map(k => {
      const n = k === "running" ? counts.queued + counts.running : counts[k];
      return n ? <span key={k}>{PUBLIC_STATUS_LABEL[k]}: <b>{n}</b></span> : null;
    }) : <span>{remaining} card(s) aguardando consulta</span>}
    {!active && counts && <span className="text-muted-foreground">Abra um card para ver as fontes de cada dado.</span>}
    {error && <span className="text-destructive">{error}</span>}
  </div>;
}
