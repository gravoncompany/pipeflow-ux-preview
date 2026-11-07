import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, ExternalLink, Link2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ClientForm, formToInput } from "./ClientForm";
import { addLeadAsClient } from "@/lib/crm-clients.functions";
import { leadClientPrefill } from "@/lib/crm-client-phase1.functions";
import { clientDraftIssues, leadToClientDraft, withCompanyData, type CompanyPrefill, type LeadClientDraft } from "@/lib/lead-to-client";
import type { Lead } from "@/lib/crm-types";

type Outcome = { lead: Lead; status: "created" | "linked" | "review"; clientId?: string; reason?: string };

/**
 * Adicionar leads fechados como clientes. Cada cadastro abre pré-preenchido para revisão; leads já vinculados
 * não são cadastrados de novo. Um lead: após salvar abre a ficha. Vários: mostra o resultado de cada um.
 */
export function AddClientsDialog({ leads, links, onClose }: {
  leads: Lead[] | null;
  links: Map<string, string>;
  onClose: (changed: boolean) => void;
}) {
  const save = useServerFn(addLeadAsClient);
  const prefillFn = useServerFn(leadClientPrefill);
  const [pre, setPre] = useState<{ prefill: Record<string, CompanyPrefill & { existingClient: { id: string; name: string } | null }>; responsible: string }>({ prefill: {}, responsible: "" });
  const draftFor = (l: Lead, p = pre) => withCompanyData(leadToClientDraft(l), p.prefill[l.id], p.responsible);
  const navigate = useNavigate();
  const open = leads !== null && leads.length > 0;
  const single = leads?.length === 1;
  const queue = useMemo(() => (leads ?? []).filter((l) => !links.has(l.id)), [leads]); // eslint-disable-line react-hooks/exhaustive-deps
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState<LeadClientDraft | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open) return;
    const pre = (leads ?? []).filter((l) => links.has(l.id)).map((l) => ({ lead: l, status: "linked" as const, clientId: links.get(l.id) }));
    setOutcomes(pre);
    setIndex(0);
    setDone(queue.length === 0);
    setDraft(queue[0] ? leadToClientDraft(queue[0]) : null);
    if (queue.length) void prefillFn({ data: { leadIds: queue.slice(0, 50).map((l) => l.id) } }).then((p) => {
      setPre(p);
      setDraft((cur) => (cur && queue[0] && cur.leadId === queue[0].id ? withCompanyData(cur, p.prefill[queue[0].id], p.responsible) : cur));
    }).catch(() => undefined);
  }, [open, leads]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = queue[index];
  const issues = draft ? clientDraftIssues(draft) : [];
  const changed = outcomes.some((o) => o.status === "created");

  const advance = (next: Outcome[]) => {
    setOutcomes(next);
    const i = index + 1;
    if (i >= queue.length) { setDone(true); setDraft(null); return; }
    setIndex(i);
    setDraft(draftFor(queue[i]));
  };

  const confirm = async () => {
    if (!draft || !current || issues.length) return;
    setSaving(true);
    try {
      const res = await save({ data: formToInput(draft as any) });
      if (single) {
        toast.success(res.status === "created" ? "Cliente cadastrado." : "Este lead já tinha ficha de cliente.");
        onClose(true);
        void navigate({ to: "/clientes/$id", params: { id: res.id } });
        return;
      }
      advance([...outcomes, { lead: current, status: res.status, clientId: res.id }]);
    } catch (e) {
      const reason = e instanceof Error ? e.message : "Não foi possível salvar.";
      if (single) toast.error(reason);
      else advance([...outcomes, { lead: current, status: "review", reason }]);
    } finally { setSaving(false); }
  };

  const skip = () => current && advance([...outcomes, { lead: current, status: "review", reason: issues[0] ?? "Revisão adiada." }]);

  const group = (status: Outcome["status"]) => outcomes.filter((o) => o.status === status);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !saving) onClose(changed); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {!done && draft && current ? <>
          <DialogHeader>
            <DialogTitle>Adicionar como cliente{!single ? ` — ${index + 1} de ${queue.length}` : ""}</DialogTitle>
            <DialogDescription>
              Revise o cadastro preenchido com os dados do card de <strong>{current.name || "Sem nome"}</strong>. A ficha fica vinculada ao lead, que continua em Fechado.
            </DialogDescription>
          </DialogHeader>
          {pre.prefill[current.id]?.existingClient && <p className="rounded-md border border-primary/40 bg-primary/5 p-2 text-sm">Já existe um cliente com este CNPJ: <Link className="font-medium text-primary underline" to="/clientes/$id" params={{ id: pre.prefill[current.id]!.existingClient!.id }}>{pre.prefill[current.id]!.existingClient!.name}</Link>. Ao confirmar, o cadastro existente é usado (sem duplicar).</p>}
          {pre.prefill[current.id] && <p className="text-xs text-muted-foreground">Razão social, CNPJ, telefone e endereço vieram da Prospecção B2B quando disponíveis. Campos vazios podem ser completados depois na ficha.</p>}
          <ClientForm value={draft} onChange={setDraft} />
          {current.instagram && <p className="text-xs text-muted-foreground">Instagram do card ({current.instagram}) aparece na ficha pelo vínculo com o lead.</p>}
          {issues.length > 0 && <p className="flex items-center gap-1.5 text-sm text-destructive"><AlertTriangle className="size-4" />{issues.join(" ")}</p>}
          <DialogFooter className="gap-2">
            {single
              ? <Button variant="outline" disabled={saving} onClick={() => onClose(false)}>Cancelar</Button>
              : <Button variant="outline" disabled={saving} onClick={skip}>Pular (revisar depois)</Button>}
            <Button disabled={saving || issues.length > 0} onClick={() => void confirm()}>
              {saving ? "Salvando…" : single ? "Salvar e abrir ficha" : index + 1 < queue.length ? "Confirmar e próximo" : "Confirmar e concluir"}
            </Button>
          </DialogFooter>
        </> : <>
          <DialogHeader>
            <DialogTitle>Resultado do cadastro de clientes</DialogTitle>
            <DialogDescription>{outcomes.length} lead(s) selecionado(s) em Fechado.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <ResultGroup title="Cadastrados" icon={<CheckCircle2 className="size-4 text-success" />} items={group("created")} empty="Nenhum cadastro novo." />
            <ResultGroup title="Já estavam vinculados" icon={<Link2 className="size-4 text-primary" />} items={group("linked")} empty="Nenhum." />
            <ResultGroup title="Precisam de revisão" icon={<AlertTriangle className="size-4 text-destructive" />} items={group("review")} empty="Nenhum." />
          </div>
          <DialogFooter><Button onClick={() => onClose(changed)}>Concluir</Button></DialogFooter>
        </>}
      </DialogContent>
    </Dialog>
  );
}

function ResultGroup({ title, icon, items, empty }: { title: string; icon: React.ReactNode; items: Outcome[]; empty: string }) {
  return <section aria-label={title}>
    <h3 className="mb-1.5 flex items-center gap-1.5 font-semibold">{icon}{title} <span className="text-muted-foreground">({items.length})</span></h3>
    {items.length ? <ul className="space-y-1">{items.map((o) => <li key={o.lead.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
      <span className="min-w-0"><span className="font-medium">{o.lead.company || o.lead.name || "Sem nome"}</span>{o.lead.company && o.lead.name ? <span className="text-muted-foreground"> · {o.lead.name}</span> : null}
        {o.reason && <span className="block text-xs text-destructive">{o.reason}</span>}</span>
      {o.clientId && <Link to="/clientes/$id" params={{ id: o.clientId }} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"><ExternalLink className="size-3" />Abrir ficha do cliente</Link>}
    </li>)}</ul> : <p className="text-muted-foreground">{empty}</p>}
  </section>;
}
