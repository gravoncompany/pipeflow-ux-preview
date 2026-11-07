import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Search, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { applyLeadPublicLookup, chooseLeadPublicCandidate, getLeadPublicLookup, processPublicEnrichment, runLeadPublicLookup } from "@/lib/b2b-public-enrichment.functions";
import { FIELD_STATE_LABEL, PUBLIC_STATUS_LABEL, fieldRows, type Finding, type FindingKey } from "@/lib/b2b-public-enrichment";

type LeadFields = { company?: string; email?: string; whatsapp?: string; website?: string };
type HistoryEntry = { id: string; date: string; text: string; source?: string };

/** Consulta Pública Gratuita dentro do card: CNPJ direto ou nome/cidade/site; nada é gravado sem o usuário escolher. */
export function LeadPublicLookup({ leadId, onApplied }: { leadId: string; onApplied: (fields: LeadFields, entry: HistoryEntry | null) => void }) {
  const choose = useServerFn(chooseLeadPublicCandidate), get = useServerFn(getLeadPublicLookup), run = useServerFn(runLeadPublicLookup), apply = useServerFn(applyLeadPublicLookup), tick = useServerFn(processPublicEnrichment);
  const q = useQuery({ queryKey: ["lead-public-lookup", leadId], queryFn: () => get({ data: { leadId } }), retry: false, gcTime: 0 });
  const [busy, setBusy] = useState<"" | "run" | "apply">(""), [error, setError] = useState(""), [msg, setMsg] = useState("");
  const [picked, setPicked] = useState<FindingKey[]>([]), [replace, setReplace] = useState<FindingKey[]>([]);
  const job = q.data?.job ?? null, result = job?.result ?? null;
  const pending = job?.status === "queued" || job?.status === "running";

  // Card aberto com consulta do cadastro em massa na fila: ajuda a processar e atualiza o status.
  useEffect(() => {
    if (!pending) return;
    const id = setInterval(() => { void tick().catch(() => undefined).finally(() => void q.refetch()); }, 6000);
    return () => clearInterval(id);
  }, [pending]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const f = result?.findings ?? [];
    setPicked(f.filter(x => !x.current && !(job?.applied ?? []).includes(x.key)).map(x => x.key)); setReplace([]);
  }, [result?.checkedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.isPending) return null;
  if (q.isError || !q.data?.allowed) return null;

  async function doRun() {
    setBusy("run"); setError(""); setMsg("");
    try { await run({ data: { leadId } }); await q.refetch(); }
    catch (e) { setError(e instanceof Error ? e.message : "Erro na consulta."); await q.refetch(); }
    finally { setBusy(""); }
  }
  async function doApply(findings: Finding[]) {
    setBusy("apply"); setError(""); setMsg("");
    try {
      const keys = picked.filter(k => findings.some(f => f.key === k));
      const out = await apply({ data: { leadId, keys, replace: replace.filter(k => keys.includes(k)), confirmed: true } });
      const fields: LeadFields = {};
      for (const f of findings) if (out.applied.includes(f.key) && f.key !== "cnpj") fields[f.key as keyof LeadFields] = f.key === "email" ? f.value.toLowerCase() : f.value;
      onApplied(fields, out.entry);
      setMsg(out.applied.length ? `Adicionado ao card: ${out.applied.map(k => findings.find(f => f.key === k)?.label ?? k).join(", ")}.${out.skipped.length ? " Campos já preenchidos foram mantidos." : ""}` : out.cnpjConflict ? "Este CNPJ já pertence a outro card; não foi associado para evitar duplicidade." : "Nenhum campo novo para adicionar; os dados existentes foram mantidos.");
      if (out.cnpjConflict && out.applied.length) setMsg(m => `${m} O CNPJ já pertence a outro card e não foi associado.`);
      await q.refetch();
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível adicionar."); }
    finally { setBusy(""); }
  }
  const toggle = (list: FindingKey[], set: (v: FindingKey[]) => void, k: FindingKey, on: boolean) => set(on ? [...new Set([...list, k])] : list.filter(x => x !== k));
  const c = result?.company;

  return <section className="space-y-3 border-t pt-5" aria-label="Consulta Pública Gratuita">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2"><h3 className="text-base font-semibold">Dados públicos da empresa</h3>{job && <Badge variant={job.status === "error" ? "destructive" : job.status === "found" ? "default" : "secondary"}>{PUBLIC_STATUS_LABEL[job.status]}</Badge>}</div>
      <Button type="button" size="sm" variant="outline" disabled={Boolean(busy) || pending} onClick={() => void doRun()}>{busy === "run" || pending ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}Consulta Pública Gratuita</Button>
    </div>
    <p className="text-xs text-muted-foreground">Busca o CNPJ, a razão social, o endereço, o site, o e-mail e o WhatsApp no site oficial, no cadastro público e numa busca pública na web. Não usa a DeskData.</p>
    <div className="divide-y rounded-md border text-xs" aria-label="Campos da empresa">
      {fieldRows(result, job?.status === "error").map(r => <details key={r.key} className="px-2 py-1">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2"><span className="min-w-0 truncate"><span className="text-muted-foreground">{r.label}:</span> {r.value || "—"}</span><span className={r.state === "found" ? "text-primary" : r.state === "error" ? "text-destructive" : "text-muted-foreground"}>{FIELD_STATE_LABEL[r.state]}</span></summary>
        <div className="space-y-1 py-1">{r.value ? <><p className="break-all">{r.value}</p><p className="text-muted-foreground">Fonte: {r.sourceUrl ? <a className="underline" href={r.sourceUrl} target="_blank" rel="noreferrer">{r.source}<ExternalLink className="ml-1 inline size-3" /></a> : r.source}{r.note ? ` · ${r.note}` : ""}</p><p className="text-muted-foreground">Para adicionar ao cadastro, marque abaixo em “Escolha o que adicionar ao card”.</p></> : <p className="text-muted-foreground">{r.state === "not_searched" ? "Clique em Consulta Pública Gratuita." : r.state === "error" ? "A fonte não respondeu; tente de novo." : r.note || "Nenhuma fonte pública trouxe este dado."}</p>}</div>
      </details>)}
    </div>
    {result?.candidates?.length ? <div className="space-y-1 rounded-md border p-2 text-xs"><p className="font-medium">{result.ambiguous ? "Mais de uma empresa compatível — escolha a correta:" : "CNPJs encontrados sem correspondência segura — confira:"}</p>
      {result.candidates.map(cand => <div key={cand.company.cnpj} className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0">{cand.company.legalName} · {cand.company.cnpj} · {[cand.company.city, cand.company.state].filter(Boolean).join("/")}<span className="block text-muted-foreground">{cand.company.address} · {cand.source}</span></span>
        <Button type="button" size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void (async () => { setBusy("run"); setError(""); try { await choose({ data: { leadId, cnpj: cand.company.cnpj } }); await q.refetch(); setMsg("Empresa escolhida. Marque abaixo o que adicionar ao card."); } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível escolher."); } finally { setBusy(""); } })()}>Usar este</Button></div>)}
    </div> : null}
    {busy === "run" && <p role="status" className="text-sm text-muted-foreground">Consultando dados…</p>}
    {job?.status === "error" && !busy && <p role="alert" className="text-sm text-destructive">A última consulta não foi concluída. Tente novamente em alguns minutos.</p>}
    {result && <div className="space-y-3 text-sm">
      {c && <dl className="grid grid-cols-2 gap-3 rounded-md border p-3 text-xs">
        {[["CNPJ", c.cnpj], ["Razão social", c.legalName], ["Nome fantasia", c.tradeName], ["Situação cadastral", c.registrationStatus], ["Cidade / UF", [c.city, c.state].filter(Boolean).join(" / ")], ["Endereço", c.address], ["Telefones", c.phones.join(", ")], ["E-mail do cadastro", c.emails.join(", ")]].map(([l, v]) => <div key={l} className="min-w-0"><dt className="text-muted-foreground">{l}</dt><dd className="mt-1 break-words">{v || "Não informado"}</dd></div>)}
        <p className="col-span-2 text-muted-foreground">{result.identified?.how === "site" ? "CNPJ publicado no site oficial e conferido com nome e cidade." : result.identified?.how === "historico" ? "CNPJ do histórico de consultas públicas, conferido com nome e cidade." : "Consultado pelo CNPJ do card."}</p>
      </dl>}
      {result.findings.length > 0 ? <div className="space-y-2">
        <p className="font-medium">Escolha o que adicionar ao card</p>
        {result.findings.map(f => {
          const done = (job?.applied ?? []).includes(f.key);
          return <div key={f.key} className="rounded-md border p-2">
            <label className="flex items-start gap-2"><Checkbox className="mt-0.5" disabled={done} checked={picked.includes(f.key)} onCheckedChange={v => toggle(picked, setPicked, f.key, v === true)} /><span className="min-w-0 flex-1"><span className="font-medium">{f.label}:</span> <span className="break-all">{f.value}</span>{done && <span className="text-primary"> · já adicionado</span>}<span className="block text-xs text-muted-foreground">Fonte: {f.sourceUrl ? <a className="underline" href={f.sourceUrl} target="_blank" rel="noreferrer">{f.source}<ExternalLink className="ml-1 inline size-3" /></a> : f.source}{f.note ? ` · ${f.note}` : ""}</span></span></label>
            {f.current && picked.includes(f.key) && <label className="mt-2 flex items-start gap-2 pl-6 text-xs"><Checkbox className="mt-0.5" checked={replace.includes(f.key)} onCheckedChange={v => toggle(replace, setReplace, f.key, v === true)} /><span>O card já tem <b className="break-all">{f.current}</b>. Marque para substituir; sem marcar, o valor atual é mantido.</span></label>}
          </div>;
        })}
        <Button type="button" size="sm" disabled={Boolean(busy) || !picked.length} onClick={() => void doApply(result.findings)}>{busy === "apply" ? "Adicionando…" : "Adicionar ao card"}</Button>
      </div> : <p className="text-muted-foreground">Nenhum dado novo encontrado nas fontes gratuitas.</p>}
      {result.notes.map(n => <p key={n} className="text-xs text-muted-foreground">{n}</p>)}
      {result.sources.length > 0 && <p className="text-xs text-muted-foreground">Fontes consultadas: {result.sources.map(s => `${s.name} (${s.outcome})`).join(" · ")} · {new Date(result.checkedAt).toLocaleString("pt-BR")}</p>}
    </div>}
    {msg && <p role="status" className="text-sm text-primary">{msg}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
