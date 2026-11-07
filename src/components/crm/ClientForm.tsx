import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CLIENT_STATUS } from "@/lib/crm-clients";

export function ClientForm({ value, onChange }: { value: any; onChange: (v: any) => void }) {
  const set = (k: string, v: unknown) => onChange({ ...value, [k]: v });
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div><Label>Nome da empresa *</Label><Input value={value.tradeName} onChange={e => set("tradeName", e.target.value)} /></div>
      <div><Label>Razão social</Label><Input value={value.legalName} onChange={e => set("legalName", e.target.value)} /></div>
      <div><Label>CNPJ (14 dígitos)</Label><Input value={value.cnpj} onChange={e => set("cnpj", e.target.value.replace(/\D/g, "").slice(0, 14))} /></div>
      <div><Label>Contato responsável</Label><Input value={value.contactName} onChange={e => set("contactName", e.target.value)} /></div>
      <div><Label>Telefone</Label><Input value={value.phone} onChange={e => set("phone", e.target.value)} /></div>
      <div><Label>WhatsApp</Label><Input value={value.whatsapp} onChange={e => set("whatsapp", e.target.value)} /></div>
      <div><Label>E-mail</Label><Input type="email" value={value.email} onChange={e => set("email", e.target.value)} /></div>
      <div><Label>Site</Label><Input value={value.website} onChange={e => set("website", e.target.value)} /></div>
      <div className="md:col-span-2"><Label>Endereço</Label><Input value={value.address} onChange={e => set("address", e.target.value)} /></div>
      <div><Label>Início do relacionamento</Label><Input type="date" value={value.relationshipStart ?? ""} onChange={e => set("relationshipStart", e.target.value || null)} /></div>
      <div>
        <Label>Situação</Label>
        <Select value={value.status} onValueChange={v => set("status", v)}>
          <SelectTrigger aria-label="Situação"><SelectValue /></SelectTrigger>
          <SelectContent>{Object.entries(CLIENT_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div><Label>Responsável interno</Label><Input value={value.internalResponsible} onChange={e => set("internalResponsible", e.target.value)} /></div>
      <div><Label>Lembrete de pagamento (dias antes do vencimento)</Label><Input type="number" min={0} max={60} value={value.reminderDays} onChange={e => set("reminderDays", Number(e.target.value) || 0)} /></div>
      <div className="md:col-span-2"><Label>Serviços contratados (separados por vírgula)</Label><Input value={value.servicesText} onChange={e => set("servicesText", e.target.value)} placeholder="Tráfego pago, Social media, Site" /></div>
      <div className="md:col-span-2"><Label>Observações</Label><Input value={value.notes} onChange={e => set("notes", e.target.value)} /></div>
    </div>
  );
}

export const emptyClientForm = {
  id: null as string | null, leadId: null as string | null, tradeName: "", legalName: "", cnpj: "", contactName: "",
  phone: "", whatsapp: "", email: "", address: "", website: "", relationshipStart: null as string | null,
  servicesText: "", status: "implantacao", internalResponsible: "", reminderDays: 5, notes: "", revision: 0,
};

export function formToInput(f: typeof emptyClientForm) {
  return {
    id: f.id, leadId: f.leadId, tradeName: f.tradeName, legalName: f.legalName, cnpj: f.cnpj, contactName: f.contactName,
    phone: f.phone, whatsapp: f.whatsapp, email: f.email, address: f.address, website: f.website,
    relationshipStart: f.relationshipStart, services: f.servicesText.split(",").map(s => s.trim()).filter(Boolean),
    status: f.status as any, internalResponsible: f.internalResponsible, reminderDays: f.reminderDays, notes: f.notes, revision: f.revision,
  };
}

export function clientToForm(c: any) {
  return { ...emptyClientForm, id: c.id, leadId: c.lead_id, tradeName: c.trade_name, legalName: c.legal_name, cnpj: c.cnpj,
    contactName: c.contact_name, phone: c.phone, whatsapp: c.whatsapp, email: c.email, address: c.address, website: c.website,
    relationshipStart: c.relationship_start, servicesText: (c.services ?? []).join(", "), status: c.status,
    internalResponsible: c.internal_responsible, reminderDays: c.reminder_days, notes: c.notes, revision: Number(c.revision) };
}
