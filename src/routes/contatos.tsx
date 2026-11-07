import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CrmAuthGate } from "@/components/crm/CrmAuthGate";
import { AtendimentoLayout } from "@/components/crm/AtendimentoLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { listContacts, convertLeadToClient } from "@/lib/crm-clients.functions";
import { CLIENT_STATUS } from "@/lib/crm-clients";

export const Route = createFileRoute("/contatos")({
  head: () => ({
    meta: [
      { title: "Contatos — PipeFlow CRM" },
      { name: "description", content: "Todos os contatos do PipeFlow: leads, prospects e clientes da Gravon Company em uma única visão." },
      { property: "og:title", content: "Contatos — PipeFlow CRM" },
      { property: "og:description", content: "Visão unificada de leads, prospects e clientes." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ContatosPage,
});

const ORIGINS = ["Google Ads", "Meta Ads", "Google Maps", "DeskData", "manual", "Cliente"];

function originLabel(o: string) {
  const s = (o || "").toLowerCase();
  if (s.includes("google") && s.includes("maps")) return "Google Maps";
  if (s.includes("deskdata")) return "DeskData";
  if (s.includes("google")) return "Google Ads";
  if (s.includes("meta") || s.includes("facebook") || s.includes("instagram")) return "Meta Ads";
  if (s === "cliente") return "Cliente";
  if (!s || s === "manual" || s === "form") return "Cadastro manual";
  return o;
}

function ContatosPage() {
  const q = useQuery({ queryKey: ["crm-contacts"], queryFn: () => listContacts(), retry: false });
  const [search, setSearch] = useState("");
  const [origin, setOrigin] = useState("todos");
  const [convert, setConvert] = useState<any>(null);
  if (q.isPending) return <AtendimentoLayout><div className="flex-1 p-6"><p className="py-6 text-muted-foreground">Carregando contatos…</p></div></AtendimentoLayout>;
  if (q.isError) return <CrmAuthGate onUnlock={() => void q.refetch()} />;
  const contacts = q.data.contacts;
  const filtered = contacts.filter((c: any) => {
    const hay = `${c.name} ${c.company} ${c.contact} ${c.email} ${c.cnpj}`.toLowerCase();
    if (search && !hay.includes(search.toLowerCase())) return false;
    if (origin !== "todos" && originLabel(c.origin) !== origin) return false;
    return true;
  });
  return (
    <AtendimentoLayout><div className="mx-auto w-full max-w-6xl flex-1 space-y-6 overflow-y-auto p-6">
      <header>
        <h1 className="text-2xl font-semibold">Todos os Contatos</h1>
        <p className="text-sm text-muted-foreground">Leads, prospects e clientes em uma única visão. Converta contatos em clientes sem perder o histórico.</p>
      </header>
      <div className="flex flex-wrap gap-3">
        <Input className="max-w-sm" placeholder="Pesquisar por nome, empresa, telefone, e-mail ou CNPJ" value={search} onChange={e => setSearch(e.target.value)} aria-label="Pesquisar contatos" />
        <Select value={origin} onValueChange={setOrigin}>
          <SelectTrigger className="w-52" aria-label="Filtrar por origem"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todas as origens</SelectItem>
            {[...ORIGINS, "Cadastro manual"].map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="p-3">Nome</th><th className="p-3">Empresa</th><th className="p-3">Contato</th>
              <th className="p-3">Origem</th><th className="p-3">Funil / etapa</th><th className="p-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c: any) => (
              <tr key={`${c.kind}:${c.id}`} className="border-t">
                <td className="p-3 font-medium">{c.name}</td>
                <td className="p-3">{c.company || "—"}</td>
                <td className="p-3">{c.contact || c.email || "—"}</td>
                <td className="p-3">{originLabel(c.origin)}</td>
                <td className="p-3">{c.kind === "cliente" ? CLIENT_STATUS[c.stage as keyof typeof CLIENT_STATUS] ?? c.stage : c.stage}</td>
                <td className="p-3">
                  {c.kind === "cliente" ? (
                    <ClientLink id={c.id} />
                  ) : c.client ? (
                    <ClientLink id={c.client.id} label="Ver cliente" />
                  ) : c.kind === "lead" ? (
                    <Button size="sm" variant="outline" onClick={() => setConvert(c)}>Converter em cliente</Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">Envie ao funil pela Prospecção B2B</span>
                  )}
                </td>
              </tr>
            ))}
            {!filtered.length && (
              <tr><td className="p-6 text-center text-muted-foreground" colSpan={6}>Nenhum contato encontrado.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {convert && <ConvertDialog contact={convert} onClose={() => setConvert(null)} />}
    </div></AtendimentoLayout>
  );
}

function ClientLink({ id, label = "Abrir ficha" }: { id: string; label?: string }) {
  const navigate = useNavigate();
  return <Button size="sm" variant="outline" onClick={() => navigate({ to: "/clientes/$id", params: { id } })}>{label}</Button>;
}

function ConvertDialog({ contact, onClose }: { contact: any; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const run = useServerFn(convertLeadToClient);
  const [status, setStatus] = useState("implantacao");
  const [responsible, setResponsible] = useState("");
  const [services, setServices] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setBusy(true); setError("");
    try {
      const r = await run({ data: { leadId: contact.id, status: status as any, internalResponsible: responsible, services: services.split(",").map(s => s.trim()).filter(Boolean), notes, confirmed: true } });
      await qc.invalidateQueries({ queryKey: ["crm-contacts"] });
      navigate({ to: "/clientes/$id", params: { id: r.id } });
    } catch (e) { setError(e instanceof Error ? e.message : "Falha ao converter."); }
    setBusy(false);
  }
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Converter {contact.name} em cliente</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">O histórico do contato é preservado e a conversão fica registrada na linha do tempo do lead.</p>
          <div>
            <Label>Situação contratual</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger aria-label="Situação contratual"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(CLIENT_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Responsável interno pelo atendimento</Label><Input value={responsible} onChange={e => setResponsible(e.target.value)} /></div>
          <div><Label>Serviços contratados (separados por vírgula)</Label><Input value={services} onChange={e => setServices(e.target.value)} placeholder="Tráfego pago, Social media" /></div>
          <div><Label>Observações</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} /></div>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={confirmed} onCheckedChange={v => setConfirmed(v === true)} />
            Confirmo a conversão deste contato em cliente da Gravon Company.
          </label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button disabled={!confirmed || busy} onClick={() => void submit()}>{busy ? "Convertendo…" : "Confirmar conversão"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
