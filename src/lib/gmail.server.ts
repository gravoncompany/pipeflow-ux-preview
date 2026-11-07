import { gmailText, headerAddress, type GmailMailbox } from "./email-flows";

/** Leitura da caixa do Gmail conectada (somente leitura). Credenciais apenas no servidor. */
const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";
const TIMEOUT_MS = 10000;

export class GmailUnavailable extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function headers() {
  const lovable = process.env.LOVABLE_API_KEY, gmail = process.env.GOOGLE_MAIL_API_KEY;
  if (!lovable || !gmail) throw new GmailUnavailable(0, "Gmail não conectado ao projeto.");
  return { Authorization: `Bearer ${lovable}`, "X-Connection-Api-Key": gmail };
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${GATEWAY_URL}${path}`, { headers: headers(), signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 300);
    console.error("gmail_read_failed", { status: response.status });
    throw new GmailUnavailable(response.status, `Gmail indisponível (HTTP ${response.status})${body.includes("insufficient") ? ": permissão de leitura ausente" : ""}.`);
  }
  return response.json() as Promise<T>;
}

export async function gmailProfile() {
  return get<{ emailAddress: string }>("/users/me/profile");
}

/**
 * Endereço principal e aliases confirmados da caixa conectada. O contato@gravoncompany.com (Titan)
 * aparece aqui como alias "Enviar como" verificado, e o Gmail recebe as mensagens dele.
 */
export async function gmailMailbox(): Promise<GmailMailbox> {
  const profile = await gmailProfile();
  const address = profile.emailAddress.toLowerCase();
  const sendAs = await get<{ sendAs?: { sendAsEmail: string; isPrimary?: boolean; verificationStatus?: string }[] }>("/users/me/settings/sendAs");
  const aliases = (sendAs.sendAs ?? [])
    .filter((s) => !s.isPrimary && s.verificationStatus === "accepted")
    .map((s) => s.sendAsEmail.toLowerCase())
    .filter((a) => a !== address);
  return { address, aliases };
}

export type GmailMessage = {
  id: string; threadId: string; from: string; fromName: string; to: string; subject: string; rfcId: string; inReplyTo: string; references: string;
  listUnsubscribe: string; precedence: string; autoSubmitted: string; unread: boolean; internalDate: number; text: string;
};
/** Compatível com o leitor de respostas dos fluxos. */
export type GmailReply = GmailMessage;

/** IDs das mensagens que casam com a consulta (somente IDs; detalhes só das novas). */
export async function gmailListIds(query: string, max = 25) {
  const list = await get<{ messages?: { id: string; threadId: string }[] }>(`/users/me/messages?maxResults=${max}&q=${encodeURIComponent(query)}`);
  return list.messages ?? [];
}

export async function gmailGetMessage(id: string): Promise<GmailMessage> {
  const m = await get<{ id: string; threadId?: string; labelIds?: string[]; internalDate?: string; payload?: { headers?: { name: string; value: string }[] } & Parameters<typeof gmailText>[0] }>(`/users/me/messages/${encodeURIComponent(id)}?format=full`);
  const h = (name: string) => m.payload?.headers?.find((x) => x.name.toLowerCase() === name)?.value ?? "";
  const rawFrom = h("from");
  const fromName = rawFrom.replace(/<[^>]*>/g, "").replace(/"/g, "").trim();
  return {
    id: m.id, threadId: m.threadId ?? "", from: headerAddress(rawFrom), fromName: fromName.includes("@") ? "" : fromName.slice(0, 200),
    to: [h("to"), h("cc")].filter(Boolean).join(", ").slice(0, 500).toLowerCase(), subject: h("subject").slice(0, 300), rfcId: h("message-id").slice(0, 490),
    inReplyTo: h("in-reply-to").slice(0, 1000), references: h("references").slice(0, 4000), listUnsubscribe: h("list-unsubscribe").slice(0, 200),
    precedence: h("precedence").slice(0, 40), autoSubmitted: h("auto-submitted").slice(0, 40), unread: (m.labelIds ?? []).includes("UNREAD"),
    internalDate: Number(m.internalDate ?? 0), text: gmailText(m.payload).slice(0, 20000),
  };
}

/** Lista mensagens que casam com a consulta e devolve remetente, destinatário, assunto e texto. */
export async function gmailFindReplies(query: string, max = 25): Promise<GmailReply[]> {
  const out: GmailReply[] = [];
  for (const { id } of await gmailListIds(query, max)) out.push(await gmailGetMessage(id));
  return out;
}
