import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { MessageCircle, Save, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { DIAGNOSIS_AUTOMATION_NAME, DIAGNOSIS_MESSAGE, DIAGNOSIS_SEND_LABEL } from "@/lib/diagnosis-automation";
import { getDiagnosisAutomation, saveDiagnosisAutomation } from "@/lib/diagnosis-automation.functions";

export function DiagnosisAutomation() {
  const get = useServerFn(getDiagnosisAutomation), save = useServerFn(saveDiagnosisAutomation);
  const q = useQuery({ queryKey: ["diagnosis-automation"], queryFn: () => get(), retry: false });
  const [draft, setDraft] = useState<{ enabled: boolean; instance: string } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const options = draft ?? q.data?.settings ?? { enabled: false, instance: "" };
  async function commit() {
    if (!q.data || busy) return;
    setBusy(true); setError("");
    try { await save({ data: { ...options, revision: q.data.settings.revision } }); await q.refetch(); setDraft(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Não foi possível salvar."); }
    finally { setBusy(false); }
  }
  return <section className="border-b py-6" aria-label={DIAGNOSIS_AUTOMATION_NAME}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><MessageCircle className="size-5 text-primary" />{DIAGNOSIS_AUTOMATION_NAME}</h2>
      <Badge variant={q.data?.settings.enabled ? "default" : "secondary"}>{q.data?.settings.enabled ? "Ativa" : "Desligada"}</Badge>
    </div>
    {q.isPending ? <p className="mt-4 text-sm text-muted-foreground">Carregando…</p> : q.isError ? <p role="alert" className="mt-4 text-sm text-destructive">{q.error instanceof Error ? q.error.message : "Atendimento indisponível."}</p> : <>
      <div className="mt-5 flex flex-wrap items-end gap-4">
        <div className="flex items-center gap-2"><Switch id="diagnosis-enabled" checked={options.enabled} disabled={busy} onCheckedChange={(enabled) => setDraft({ ...options, enabled })} /><Label htmlFor="diagnosis-enabled">Atender novos diagnósticos</Label></div>
        <div className="w-full max-w-sm space-y-2"><Label>WhatsApp autorizado da Gravon</Label><Select value={options.instance || undefined} onValueChange={(instance) => setDraft({ ...options, instance })} disabled={busy}>
          <SelectTrigger aria-label="WhatsApp autorizado da Gravon"><SelectValue placeholder="Selecionar instância" /></SelectTrigger><SelectContent>{q.data?.channels.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
        </Select></div>
        <Button onClick={() => void commit()} disabled={busy || !draft || (options.enabled && !options.instance)}><Save className="size-4" />Salvar</Button>
        <Button variant="outline" size="icon" aria-label="Atualizar atendimento" title="Atualizar atendimento" onClick={() => void q.refetch()} disabled={busy}><RefreshCw className="size-4" /></Button>
      </div>
      {q.data?.channelError && <p role="status" className="mt-3 text-sm text-muted-foreground">{q.data.channelError}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      <ol className="mt-5 grid gap-2 text-sm text-muted-foreground sm:grid-cols-4"><li>Formulário recebido</li><li>Cadastro e diagnóstico</li><li>E-mails do contato pausados</li><li>WhatsApp com autorização</li></ol>
      <blockquote className="mt-4 whitespace-pre-line border-l-2 border-primary pl-4 text-sm">{DIAGNOSIS_MESSAGE}</blockquote>
      <div className="mt-4 flex flex-wrap gap-4 text-sm"><Link to="/configuracoes/integracoes/api" className="text-primary underline">Recebimentos e consentimento</Link><Link to="/configuracoes/notificacoes" className="text-primary underline">Notificações push</Link></div>
      {!!q.data?.sends.length && <ul className="mt-4 divide-y">{q.data.sends.map((s) => <li key={s.id} className="flex flex-wrap justify-between gap-3 py-3 text-sm"><Link to="/" search={{ lead: s.lead_id }} className="text-primary underline">Abrir cadastro</Link><span>{DIAGNOSIS_SEND_LABEL[s.state] ?? s.state}</span><time>{new Date(s.created_at).toLocaleString("pt-BR")}</time></li>)}</ul>}
    </>}
  </section>;
}