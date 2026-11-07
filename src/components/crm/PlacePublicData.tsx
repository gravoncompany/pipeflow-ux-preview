import { ExternalLink, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FIELD_STATE_LABEL, fieldRows, type FieldRow, type PublicEnrichResult } from "@/lib/b2b-public-enrichment";
import type { CompanyData } from "@/lib/b2b-prospecting";

export type PlaceLookup = { result: PublicEnrichResult | null; error: string };

/** E-mail conhecido da empresa (cadastro preparado ou consulta pública) com a fonte. */
export function placeEmail(company: CompanyData | undefined, lookup: PlaceLookup | undefined): { email: string; source: string } | null {
  const rows = lookup?.result ? fieldRows(lookup.result) : [];
  const site = rows.find(r => r.key === "siteEmail" && r.value);
  if (site) return { email: site.value, source: site.source };
  if (company?.emails[0]) return { email: company.emails[0], source: "Cadastro preparado" };
  const fiscal = rows.find(r => r.key === "fiscalEmail" && r.value);
  return fiscal ? { email: fiscal.value, source: "Cadastro fiscal (pode ser do contador)" } : null;
}

const stateClass = (s: FieldRow["state"]) => s === "found" ? "text-primary" : s === "error" ? "text-destructive" : "text-muted-foreground";

/** Linha de dados públicos de uma empresa do Maps: todos os campos (inclusive pendentes), abrindo para baixo com valor, fonte e "Adicionar ao cadastro". */
export function PlacePublicData({ lookup, busy, running, onLookup, onAdd, onChoose, added }: {
  lookup: PlaceLookup | undefined; busy: boolean; running: boolean;
  onLookup: () => void; onAdd: (row: FieldRow) => void; onChoose: (company: CompanyData) => void; added: (row: FieldRow) => boolean;
}) {
  const rows = fieldRows(lookup?.result ?? null, Boolean(lookup?.error));
  const cands = lookup?.result?.candidates ?? [];
  return <div className="mt-3 space-y-1 rounded-md border p-2 text-xs">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="font-medium">Dados públicos</span>
      <Button type="button" size="sm" variant="outline" className="h-7" disabled={busy || running} onClick={onLookup}>
        {running ? <Loader2 className="size-3 animate-spin" /> : <Search className="size-3" />}{lookup ? "Buscar de novo" : "Buscar dados públicos"}
      </Button>
    </div>
    {lookup?.error && <p className="text-destructive">Falha na consulta: {lookup.error}</p>}
    {rows.map(r => <details key={r.key} className="group border-t pt-1">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
        <span className="min-w-0 truncate"><span className="text-muted-foreground">{r.label}:</span> {r.value || "—"}</span>
        <span className={`shrink-0 ${stateClass(r.state)}`}>{FIELD_STATE_LABEL[r.state]}</span>
      </summary>
      <div className="space-y-1 py-1 pl-2">
        {r.value ? <>
          <p className="break-all">{r.value}</p>
          <p className="text-muted-foreground">Fonte: {r.sourceUrl ? <a className="underline" href={r.sourceUrl} target="_blank" rel="noreferrer">{r.source}<ExternalLink className="ml-1 inline size-3" /></a> : r.source}{r.note ? ` · ${r.note}` : ""}</p>
          {added(r) ? <p className="text-primary">Adicionado ao cadastro</p> : <Button type="button" size="sm" variant="ghost" className="h-7 px-2" disabled={busy} onClick={() => onAdd(r)}>Adicionar ao cadastro</Button>}
        </> : <p className="text-muted-foreground">{r.state === "not_searched" ? "Clique em Buscar dados públicos." : r.state === "error" ? "A fonte não respondeu; tente de novo." : r.note || "Nenhuma fonte pública trouxe este dado."}</p>}
      </div>
    </details>)}
    {cands.length > 0 && <div className="border-t pt-1">
      <p className="font-medium">{lookup?.result?.ambiguous ? "Mais de uma empresa compatível — escolha a correta:" : "CNPJs encontrados, sem correspondência segura — confira:"}</p>
      <ul className="mt-1 space-y-1">{cands.map(c => <li key={c.company.cnpj} className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0">{c.company.legalName} · {c.company.cnpj} · {[c.company.city, c.company.state].filter(Boolean).join("/")}<span className="block text-muted-foreground">{c.company.address} · {c.sourceUrl ? <a className="underline" href={c.sourceUrl} target="_blank" rel="noreferrer">{c.source}</a> : c.source}</span></span>
        <Button type="button" size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => onChoose(c.company)}>Usar este</Button>
      </li>)}</ul>
    </div>}
  </div>;
}
