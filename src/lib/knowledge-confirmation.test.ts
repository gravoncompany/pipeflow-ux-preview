import { test } from "node:test";
import { strict as assert } from "node:assert";
import type { UIMessageChunk } from "ai";
import { knowledgeConfirmationStream } from "./knowledge-confirmation";

async function confirmation(output?: unknown) {
  const chunks: UIMessageChunk[] = [
    { type: "start" },
    { type: "text-start", id: "model" },
    { type: "text-delta", id: "model", delta: "Salvei sem chamar o banco" },
    { type: "text-end", id: "model" },
    { type: "tool-input-start", toolCallId: "write", toolName: "criar_conhecimento" },
    ...(output === undefined
      ? []
      : [{ type: "tool-output-available" as const, toolCallId: "write", output }]),
    { type: "finish" },
  ];
  const source = new ReadableStream<UIMessageChunk>({
    start(c) {
      for (const chunk of chunks) c.enqueue(chunk);
      c.close();
    },
  });
  const reader = knowledgeConfirmationStream(source).getReader();
  let text = "";
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    if (next.value.type === "text-delta") text += next.value.delta;
  }
  return text;
}
test("failed persistence never confirms the model's premature save claim", async () => {
  assert.match(await confirmation({ ok: false, error: "database denied" }), /^Não confirmei/);
});
test("missing database result cannot confirm persistence", async () => {
  assert.match(await confirmation(), /^Não salvei/);
});
test("only a successful persisted record confirms saving", async () => {
  assert.match(
    await confirmation({ ok: true, record: { id: "persisted", title: "Implantação CRM" } }),
    /^Salvei no Conhecimento comercial: Implantação CRM/,
  );
  assert.match(await confirmation({ ok: true }), /^Não confirmei/);
});
