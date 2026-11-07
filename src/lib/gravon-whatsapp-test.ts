import { phoneKey } from "./phone";

export const AI_REPLY_PREFIX = "🤖 ";

/** WhatsApp "Message yourself" chat: fromMe=true and the remoteJid is the connected number. */
export function isSelfChatMessage(args: {
  fromMe: boolean;
  remoteJid: string;
  ownNumber: string;
}): boolean {
  if (!args.fromMe) return false;
  const own = phoneKey(args.ownNumber);
  return own.length >= 8 && phoneKey(args.remoteJid) === own;
}

/** The self-chat number must match the number the admin explicitly authorized. */
export function isAuthorizedTestPhone(args: {
  remoteJid: string;
  authorizedPhone: string;
}): boolean {
  const authorized = phoneKey(args.authorizedPhone);
  return authorized.length >= 8 && phoneKey(args.remoteJid) === authorized;
}

/** Loop guard: never answer a message sent by the AI itself. */
export function isAiGeneratedBody(body: string): boolean {
  return body.trimStart().startsWith(AI_REPLY_PREFIX);
}

