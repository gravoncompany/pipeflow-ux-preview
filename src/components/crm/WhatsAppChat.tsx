import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ListPlus, Send } from "lucide-react";
import { MessageTaskDialog } from "./MessageTaskDialog";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getLeadMessages, sendWhatsApp, getWhatsAppMedia } from "@/lib/whatsapp-chat.functions";
import { ConversationAnalysis } from "./ConversationAnalysis";
import { SEND_STATE_LABELS } from "@/lib/whatsapp-message-sync";

export function WhatsAppChat({ phone, className = "h-[420px]", showAnalysis = true }: { phone: string; className?: string; showAnalysis?: boolean }) {
  const fetchMsgs = useServerFn(getLeadMessages);
  const send = useServerFn(sendWhatsApp);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [historyLimit, setHistoryLimit] = useState(500);
  const [taskMsg, setTaskMsg] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const q = useQuery({ queryKey: ["wa-msgs", phone, historyLimit], queryFn: () => fetchMsgs({ data: { phone, limit: historyLimit } }), enabled: phone.replace(/\D/g, "").length >= 8, refetchInterval: 8000 });
  const messages = q.data?.messages ?? [];

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end", inline: "nearest" }); }, [messages.length]);

  if (phone.replace(/\D/g, "").length < 8) return <p className="text-sm text-muted-foreground">Preencha o WhatsApp do lead para ver a conversa.</p>;
  if (q.data?.needsAuth) return <p className="text-sm text-muted-foreground">As conversas exigem a senha de acesso completo.</p>;

  async function submit() {
    if (sending || !text.trim()) return;
    setSending(true);
    const r = await send({ data: { phone, text } }).catch(() => ({ ok: false, error: "Falha ao enviar." }));
    setSending(false);
    if (!r.ok) { toast.error(r.error ?? "Falha ao enviar."); return; }
    setText("");
    void q.refetch();
  }

  return <div className={`flex flex-col overflow-hidden rounded-xl border bg-wa-wallpaper ${className}`}>
    {showAnalysis && <ConversationAnalysis key={phone} phone={phone} />}
    <MessageTaskDialog messageId={taskMsg} onClose={() => setTaskMsg(null)} />
    <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain px-3 py-4 md:px-8" aria-label="Histórico da conversa">
      {q.isError && <p role="alert" className="text-sm text-destructive">Não foi possível atualizar a conversa.</p>}
      {q.data && "hasMore" in q.data && q.data.hasMore && <Button variant="outline" size="sm" onClick={() => setHistoryLimit((n) => Math.min(10000, n + 500))}>Mensagens anteriores</Button>}
      {q.isPending ? <p className="mx-auto w-fit rounded-md bg-card px-3 py-1 text-center text-sm text-muted-foreground shadow-sm">Carregando...</p> :
        messages.length === 0 ? <p className="mx-auto my-10 w-fit rounded-md bg-card px-3 py-1 text-center text-sm text-muted-foreground shadow-sm">Nenhuma mensagem com este número ainda.</p> :
        messages.map((m) => <div key={m.id} className={`flex ${m.fromMe ? "justify-end" : "justify-start"}`}>
          <div className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-sm text-foreground shadow-sm md:max-w-[65%] ${m.fromMe ? "rounded-tr-none bg-wa-out" : "rounded-tl-none bg-wa-in"}`}>
            {m.mediaType && <Media id={m.id} type={m.mediaType} />}
            {(!m.mediaType || !m.body.startsWith("[")) && <p className="whitespace-pre-wrap break-words">{m.body || "—"}</p>}
            <p className="mt-0.5 flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground">
              <button type="button" onClick={() => setTaskMsg(m.id)} className="mr-auto inline-flex items-center gap-0.5 text-primary hover:underline" aria-label="Criar tarefa a partir desta mensagem"><ListPlus className="h-3 w-3" />Criar tarefa</button>
              {m.fromMe && m.sendState && <span className={m.sendState === "read" ? "text-primary" : ""}>{SEND_STATE_LABELS[m.sendState] ?? "Entrega não confirmada"}</span>}
              <span>{new Date(m.sentAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
            </p>
          </div>
        </div>)}
      <div ref={endRef} />
    </div>
    <div className="flex shrink-0 items-end gap-2 border-t bg-muted p-2">
      <Textarea rows={2} value={text} placeholder="Escreva uma mensagem..." className="max-h-32 min-h-0 resize-none rounded-lg border-0 bg-card"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); } }} />
      <Button size="icon" className="shrink-0 rounded-full bg-wa text-primary-foreground hover:bg-wa-strong" disabled={sending || !text.trim()} onClick={() => void submit()} aria-label="Enviar"><Send /></Button>
    </div>
  </div>;
}

function Media({ id, type }: { id: string; type: string }) {
  const get = useServerFn(getWhatsAppMedia);
  const q = useQuery({ queryKey: ["wa-media", id], queryFn: () => get({ data: { messageId: id } }), staleTime: Infinity, gcTime: 30 * 60 * 1000, retry: 1 });
  if (q.isPending) return <p className="text-xs opacity-70">Carregando mídia...</p>;
  const url = q.data?.dataUrl;
  if (!url) return <p className="text-xs opacity-70">{q.data?.error ?? "Mídia indisponível."}</p>;
  if (type === "image" || type === "sticker") return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="Imagem recebida" className="mb-1 max-h-64 rounded-lg" /></a>;
  if (type === "audio") return <audio controls src={url} className="mb-1 w-60 max-w-full" />;
  if (type === "video") return <video controls src={url} className="mb-1 max-h-64 rounded-lg" />;
  return <a href={url} download className="mb-1 block text-xs underline">Baixar documento</a>;
}
