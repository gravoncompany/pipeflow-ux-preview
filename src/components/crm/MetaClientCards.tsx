import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowDown, ArrowUp, RefreshCw, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getClientMetaCards, saveClientMetaCards } from "@/lib/crm-client-phase1.functions";
import { META_CARD_METRICS, type MetaCardKey, type PeriodPreset } from "@/lib/client-meta-metrics";
import { currency } from "@/lib/revenue";

const PRESETS: [PeriodPreset, string][] = [["today", "Hoje"], ["yesterday", "Ontem"], ["last_7d", "Últimos 7 dias"], ["last_30d", "Últimos 30 dias"], ["this_month", "Este mês"], ["custom", "Período personalizado"]];
export const fmt = (k: MetaCardKey, v: number | null | undefined) => { if (v === null || v === undefined) return "Indisponível"; const m = META_CARD_METRICS.find(x => x.key === k)!; return m.kind === "money" ? currency(v) : m.kind === "pct" ? `${v.toFixed(2)}%` : Math.round(v).toLocaleString("pt-BR"); };

/** Top Campanhas cards fed only by the client's linked Meta accounts. */
export type MetaPeriod = { preset: PeriodPreset; since?: string; until?: string };
export function MetaClientCards({ clientId, onPeriodChange }: { clientId: string; onPeriodChange?: (p: MetaPeriod | null) => void }) {
  const get = useServerFn(getClientMetaCards), save = useServerFn(saveClientMetaCards);
  const [preset, setPreset] = useState<PeriodPreset>("last_30d"), [since, setSince] = useState(""), [until, setUntil] = useState("");
  const [open, setOpen] = useState(false), [draft, setDraft] = useState<MetaCardKey[]>([]), [err, setErr] = useState("");
  const custom = preset === "custom" && since && until;
  const q = useQuery({ queryKey: ["client-meta-cards", clientId, preset, custom ? since : "", custom ? until : ""], queryFn: () => get({ data: { clientId, preset, ...(custom ? { since, until } : {}) } }), retry: false, enabled: preset !== "custom" || Boolean(custom) });
  const d = q.data;
  useEffect(() => { onPeriodChange?.(preset !== "custom" ? { preset } : custom ? { preset, since, until } : null); }, [preset, since, until]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      <Select value={preset} onValueChange={v => setPreset(v as PeriodPreset)}><SelectTrigger className="h-8 w-auto"><SelectValue /></SelectTrigger><SelectContent>{PRESETS.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select>
      {preset === "custom" && <><Input type="date" className="h-8 w-auto" value={since} onChange={e => setSince(e.target.value)} /><Input type="date" className="h-8 w-auto" value={until} onChange={e => setUntil(e.target.value)} /></>}
      <Button size="sm" variant="outline" disabled={!d} onClick={() => { setDraft(d?.selected as MetaCardKey[] ?? []); setErr(""); setOpen(true); }}><SlidersHorizontal className="size-4" />Editar métricas</Button>
      <Button size="icon" variant="ghost" aria-label="Atualizar" disabled={q.isFetching} onClick={() => void q.refetch()}><RefreshCw className="size-4" /></Button>
      {d && <span className="text-xs text-muted-foreground">Meta Ads · {d.range.since.split("-").reverse().join("/")} a {d.range.until.split("-").reverse().join("/")} · atualizado em {new Date(d.fetchedAt).toLocaleString("pt-BR")}</span>}
    </div>
    {q.isPending && preset !== "custom" && <p className="text-sm text-muted-foreground">Consultando a Meta…</p>}
    {q.isError && <p role="alert" className="text-sm text-destructive">{q.error instanceof Error ? q.error.message : "Não foi possível ler a Meta."}</p>}
    {d && d.accounts.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma conta Meta Ads vinculada a este cliente.</p>}
    {d?.errors.map(e => <p key={e} className="text-xs text-destructive">{e}</p>)}
    {d && d.accounts.length > 0 && <dl className="grid gap-2 sm:grid-cols-4">{(d.selected as MetaCardKey[]).map(k => <div key={k} className="rounded-lg border p-3"><dt className="text-xs text-muted-foreground">{META_CARD_METRICS.find(m => m.key === k)?.label}</dt><dd className={`mt-1 text-lg font-semibold ${d.metrics?.[k] == null ? "text-muted-foreground" : ""}`}>{fmt(k, d.metrics?.[k])}</dd></div>)}</dl>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
      <DialogHeader><DialogTitle>Editar métricas</DialogTitle><DialogDescription>Escolha e ordene os indicadores deste cliente. Conversas iniciadas não são contadas como leads.</DialogDescription></DialogHeader>
      <div className="space-y-1">{[...draft, ...META_CARD_METRICS.map(m => m.key).filter(k => !draft.includes(k))].map(k => { const on = draft.includes(k), i = draft.indexOf(k); return <div key={k} className="flex items-center gap-2 rounded border px-2 py-1.5 text-sm"><Checkbox checked={on} onCheckedChange={v => setDraft(v === true ? [...draft, k] : draft.filter(x => x !== k))} /><span className="flex-1">{META_CARD_METRICS.find(m => m.key === k)?.label}</span>{on && <><Button size="icon" variant="ghost" aria-label="Subir" disabled={i === 0} onClick={() => { const n = [...draft]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; setDraft(n); }}><ArrowUp className="size-4" /></Button><Button size="icon" variant="ghost" aria-label="Descer" disabled={i === draft.length - 1} onClick={() => { const n = [...draft]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; setDraft(n); }}><ArrowDown className="size-4" /></Button></>}</div>; })}</div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <Button disabled={!draft.length} onClick={async () => { try { await save({ data: { clientId, metrics: draft } }); setOpen(false); void q.refetch(); } catch (e) { setErr(e instanceof Error ? e.message : "Falha ao salvar."); } }}>Salvar</Button>
    </DialogContent></Dialog>
  </div>;
}
