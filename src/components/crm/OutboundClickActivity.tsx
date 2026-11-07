import { useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, MousePointerClick, CheckCheck, History } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getOutboundClickHistory } from '@/lib/outbound-clicks.functions';
import { saveLeadInteraction } from '@/lib/lead-interactions.functions';
import { clickInstagram, lastEmailClick } from '@/lib/outbound-clicks';
import type { Lead } from '@/lib/crm-types';

export function OutboundClickActivity({ lead }: { lead: Lead }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [eventId] = useState(() => crypto.randomUUID());
  const read = useServerFn(getOutboundClickHistory);
  const write = useServerFn(saveLeadInteraction);
  const q = useQuery({ queryKey: ['outbound-clicks', lead.id], queryFn: () => read({ data: { leadId: lead.id } }), enabled: open, retry: false });
  const at = lastEmailClick(lead), instagram = clickInstagram(lead.instagram);
  if (!at) return null;
  const followed = saved || lead.history.some(h => h.text.startsWith('Follow-up manual após clique') && Date.parse(h.date) >= at);
  return <div className="mt-2 space-y-1.5 border-t pt-2" onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
    <div className="flex items-center gap-1 text-xs font-medium text-primary"><MousePointerClick className="size-3.5" />Clicou no link</div>
    <p className="text-[11px] text-muted-foreground">{new Date(at).toLocaleString('pt-BR')}</p>
    <div className="flex flex-wrap gap-1">
      <Button size="sm" variant="ghost" className="h-7 px-1.5 text-xs" onClick={() => setOpen(true)}><History className="size-3" />Cliques</Button>
      {instagram && <Button size="sm" variant="outline" className="h-7 px-1.5 text-xs" asChild><a href={instagram} target="_blank" rel="noopener noreferrer"><ExternalLink className="size-3" />Abrir Instagram</a></Button>}
      <Button size="sm" variant="outline" className="h-7 px-1.5 text-xs" disabled={saving || followed} onClick={async () => {
        setSaving(true);
        try {
          const r = await write({ data: { leadId: lead.id, id: eventId, type: 'interaction', date: new Date().toISOString(), result: 'unknown', responsible: '', note: `Follow-up manual após clique${instagram ? ` · Instagram: ${instagram}` : ''}. Registrado pelo usuário; nenhuma mensagem enviada pelo Pipeflow.` } });
          if (!r.ok) throw new Error(r.error);
          setSaved(true); toast.success('Follow-up registrado no histórico.');
        } catch (e) { toast.error(e instanceof Error ? e.message : 'Não foi possível registrar.'); }
        finally { setSaving(false); }
      }}><CheckCheck className="size-3" />{followed ? 'Follow-up registrado' : 'Registrar follow-up'}</Button>
    </div>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[80dvh] overflow-y-auto"><DialogHeader><DialogTitle>Cliques · {lead.name}</DialogTitle></DialogHeader>
      {q.isPending ? <p className="text-sm text-muted-foreground">Carregando…</p> : q.isError ? <p className="text-sm text-destructive">Histórico indisponível.</p> : <div className="divide-y">{q.data?.map(c => <div key={c.id} className="space-y-1 py-3 text-sm">
        <p className="font-medium break-words">{c.subject}{c.test ? ' · Teste' : ''}</p>
        <p className="text-xs text-muted-foreground">{new Date(c.at).toLocaleString('pt-BR')} · {c.classification === 'human' ? 'Clique com interação do navegador' : c.classification === 'automated' ? 'Verificação automática (não conta como clique)' : 'Origem incerta (não conta como clique)'}</p>
        <p className="break-all text-xs">{c.url}</p><p className="break-all text-xs text-muted-foreground">E-mail: {c.messageId ?? c.id}</p>
      </div>)}</div>}
    </DialogContent></Dialog>
  </div>;
}