import { z } from "zod";
import { GRAVON_STORAGE_KEY, testMessageSchema } from "./gravon-ai";

/** Browser-local history of Gravon AI chat conversations (same storage model as the internal chat). */
export const GRAVON_THREADS_KEY = "gravon-ai-chat-threads-v1";
export const MAX_THREADS = 50;

const threadSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{8,64}$/),
  title: z.string().max(80),
  updatedAt: z.number(),
  messages: z.array(z.unknown()).max(400),
});
export type GravonThread = {
  id: string;
  title: string;
  updatedAt: number;
  messages: z.infer<typeof testMessageSchema>[];
};

export const NEW_THREAD_TITLE = "Nova conversa";

export function newThread(now = Date.now(), id: string = crypto.randomUUID()): GravonThread {
  return { id, title: NEW_THREAD_TITLE, updatedAt: now, messages: [] };
}

/** Title from the first user message, trimmed to a short line. */
export function threadTitle(messages: GravonThread["messages"]) {
  const first = messages.find((m) => m.role === "user")?.parts.find((p) => p.type === "text")?.text;
  const clean = first?.replace(/\s+/g, " ").trim();
  if (!clean) return NEW_THREAD_TITLE;
  return clean.length > 60 ? `${clean.slice(0, 57)}…` : clean;
}

export function parseThreads(raw: string | null): GravonThread[] {
  try {
    const value = JSON.parse(raw || "[]");
    if (!Array.isArray(value)) return [];
    const out: GravonThread[] = [];
    for (const item of value) {
      const t = threadSchema.safeParse(item);
      if (!t.success) continue;
      const messages = t.data.messages.flatMap((m) => {
        const r = testMessageSchema.safeParse(m);
        return r.success ? [r.data] : [];
      });
      out.push({ ...t.data, messages });
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_THREADS);
  } catch {
    return [];
  }
}

/**
 * Idempotent bootstrap: returns stored threads; when none exist, imports the
 * previous single internal conversation (kept untouched) or creates one empty thread,
 * and writes the result immediately so repeated runs never add duplicates.
 */
export function loadOrCreateThreads(storage: Pick<Storage, "getItem" | "setItem">, now = Date.now()) {
  const threads = parseThreads(storage.getItem(GRAVON_THREADS_KEY));
  if (threads.length) return threads;
  let legacy: GravonThread["messages"] = [];
  try {
    const stored = JSON.parse(storage.getItem(GRAVON_STORAGE_KEY) || "null");
    for (const m of Array.isArray(stored?.messages) ? stored.messages : []) {
      const r = testMessageSchema.safeParse(m);
      if (r.success) legacy.push(r.data);
    }
  } catch {
    legacy = [];
  }
  const first = newThread(now);
  if (legacy.length) Object.assign(first, { messages: legacy, title: threadTitle(legacy) });
  const created = [first];
  storage.setItem(GRAVON_THREADS_KEY, JSON.stringify(created));
  return created;
}

export function saveThreads(storage: Pick<Storage, "setItem">, threads: GravonThread[]) {
  storage.setItem(GRAVON_THREADS_KEY, JSON.stringify(threads.slice(0, MAX_THREADS)));
}
