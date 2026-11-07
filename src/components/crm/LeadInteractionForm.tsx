import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Phone, Plus } from "lucide-react";
import { CALL_RESULTS, interactionDate } from "@/lib/lead-interactions";
import { saveLeadInteraction } from "@/lib/lead-interactions.functions";
import type { HistoryEntry } from "@/lib/crm-types";

function localNow() { const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()); return parts.replace(" ", "T"); }
export function LeadInteractionForm({ leadId, isNew, onSaved }: { leadId: string; isNew: boolean; onSaved: (history: HistoryEntry[]) => void }) {
  const [type, setType] = useState<"interaction" | "whatsapp_call">("interaction");
  const [date, setDate] = useState(localNow);
  const [note, setNote] = useState("");
  const [responsible, setResponsible] = useState("");
  const [result, setResult] = useState<keyof typeof CALL_RESULTS>("unknown");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pendingId = useRef<string | null>(null);
  const save = useServerFn(saveLeadInteraction);
  const changed = () => { pendingId.current = null; };
  async function submit() {
    if (saving || isNew) return;
    const d = interactionDate(date);
    if (!Number.isFinite(d.getTime()) || (type === "interaction" && !note.trim())) { setError("Informe a data e o conteúdo da interação."); return; }
    setSaving(true); setError("");
    const id = pendingId.current ?? crypto.randomUUID(); pendingId.current = id;
    try {
      const response = await save({ data: { leadId, id, type, date: d.toISOString(), note, responsible, result } });
      if (!response.ok || !response.history) { setError(response.error ?? "Não foi possível salvar. Seus dados foram mantidos."); return; }
      onSaved(response.history); setNote(""); setResponsible(""); pendingId.current = null; toast.success("Interação salva.");
    } catch { setError("Não foi possível salvar. Seus dados foram mantidos; tente novamente."); }
    finally { setSaving(false); }
  }
  return <section className="space-y-3 border-b pb-4" aria-label="Registrar interação">
    <Label htmlFor="interaction-type">Tipo de interação</Label>
    <Select value={type} onValueChange={(v) => { changed(); setType(v as typeof type); }} disabled={saving}>
      <SelectTrigger id="interaction-type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="interaction">Interação</SelectItem><SelectItem value="whatsapp_call">Ligação pelo WhatsApp</SelectItem></SelectContent>
    </Select>
    <Label htmlFor="interaction-date">Data e horário (Brasília)</Label><Input id="interaction-date" type="datetime-local" value={date} disabled={saving} onChange={e => { changed(); setDate(e.target.value); }} />
    {type === "whatsapp_call" && <><Label htmlFor="call-result">Resultado</Label><Select value={result} disabled={saving} onValueChange={v => { changed(); setResult(v as typeof result); }}><SelectTrigger id="call-result"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(CALL_RESULTS).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select><Label htmlFor="call-responsible">Responsável pela ligação (opcional)</Label><Input id="call-responsible" maxLength={160} disabled={saving} value={responsible} onChange={e => { changed(); setResponsible(e.target.value); }} /></>}
    <Label htmlFor="interaction-note">{type === "whatsapp_call" ? "Observação (opcional)" : "Interação"}</Label><Textarea id="interaction-note" placeholder="Registrar interação..." maxLength={4000} value={note} disabled={saving} onChange={e => { changed(); setNote(e.target.value); }} />
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {isNew && <p className="text-sm text-muted-foreground">Salve o lead antes de registrar a interação.</p>}
    <Button onClick={submit} disabled={saving || isNew} className="w-full">{type === "whatsapp_call" ? <Phone className="size-4" /> : <Plus className="size-4" />}{saving ? "Salvando…" : "Registrar interação"}</Button>
  </section>;
}