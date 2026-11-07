import { test } from "node:test";
import assert from "node:assert/strict";
import { GRAVON_THREADS_KEY, loadOrCreateThreads, parseThreads, threadTitle } from "./gravon-chat-threads";
import { GRAVON_STORAGE_KEY } from "./gravon-ai";

const store = (init: Record<string, string> = {}) => {
  const data = { ...init };
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v; } };
};
const msg = (role: "user" | "assistant", text: string, id = text) => ({ id, role, parts: [{ type: "text" as const, text }] });

test("first visit imports the previous internal conversation once, keeping it intact", () => {
  const legacy = JSON.stringify({ messages: [msg("user", "Quantos leads entraram?"), msg("assistant", "Resposta")] });
  const s = store({ [GRAVON_STORAGE_KEY]: legacy });
  const first = loadOrCreateThreads(s);
  const again = loadOrCreateThreads(s);
  assert.equal(first.length, 1);
  assert.equal(again.length, 1);
  assert.equal(again[0]!.id, first[0]!.id);
  assert.equal(first[0]!.messages.length, 2);
  assert.equal(s.data[GRAVON_STORAGE_KEY], legacy);
});

test("without history a single empty conversation is created", () => {
  const s = store();
  const threads = loadOrCreateThreads(s);
  assert.equal(threads.length, 1);
  assert.equal(threads[0]!.messages.length, 0);
  assert.ok(s.data[GRAVON_THREADS_KEY]);
});

test("titles come from the first question; invalid stored rows are dropped", () => {
  assert.equal(threadTitle([msg("user", "  Qual o   melhor funil?  ")]), "Qual o melhor funil?");
  assert.equal(threadTitle([]), "Nova conversa");
  const parsed = parseThreads(JSON.stringify([{ id: "bad id!", title: "x", updatedAt: 1, messages: [] }, { id: "abcdefgh-1", title: "ok", updatedAt: 2, messages: [msg("user", "oi"), { role: "system" }] }]));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]!.messages.length, 1);
});
