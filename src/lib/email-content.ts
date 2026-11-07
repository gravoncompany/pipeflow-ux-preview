// Conteúdo rico do e-mail marketing (browser-safe, sem dependências).
// O corpo continua sendo texto simples salvo no rascunho, com três marcadores legíveis:
//   linha própria  [imagem: https://... | texto alternativo | https://link-opcional]
//   linha própria  [botão: Texto do botão | https://destino | #1d4ed8]
//   no meio do texto [link: texto clicável | https://destino]
// O HTML gerado usa tabelas e estilos inline (Gmail) e botão VML (Outlook para Windows).

export const EMAIL_IMAGE_ROUTE = "/api/public/email-images/";
/** Endereço público fixo onde as imagens enviadas ficam acessíveis aos provedores de e-mail. */
export const EMAIL_PUBLIC_ORIGIN = "https://crm.gravoncompany.com";
export const MAX_EMAIL_IMAGES = 10;
export const MAX_EMAIL_BUTTONS = 6;
export const DEFAULT_BUTTON_COLOR = "#1d4ed8";
export const BUTTON_COLOR_PRESETS = ["#1d4ed8", "#0f172a", "#0ea5e9", "#16a34a", "#dc2626", "#f59e0b"];

const CONTENT_WIDTH = 536; // 600px de largura total menos 32px de margem de cada lado
const FONT = "Arial,Helvetica,sans-serif";

export type InlinePart = { kind: "text"; text: string } | { kind: "link"; text: string; url: string };
export type EmailBlock =
  | { kind: "text"; parts: InlinePart[] }
  | { kind: "image"; url: string; alt: string; link: string }
  | { kind: "button"; label: string; url: string; color: string };
export type MarkupIssue = { code: string; message: string };

