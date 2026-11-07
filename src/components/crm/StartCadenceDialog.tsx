import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getManualAutomations, startSelectedAutomationRuns } from "@/lib/automations.functions";
import { chunk } from "@/lib/bulk-actions";
import type { Lead } from "@/lib/crm-types";

type Auto = { id: string; name: string; state: "test" | "active"; testContacts: number; emails: number };
type Result = { leadId: string; ok: boolean; reason: string };

/** Inclui os cards selecionados numa automação de início manual, depois de confirmar. */
export function StartCadenceDialog({ open, onOpenChange, leads, pipelineId, onDone }: {
  open: boolean; onOpenChange: (v: boolean) => void; leads: Lead[]; pipelineId: string | null; onDone: () => void;
}) {
  const list = useServerFn(getManualAutomations), start = useServerFn(startSelectedAutomationRuns);
  const [autos, setAutos] = useState<Auto[] | null>(null), [chosen, setChosen] = useState("");
  const [working, setWorking] = useState(false), [err, setErr] = useState(""), [results, setResults] = useState<Result[] | null>(null);
  const names = new Map(leads.map((l) => [l.id, l.company || l.name || "Card"]));
  const withEmail = leads.filter((l) => (l.email ?? "").includes("@")).length;

  useEffect(() => {
    if (!open) return;
    setAutos(null); setChosen(""); setErr(""); setResults(null);
    list({ data: { pipelineId } }).then((a) => { setAutos(a); if (a.length === 1) setChosen(a[0].id); })
      .catch((e) => setErr(e instanceof Error ? e.message : "Automações indisponíveis."));
  }, [open, pipelineId, list]);

  const auto = autos?.find((a) => a.id === chosen);

  async function confirm() {
    if (!auto || working) return;
    setWorking(true); setErr("");
    const all: Result[] = [];
    try {
      for (const ids of chunk(leads.map((l) => l.id), 50)) {
        try { all.push(...(await start({ data: { automationId: auto.id, leadIds: ids } })).results); }
        catch (e) { const reason = e instanceof Error ? e.message : "Não foi possível incluir."; all.push(...ids.map((leadId) => ({ leadId, ok: false, reason }))); }
      }
      setResults(all);
      onDone();
    } finally { setWorking(false); }
  }

  const ok = results?.filter((r) => r.ok).length ?? 0;
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!working) onOpenChange(v); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Zap className="size-4 text-primary" />Iniciar cadência automática</DialogTitle>
          <DialogDescription>Só os {leads.length} card(s) selecionado(s) entram na sequência. Cada contato recebe os e-mails uma única vez e para ao responder, preencher o diagnóstico ou pedir para não receber.</DialogDescription>
        </DialogHeader>

        {!results && (
          <div className="space-y-3 text-sm">
            {autos === null && !err && <p className="text-muted-foreground">Carregando automações…</p>}
            {autos?.length === 0 && (
              <p className="rounded-md border border-dashed p-3 text-muted-foreground">
                Nenhuma automação de início manual ligada para este funil. Crie uma em <Link to="/automacoes" className="text-primary underline">Automações</Link> com o gatilho “Início manual — Cards selecionados” e ligue em teste ou ativa.
              </p>
            )}
            {autos && autos.length > 0 && (
              <div className="space-y-1.5" role="radiogroup" aria-label="Automação">
                {autos.map((a) => (
                  <label key={a.id} className={`flex cursor-pointer items-center justify-between gap-2 rounded-md border p-2.5 ${chosen === a.id ? "border-primary bg-primary/5" : ""}`}>
                    <span className="flex items-center gap-2">
                      <input type="radio" name="auto" checked={chosen === a.id} onChange={() => setChosen(a.id)} className="accent-[hsl(var(--primary))]" />
                      <span className="font-medium">{a.name}</span>
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">{a.emails} e-mails<Badge variant={a.state === "active" ? "default" : "secondary"}>{a.state === "active" ? "Ativa" : "Em teste"}</Badge></span>
                  </label>
                ))}
              </div>
            )}
            {auto?.state === "test" && <p className="rounded-md bg-muted p-2 text-xs">Em teste: só entram cards com um dos {auto.testContacts} e-mail(s) de teste autorizados. Os demais aparecem como não incluídos.</p>}
            {auto && <p className="text-xs text-muted-foreground">{withEmail} de {leads.length} card(s) têm e-mail. Cards sem e-mail, descadastrados, que já passaram por esta automação ou que estão em outra sequência ficam de fora.</p>}
            {err && <p role="alert" className="text-destructive">{err}</p>}
          </div>
        )}

        {results && (
          <div className="space-y-2 text-sm">
            <p className="font-medium">{ok} de {results.length} card(s) incluído(s) na cadência.</p>
            {ok > 0 && <p className="text-xs text-muted-foreground">O primeiro e-mail sai na próxima execução automática (a cada 10 minutos, no site publicado), dentro do horário configurado.</p>}
            {results.some((r) => !r.ok) && (
              <ul className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border p-2 text-xs">
                {results.filter((r) => !r.ok).map((r) => <li key={r.leadId}><span className="font-medium">{names.get(r.leadId)}</span> — {r.reason}</li>)}
              </ul>
            )}
          </div>
        )}

        <DialogFooter>
          {results ? <Button onClick={() => onOpenChange(false)}>Fechar</Button> : (
            <>
              <Button variant="ghost" disabled={working} onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button disabled={!auto || working} onClick={() => void confirm()}>{working ? "Incluindo…" : `Confirmar inclusão de ${leads.length} card(s)`}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
