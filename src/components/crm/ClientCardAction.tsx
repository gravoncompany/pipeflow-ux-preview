import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createClientCard, linkClientCard } from "@/lib/crm-clients.functions";
import type { ClientCardLink } from "@/lib/client-card-links";

/** "Abrir card" when the client already has a CRM card; otherwise create one (Funil Principal · Fechado) or link manually. */
export function ClientCardAction({ link, clientName }: { link: ClientCardLink | undefined; clientName: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const create = useServerFn(createClientCard);
  const linkFn = useServerFn(linkClientCard);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!link) return null;
  const openCard = (leadId: string) => void navigate({ to: "/", search: { lead: leadId } });
  if (link.state === "linked") return <Button size="sm" variant="outline" onClick={() => openCard(link.leadId)}>Abrir card</Button>;
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["crm-client-card-links"] }), qc.invalidateQueries({ queryKey: ["crm-clients"] })]);
  async function run(fn: () => Promise<string>) {
    setBusy(true); setError("");
    try { const leadId = await fn(); await refresh(); setOpen(false); openCard(leadId); }
    catch (e) { setError(e instanceof Error ? e.message : "Não foi possível concluir."); await refresh(); }
    setBusy(false);
  }
  const doCreate = () => run(async () => (await create({ data: { clientId: link.clientId } })).leadId);
  const doLink = (leadId: string) => run(async () => (await linkFn({ data: { clientId: link.clientId, leadId } })).leadId);
  const has = link.candidates.length > 0;
  return <>
    <Button size="sm" onClick={() => setOpen(true)}>{has ? "Vincular ou criar card" : "Criar card no CRM"}</Button>
    <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Card do CRM · {clientName}</DialogTitle>
          <DialogDescription>
            {has ? "Encontramos cards que podem ser deste cliente. Vincule o card correto ou crie um novo." : "Será criado um card no Funil Principal, na etapa Fechado, com nome, empresa e telefone deste cliente."}
          </DialogDescription>
        </DialogHeader>
        {has && <ul className="max-h-64 divide-y overflow-y-auto rounded-md border">
          {link.candidates.map((c) => <li key={c.leadId} className="flex items-center justify-between gap-3 p-3 text-sm">
            <span className="min-w-0 break-words">{c.name || "Sem nome"}<span className="block text-xs text-muted-foreground">{c.company || "—"} · {c.whatsapp || "sem WhatsApp"} · {c.reasons.join(", ")}</span></span>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void doLink(c.leadId)}>Vincular</Button>
          </li>)}
        </ul>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>Cancelar</Button>
          <Button disabled={busy} onClick={() => void doCreate()}>{busy ? "Aguarde…" : has ? "Nenhum destes · criar novo card" : "Criar card no CRM"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