const IMAGE_LINE = /^\s*\[imagem:([^\]]*)\]\s*$/i;
const BUTTON_LINE = /^\s*\[bot(?:ã|a)o:([^\]]*)\]\s*$/i;
const INLINE_LINK = /\[link:([^\]]*)\]/gi;
const ANY_TOKEN = /\[(imagem|bot(?:ã|a)o|link):/gi;

function splitArgs(raw: string) {
  return raw.split("|").map(s => s.trim());
}

/** Só https (e mailto: em links/botões); nunca javascript:, data:, http: ou endereços com espaço. */
export function safeEmailUrl(raw: string, allowMailto = false): string | null {
  const value = raw.trim();
  if (!value || /\s/.test(value) || value.length > 2000) return null;
  if (allowMailto && /^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function safeHexColor(raw: string): string | null {
  const v = raw.trim();
  return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : /^#[0-9a-f]{3}$/i.test(v) ? `#${[...v.slice(1)].map(c => c + c).join("")}`.toLowerCase() : null;
}

/** Cor do texto do botão com contraste suficiente sobre a cor escolhida. */
export function buttonTextColor(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.4 ? "#111827" : "#ffffff";
}

function parseInline(line: string, issues: MarkupIssue[]): InlinePart[] {
  const parts: InlinePart[] = [];
  let last = 0;
  for (const m of line.matchAll(INLINE_LINK)) {
    const [text, url] = splitArgs(m[1]);
    const safe = safeEmailUrl(url ?? "", true);
    if (m.index > last) parts.push({ kind: "text", text: line.slice(last, m.index) });
    if (!text || !safe) {
      issues.push({ code: "link_invalid", message: `Link inválido: "${m[0].slice(0, 80)}". Use [link: texto | https://endereço].` });
      parts.push({ kind: "text", text: m[0] });
    } else parts.push({ kind: "link", text, url: safe });
    last = m.index + m[0].length;
  }
  if (last < line.length) parts.push({ kind: "text", text: line.slice(last) });
  return parts;
}

export function parseEmailBody(body: string): { blocks: EmailBlock[]; issues: MarkupIssue[] } {
  const issues: MarkupIssue[] = [];
  const blocks: EmailBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (!paragraph.length) return;
    const text = paragraph.join("\n").replace(/^\n+|\n+$/g, "");
    if (text) blocks.push({ kind: "text", parts: parseInline(text, issues) });
    paragraph = [];
  };
  for (const line of body.replace(/\r\n?/g, "\n").split("\n")) {
    const img = line.match(IMAGE_LINE);
    const btn = !img && line.match(BUTTON_LINE);
    if (img) {
      flush();
      const [url, alt = "", link = ""] = splitArgs(img[1]);
      const safe = safeEmailUrl(url ?? "");
      const safeLink = link ? safeEmailUrl(link, true) : "";
      if (!safe) issues.push({ code: "image_invalid", message: "Imagem com endereço inválido. Use um endereço https:// ou envie a imagem pelo botão Imagem." });
      else if (safeLink === null) issues.push({ code: "image_link_invalid", message: "O link da imagem precisa começar com https://." });
      else blocks.push({ kind: "image", url: safe, alt: alt.slice(0, 200), link: safeLink });
      continue;
    }
    if (btn) {
      flush();
      const [label = "", url = "", color = ""] = splitArgs(btn[1]);
      const safe = safeEmailUrl(url, true);
      const hex = color ? safeHexColor(color) : DEFAULT_BUTTON_COLOR;
      if (!label || label.length > 80) issues.push({ code: "button_label", message: "Botão sem texto (ou com mais de 80 caracteres)." });
      else if (!safe) issues.push({ code: "button_url", message: `O botão "${label.slice(0, 40)}" precisa de um link https://.` });
      else if (!hex) issues.push({ code: "button_color", message: `Cor inválida no botão "${label.slice(0, 40)}". Use o formato #1d4ed8.` });
      else blocks.push({ kind: "button", label, url: safe, color: hex });
      continue;
    }
    if (!line.trim()) { flush(); paragraph.push(""); flush(); continue; }
    paragraph.push(line);
  }
  flush();
  // Marcadores de imagem/botão fora de linha própria ou mal fechados.
  const stray = body.replace(/\r\n?/g, "\n").split("\n").filter(l => !IMAGE_LINE.test(l) && !BUTTON_LINE.test(l)).join("\n").replace(INLINE_LINK, "");
  for (const m of stray.matchAll(ANY_TOKEN)) {
    issues.push({ code: "markup_misplaced", message: m[1].toLowerCase() === "link" ? "Link mal formado: feche com ] e use [link: texto | https://endereço]." : `Coloque cada [${m[1].toLowerCase()}: …] sozinho em uma linha e feche com ].` });
    break;
  }
  const images = blocks.filter(b => b.kind === "image").length, buttons = blocks.filter(b => b.kind === "button").length;
  if (images > MAX_EMAIL_IMAGES) issues.push({ code: "too_many_images", message: `Use no máximo ${MAX_EMAIL_IMAGES} imagens por e-mail.` });
  if (buttons > MAX_EMAIL_BUTTONS) issues.push({ code: "too_many_buttons", message: `Use no máximo ${MAX_EMAIL_BUTTONS} botões por e-mail.` });
  return { blocks, issues };
}

function esc(text: string) {
  return text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

type Personalize = (text: string) => string;

function inlineHtml(parts: InlinePart[], p: Personalize) {
  return parts.map(part => part.kind === "text"
    ? esc(p(part.text)).replace(/\n/g, "<br>")
    : `<a href="${esc(part.url)}" target="_blank" style="color:#1d4ed8;text-decoration:underline">${esc(p(part.text))}</a>`).join("");
}

function buttonHtml(b: Extract<EmailBlock, { kind: "button" }>, p: Personalize) {
  const label = esc(p(b.label)), url = esc(b.url), fg = buttonTextColor(b.color);
  const width = Math.min(CONTENT_WIDTH, Math.max(160, Math.round(p(b.label).length * 9 + 56)));
  return `<tr><td class="px" align="center" style="padding:16px 32px">`
    + `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:46px;v-text-anchor:middle;width:${width}px" arcsize="14%" stroke="f" fillcolor="${b.color}"><w:anchorlock/><center style="color:${fg};font-family:${FONT};font-size:15px;font-weight:bold">${label}</center></v:roundrect><![endif]-->`
    + `<!--[if !mso]><!--><a href="${url}" target="_blank" style="background-color:${b.color};border-radius:6px;color:${fg};display:inline-block;font-family:${FONT};font-size:15px;font-weight:bold;line-height:46px;text-align:center;text-decoration:none;padding:0 28px;mso-hide:all;-webkit-text-size-adjust:none">${label}</a><!--<![endif]-->`
    + `</td></tr>`;
}

function imageHtml(b: Extract<EmailBlock, { kind: "image" }>, p: Personalize) {
  const img = `<img src="${esc(b.url)}" width="${CONTENT_WIDTH}" alt="${esc(p(b.alt))}" style="display:block;width:100%;max-width:${CONTENT_WIDTH}px;height:auto;border:0;outline:none;text-decoration:none">`;
  return `<tr><td class="px" align="center" style="padding:12px 32px">${b.link ? `<a href="${esc(b.link)}" target="_blank">${img}</a>` : img}</td></tr>`;
}

/** HTML compatível com Gmail e Outlook: tabela de 600px, estilos inline, adaptação ao celular. */
export function emailHtml(body: string, footer: string, p: Personalize = t => t, title = "") {
  const { blocks } = parseEmailBody(body);
  const rows = blocks.map(b => b.kind === "text"
    ? `<tr><td class="px" style="padding:8px 32px;font-family:${FONT};font-size:15px;line-height:24px;color:#1f2937">${inlineHtml(b.parts, p)}</td></tr>`
    : b.kind === "image" ? imageHtml(b, p) : buttonHtml(b, p)).join("");
  return `<!doctype html><html lang="pt-BR" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="X-UA-Compatible" content="IE=edge"><meta name="x-apple-disable-message-reformatting"><title>${esc(title)}</title>`
    + `<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->`
    + `<style>@media only screen and (max-width:620px){.container{width:100%!important}.px{padding-left:16px!important;padding-right:16px!important}}</style></head>`
    + `<body style="margin:0;padding:0;background-color:#f3f4f6;-webkit-text-size-adjust:100%">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f3f4f6" style="background-color:#f3f4f6"><tr><td align="center" style="padding:24px 8px">`
    + `<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->`
    + `<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:600px;background-color:#ffffff;border-radius:8px">`
    + `<tr><td style="height:16px;line-height:16px;font-size:0">&nbsp;</td></tr>${rows}`
    + `<tr><td class="px" style="padding:16px 32px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #e5e7eb;padding-top:16px;font-family:${FONT};font-size:12px;line-height:18px;color:#6b7280">${esc(footer)}</td></tr></table></td></tr>`
    + `</table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`;
}

/** Versão em texto puro (exigida por filtros de spam e leitores sem HTML). */
export function emailPlainText(body: string, p: Personalize = t => t) {
  const { blocks } = parseEmailBody(body);
  return blocks.map(b => b.kind === "text"
    ? b.parts.map(x => x.kind === "text" ? p(x.text) : `${p(x.text)} (${x.url})`).join("")
    : b.kind === "image" ? (b.alt ? `[${p(b.alt)}]` : "") + (b.link ? ` ${b.link}` : "")
    : `${p(b.label)}: ${b.url}`).filter(Boolean).join("\n\n");
}

/** Na pré-visualização dentro do CRM, imagens enviadas são lidas do endereço atual. */
export function previewImageOrigin(html: string, origin: string) {
  return html.split(EMAIL_PUBLIC_ORIGIN + EMAIL_IMAGE_ROUTE).join(origin + EMAIL_IMAGE_ROUTE);
}

export function imageMarkup(url: string, alt: string, link = "") {
  return `[imagem: ${url} | ${alt.replace(/[|\]\n]/g, " ").trim()}${link ? ` | ${link}` : ""}]`;
}
export function buttonMarkup(label: string, url: string, color: string) {
  return `[botão: ${label.replace(/[|\]\n]/g, " ").trim()} | ${url} | ${color}]`;
}
export function linkMarkup(text: string, url: string) {
  return `[link: ${text.replace(/[|\]\n]/g, " ").trim()} | ${url}]`;
}
