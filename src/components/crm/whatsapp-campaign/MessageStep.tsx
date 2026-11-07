import { useRef, useState } from "react";
import { Sparkles, Users, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { campaignText } from "@/lib/campaigns";
import { groupText } from "@/lib/whatsapp-campaigns";

const EMOJIS = ["😀", "😊", "👋", "🙏", "👍", "🎉", "🔥", "✅", "📢", "📅", "💬", "🚀", "⭐", "❤️", "👉"];

/** Renders WhatsApp-style *bold*, _italic_, ~strike~. */
function formatted(text: string) {
  const parts = text.split(/(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g);
  return parts.map((p, i) => p.startsWith("*") && p.endsWith("*") && p.length > 2 ? <strong key={i}>{p.slice(1, -1)}</strong> : p.startsWith("_") && p.endsWith("_") && p.length > 2 ? <em key={i}>{p.slice(1, -1)}</em> : p.startsWith("~") && p.endsWith("~") && p.length > 2 ? <s key={i}>{p.slice(1, -1)}</s> : <span key={i}>{p}</span>);
}

export function MessageStep({ body, onChange, kind, sample, templates, onAi, busy }: { body: string; onChange: (b: string) => void; kind: "individual" | "groups"; sample: { name: string; company: string }; templates: { id: string; name: string; body: string }[]; onAi: (brief: string) => Promise<void>; busy: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [brief, setBrief] = useState("");
  const vars = kind === "groups" ? [["Nome do grupo", "{{grupo}}"]] : [["Nome", "{{nome}}"], ["Empresa", "{{empresa}}"]];
  function insert(t: string) {
    const el = ref.current; const s = el?.selectionStart ?? body.length, e = el?.selectionEnd ?? body.length;
    onChange((body.slice(0, s) + t + body.slice(e)).slice(0, 4000));
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(s + t.length, s + t.length); });
  }
  const preview = kind === "groups" ? groupText(body, sample.name) : campaignText(body, sample.name, sample.company);
  return <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><Label htmlFor="wa-body" className="text-sm font-semibold">Mensagem</Label>
          {templates.length > 0 && <Select value="none" onValueChange={id => { const t = templates.find(x => x.id === id); if (t && (!body.trim() || window.confirm("Substituir a mensagem atual pelo modelo?"))) onChange(t.body); }}><SelectTrigger className="h-8 w-auto"><SelectValue placeholder="Mensagem pronta" /></SelectTrigger><SelectContent><SelectItem value="none">Mensagem pronta</SelectItem>{templates.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent></Select>}
        </div>
        <Textarea id="wa-body" ref={ref} rows={9} maxLength={4000} value={body} onChange={e => onChange(e.target.value)} placeholder={kind === "groups" ? "Digite a mensagem que será publicada nos grupos selecionados…" : "Digite a mensagem que será enviada para os contatos…"} />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>Use *negrito*, _itálico_ e ~riscado~.</span><span>{body.length}/4000 caracteres</span></div>
        <div className="mt-3 flex flex-wrap gap-1">{EMOJIS.map(e => <button key={e} type="button" aria-label={`Inserir ${e}`} onClick={() => insert(e)} className="rounded px-1.5 py-0.5 text-lg hover:bg-muted">{e}</button>)}</div>
        <div className="mt-3 flex flex-wrap items-center gap-2"><span className="text-xs text-muted-foreground">Inserir variável:</span>{vars.map(([l, v]) => <Button key={v} type="button" size="sm" variant="outline" onClick={() => insert(v)}>{l}</Button>)}</div>
        {kind === "groups" && <p className="mt-2 text-xs text-muted-foreground">Em grupos, dados individuais dos participantes nunca são usados na mensagem.</p>}
      </div>
      <div className="space-y-2 rounded-lg border bg-card p-4"><Label htmlFor="wa-brief">Preparar com Pipeflow IA</Label><Textarea id="wa-brief" rows={2} maxLength={1500} placeholder="Ex.: convidar clientes para conhecer o novo serviço, com tom próximo" value={brief} onChange={e => setBrief(e.target.value)} /><Button variant="outline" size="sm" disabled={busy || brief.trim().length < 5} onClick={() => void onAi(brief)}><Sparkles className="size-4" />Gerar mensagem</Button><p className="text-xs text-muted-foreground">A IA só sugere o texto; nada é enviado sem a sua revisão.</p></div>
      <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">Anexos (imagem, documento, vídeo) ainda não estão disponíveis nas campanhas; por enquanto o envio é somente de texto.</p>
    </div>
    <div className="mx-auto w-full max-w-[300px]">
      <p className="mb-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">Prévia</p>
      <div className="overflow-hidden rounded-[2rem] border-8 border-foreground/80 bg-wa-wallpaper shadow-xl">
        <div className="flex items-center gap-2 bg-wa-strong px-3 py-3 text-primary-foreground"><span className="grid size-8 place-items-center rounded-full bg-primary-foreground/20">{kind === "groups" ? <Users className="size-4" /> : <User className="size-4" />}</span><span className="min-w-0"><span className="block truncate text-sm font-semibold">{sample.name || (kind === "groups" ? "Grupo" : "Contato")}</span><span className="block text-[10px] opacity-80">{kind === "groups" ? "grupo" : "online"}</span></span></div>
        <div className="flex min-h-[380px] flex-col justify-end p-3">
          {body.trim() ? <div className="ml-auto max-w-[85%] whitespace-pre-wrap break-words rounded-lg rounded-tr-none bg-wa-out px-3 py-2 text-sm text-foreground shadow-sm">{formatted(preview)}<span className="mt-1 block text-right text-[10px] text-muted-foreground">{new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} ✓</span></div> : <p className="text-center text-xs text-muted-foreground">A mensagem aparecerá aqui</p>}
        </div>
      </div>
    </div>
  </div>;
}
