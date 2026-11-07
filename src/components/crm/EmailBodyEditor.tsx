import { useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Image as ImageIcon, Link2, Monitor, MousePointerClick, Smartphone, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { uploadEmailImage } from "@/lib/email-images.functions";
import { EMAIL_IMAGE_MAX_BYTES } from "@/lib/email-images";
import { renderEmail } from "@/lib/email-campaigns";
import {
  BUTTON_COLOR_PRESETS, DEFAULT_BUTTON_COLOR, buttonMarkup, buttonTextColor, imageMarkup, linkMarkup,
  parseEmailBody, previewImageOrigin, safeEmailUrl, safeHexColor,
} from "@/lib/email-content";

type Kind = "image" | "button" | "link" | null;

function toBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    r.readAsDataURL(file);
  });
}

export function EmailBodyEditor({ value, subject, onChange }: { value: string; subject: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const upload = useServerFn(uploadEmailImage);
  const [open, setOpen] = useState<Kind>(null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [f, setF] = useState({ url: "", text: "", link: "", color: DEFAULT_BUTTON_COLOR });
  const [err, setErr] = useState("");
  const [uploading, setUploading] = useState(false);

  const issues = useMemo(() => parseEmailBody(value).issues, [value]);
  const html = useMemo(() => {
    const r = renderEmail({ subject, body: value }, { name: "Nome de teste", company: "Empresa de teste" });
    return typeof window === "undefined" ? r.html : previewImageOrigin(r.html, window.location.origin);
  }, [value, subject]);

  function insert(text: string, block: boolean) {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length, end = el?.selectionEnd ?? value.length;
    const before = value.slice(0, start), after = value.slice(end);
    const pre = block && before && !before.endsWith("\n") ? "\n" : "";
    const post = block && !after.startsWith("\n") ? "\n" : "";
    const next = before + pre + text + post + after;
    onChange(next);
    const pos = (before + pre + text + post).length;
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(pos, pos); });
  }

  function openDialog(kind: Kind) {
    const el = ref.current;
    const selected = el ? value.slice(el.selectionStart, el.selectionEnd).replace(/\n/g, " ").slice(0, 80) : "";
    setF({ url: "", text: kind === "image" ? "" : selected, link: "", color: DEFAULT_BUTTON_COLOR });
    setErr("");
    setOpen(kind);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setErr("");
    if (!["image/png", "image/jpeg", "image/gif"].includes(file.type)) return setErr("Use uma imagem JPG, PNG ou GIF.");
    if (file.size > EMAIL_IMAGE_MAX_BYTES) return setErr("A imagem precisa ter até 2 MB.");
    setUploading(true);
    try {
      const r = await upload({ data: { data: await toBase64(file) } });
      setF(s => ({ ...s, url: r.url, text: s.text || file.name.replace(/\.[^.]+$/, "") }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha ao enviar a imagem.");
    } finally {
      setUploading(false);
    }
  }

  function confirm() {
    if (open === "image") {
      if (!safeEmailUrl(f.url)) return setErr("Envie uma imagem ou informe um endereço que comece com https://.");
      if (!f.text.trim()) return setErr("Descreva a imagem (aparece quando o e-mail bloqueia imagens).");
      if (f.link && !safeEmailUrl(f.link, true)) return setErr("O link da imagem precisa começar com https://.");
      insert(imageMarkup(f.url.trim(), f.text, f.link.trim()), true);
    } else if (open === "button") {
      if (!f.text.trim()) return setErr("Escreva o texto do botão.");
      if (!safeEmailUrl(f.url, true)) return setErr("O link do botão precisa começar com https://.");
      const color = safeHexColor(f.color);
      if (!color) return setErr("Escolha uma cor válida.");
      insert(buttonMarkup(f.text, f.url.trim(), color), true);
    } else if (open === "link") {
      if (!f.text.trim()) return setErr("Escreva o texto que ficará clicável.");
      if (!safeEmailUrl(f.url, true)) return setErr("O link precisa começar com https://.");
      insert(linkMarkup(f.text, f.url.trim()), false);
    }
    setOpen(null);
  }

  const color = safeHexColor(f.color) ?? DEFAULT_BUTTON_COLOR;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="toolbar" aria-label="Inserir no e-mail">
        <Button type="button" variant="outline" size="sm" onClick={() => openDialog("image")}><ImageIcon className="size-4" />Imagem</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => openDialog("button")}><MousePointerClick className="size-4" />Botão</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => openDialog("link")}><Link2 className="size-4" />Link</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => insert("{{nome}}", false)}>Inserir nome</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => insert("{{empresa}}", false)}>Inserir empresa</Button>
      </div>
      <Textarea ref={ref} aria-label="Mensagem" value={value} onChange={e => onChange(e.target.value)} rows={10} maxLength={10000} className="font-mono text-sm" />
      <p className="text-xs text-muted-foreground">Imagens, botões e links aparecem no texto entre colchetes; a pré-visualização mostra como o cliente vai receber.</p>
      {issues.length > 0 && <ul className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{issues.map((i, n) => <li key={n}>{i.message}</li>)}</ul>}

      <div className="rounded-lg border">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <span className="text-sm font-medium">Pré-visualização</span>
          <div className="flex gap-1" role="group" aria-label="Tamanho da pré-visualização">
            <Button type="button" size="sm" variant={device === "desktop" ? "default" : "ghost"} aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")}><Monitor className="size-4" />Computador</Button>
            <Button type="button" size="sm" variant={device === "mobile" ? "default" : "ghost"} aria-pressed={device === "mobile"} onClick={() => setDevice("mobile")}><Smartphone className="size-4" />Celular</Button>
          </div>
        </div>
        <div className="overflow-x-auto bg-muted/40 p-3">
          <iframe
            title={`Pré-visualização do e-mail (${device === "desktop" ? "computador" : "celular"})`}
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            srcDoc={html}
            className="mx-auto block h-[560px] rounded-md border bg-background transition-[width]"
            style={{ width: device === "desktop" ? 680 : 375, maxWidth: device === "desktop" ? "100%" : undefined }}
          />
        </div>
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">Exemplo com “Nome de teste” e “Empresa de teste”. Para conferir no Gmail ou no Outlook, use “Enviar teste”.</p>
      </div>

      <Dialog open={open !== null} onOpenChange={o => !o && setOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{open === "image" ? "Inserir imagem" : open === "button" ? "Inserir botão" : "Inserir link"}</DialogTitle>
            <DialogDescription>{open === "image" ? "JPG, PNG ou GIF de até 2 MB. A imagem é ajustada à largura do e-mail." : open === "button" ? "O botão aparece igual no Gmail e no Outlook." : "Selecione um trecho antes para usá-lo como texto do link."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {open === "image" && <>
              <div className="space-y-1">
                <Label htmlFor="email-img-file">Enviar do computador</Label>
                <div className="flex items-center gap-2">
                  <Input id="email-img-file" type="file" accept="image/png,image/jpeg,image/gif" disabled={uploading} onChange={e => void onFile(e.target.files?.[0])} />
                  {uploading && <Upload className="size-4 animate-pulse text-muted-foreground" aria-label="Enviando" />}
                </div>
              </div>
              <div className="space-y-1"><Label htmlFor="email-img-url">ou endereço da imagem</Label><Input id="email-img-url" placeholder="https://..." value={f.url} onChange={e => setF({ ...f, url: e.target.value })} /></div>
              {safeEmailUrl(f.url) && <img src={previewImageOrigin(f.url, window.location.origin)} alt="" className="max-h-40 rounded border object-contain" />}
              <div className="space-y-1"><Label htmlFor="email-img-alt">Descrição da imagem</Label><Input id="email-img-alt" maxLength={200} value={f.text} onChange={e => setF({ ...f, text: e.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor="email-img-link">Link ao clicar (opcional)</Label><Input id="email-img-link" placeholder="https://..." value={f.link} onChange={e => setF({ ...f, link: e.target.value })} /></div>
            </>}
            {open !== "image" && <>
              <div className="space-y-1"><Label htmlFor="email-el-text">{open === "button" ? "Texto do botão" : "Texto clicável"}</Label><Input id="email-el-text" maxLength={80} value={f.text} onChange={e => setF({ ...f, text: e.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor="email-el-url">Link de destino</Label><Input id="email-el-url" placeholder="https://..." value={f.url} onChange={e => setF({ ...f, url: e.target.value })} /></div>
            </>}
            {open === "button" && <div className="space-y-2">
              <Label>Cor do botão</Label>
              <div className="flex flex-wrap items-center gap-2">
                {BUTTON_COLOR_PRESETS.map(c => <button key={c} type="button" aria-label={`Cor ${c}`} aria-pressed={color === c} onClick={() => setF({ ...f, color: c })} className="size-8 rounded-full border-2 ring-offset-2 aria-pressed:ring-2 aria-pressed:ring-ring" style={{ backgroundColor: c }} />)}
                <Input type="color" aria-label="Outra cor" value={color} onChange={e => setF({ ...f, color: e.target.value })} className="h-8 w-12 p-1" />
                <Input aria-label="Código da cor" value={f.color} onChange={e => setF({ ...f, color: e.target.value })} className="h-8 w-28 font-mono" maxLength={7} />
              </div>
              <div className="pt-1"><span className="inline-block rounded-md px-7 py-3 text-sm font-bold" style={{ backgroundColor: color, color: buttonTextColor(color) }}>{f.text || "Texto do botão"}</span></div>
            </div>}
            {err && <p className="text-sm text-destructive" role="alert">{err}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(null)}>Cancelar</Button>
            <Button type="button" disabled={uploading} onClick={confirm}>Inserir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
