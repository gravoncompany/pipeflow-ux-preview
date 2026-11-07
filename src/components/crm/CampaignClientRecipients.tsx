import { useState } from "react";
import { Search } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { CampaignClient } from "@/lib/campaign-recipients";

/**
 * "Clientes cadastrados" source: every registered client can be selected directly.
 * A client with a CRM card is added through that card; a client without a card is added by itself (no card is created).
 */
export function CampaignClientRecipients({ clients, leadIds, clientIds, onChange }: { clients: CampaignClient[] | null; leadIds: string[]; clientIds: string[]; onChange: (leadIds: string[], clientIds: string[]) => void }) {
  const [search, setSearch] = useState("");
  if (!clients) return <p role="alert" className="my-3 text-sm text-destructive">Não foi possível carregar os clientes cadastrados. Atualize a página.</p>;
  const term = search.trim().toLowerCase();
  const visible = term ? clients.filter((c) => `${c.name} ${c.company} ${c.whatsapp}`.toLowerCase().includes(term)) : clients;
  const isOn = (c: CampaignClient) => c.leadId ? leadIds.includes(c.leadId) : clientIds.includes(c.clientId);
  const apply = (list: CampaignClient[], on: boolean) => {
    const leads = new Set(leadIds), direct = new Set(clientIds);
    for (const c of list) {
      if (c.leadId) { if (on) leads.add(c.leadId); else leads.delete(c.leadId); }
      else if (on) direct.add(c.clientId); else direct.delete(c.clientId);
    }
    onChange([...leads], [...direct]);
  };
  const allOn = visible.length > 0 && visible.every(isOn);
  return <div>
    <div className="relative my-3"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><Input className="pl-9" placeholder="Buscar cliente, empresa ou WhatsApp" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <Button variant="outline" size="sm" disabled={!visible.length} onClick={() => apply(visible, !allOn)}>{allOn ? "Desmarcar todos" : `Selecionar todos (${visible.length})`}</Button>
    </div>
    <div className="max-h-64 divide-y overflow-y-auto">
      {visible.length === 0 ? <p className="py-3 text-sm text-muted-foreground">{clients.length ? "Nenhum cliente encontrado." : "Nenhum cliente cadastrado no menu Clientes."}</p> : visible.map((c) => <label key={c.clientId} className="flex items-start gap-3 py-3 text-sm">
        <Checkbox checked={isOn(c)} onCheckedChange={(v) => apply([c], v === true)} aria-label={`Selecionar ${c.company}`} />
        <span className="min-w-0 break-words">{c.name}<span className="block text-xs text-muted-foreground">{c.company} · {c.whatsapp || "Sem WhatsApp"}{c.leadId ? "" : " · cliente sem card"}</span></span>
      </label>)}
    </div>
  </div>;
}
