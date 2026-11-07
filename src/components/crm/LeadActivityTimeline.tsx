import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { History, Inbox, MessageCircle, Send, StickyNote, X } from "lucide-react";
import { getLeadMessages } from "@/lib/whatsapp-chat.functions";
import { getLeadEmailMarketing } from "@/lib/email-flows.functions";
import { notificationDate } from "@/lib/lead-notifications";
import { buildLeadTimeline, type TimelineItem } from "@/lib/lead-timeline";
import type { Lead } from "@/lib/crm-types";

/** Read-only chronological view of what is already linked to the lead (history, WhatsApp, e-mail). */
export function LeadActivityTimeline({ lead, history, notes, onRemoveHistory }: { lead: Lead; history: Lead["history"]; notes: string; onRemoveHistory?: (id: string) => void }) {
  const fetchMsgs = useServerFn(getLeadMessages);
  const fetchEmails = useServerFn(getLeadEmailMarketing);
  const phoneOk = lead.whatsapp.replace(/\D/g, "").length >= 8;
  // Same query key as the WhatsApp tab, so both views share one request.
  const wa = useQuery({ queryKey: ["wa-msgs", lead.whatsapp, 500], queryFn: () => fetchMsgs({ data: { phone: lead.whatsapp, limit: 500 } }), enabled: phoneOk, retry: false });
  const mail = useQuery({ queryKey: ["lead-email-marketing", lead.id], queryFn: () => fetchEmails({ data: { leadId: lead.id } }), retry: false, gcTime: 0 });
  const items = buildLeadTimeline({
    history,
    messages: wa.data && !wa.data.needsAuth ? wa.data.messages : [],
    emails: mail.data?.allowed ? mail.data.records : [],
  });
  const loading = (phoneOk && wa.isPending) || mail.isPending;

  return <div className="space-y-3">
    {notes.trim() && <div className="rounded-lg border border-primary/20 bg-primary/5 p-3"><p className="flex items-center gap-1.5 text-xs font-semibold text-primary"><StickyNote className="size-3.5" />Anotações internas</p><p className="mt-1 whitespace-pre-line break-words text-sm">{notes}</p></div>}
    <p className="text-xs text-muted-foreground">Mais recentes primeiro · histórico comercial, WhatsApp e e-mail{loading ? " · carregando…" : ""}</p>
    {(wa.data?.needsAuth || (mail.data && !mail.data.allowed)) && <p className="text-xs text-muted-foreground">Conversas e e-mails aparecem com o acesso completo ao CRM.</p>}
    {items.length === 0 && !loading ? <p className="text-sm text-muted-foreground">Nenhuma atividade registrada.</p> :
      <ol className="relative space-y-2 border-l pl-4" aria-label="Atividade do lead">
        {items.map((it) => <li key={it.key} className="group relative">
          <span className="absolute -left-[1.4rem] top-3 flex size-3 items-center justify-center rounded-full border bg-background" />
          <div className="rounded-lg border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground"><Icon item={it} /><span className="truncate">{it.label}</span></p>
              <span className="shrink-0 text-[11px] text-muted-foreground">{it.date ? notificationDate(it.date) : "Sem data"}</span>
            </div>
            {it.title && <p className="mt-1 text-sm font-medium">{it.title}</p>}
            <p className="mt-1 line-clamp-6 whitespace-pre-line break-words text-sm">{it.text || "—"}</p>
            {it.removableId && onRemoveHistory && <button type="button" aria-label="Remover registro" onClick={() => onRemoveHistory(it.removableId!)} className="absolute right-2 top-2 hidden text-muted-foreground hover:text-destructive group-hover:block"><X className="size-4" /></button>}
          </div>
        </li>)}
      </ol>}
  </div>;
}

function Icon({ item }: { item: TimelineItem }) {
  if (item.source === "whatsapp") return <MessageCircle className="size-3.5 shrink-0 text-wa" />;
  if (item.source === "email") return item.direction === "in" ? <Inbox className="size-3.5 shrink-0 text-primary" /> : <Send className="size-3.5 shrink-0" />;
  return <History className="size-3.5 shrink-0" />;
}
