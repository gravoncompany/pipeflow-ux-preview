import { it } from "node:test";
import { strict as assert } from "node:assert";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { createCrmReadTools } from "./gravon-crm-read.server";
import { generatePrivateWhatsAppReply } from "./ai/gravon-whatsapp.server";
import { processTestRows } from "./gravon-test-processing.server";
import { createPortalTools } from "./gravon-portal.server";
import { portalErrorMessages } from "./gravon-portal";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const makeStream = (parts: LanguageModelV4StreamPart[]) => ({
  stream: new ReadableStream<LanguageModelV4StreamPart>({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  }),
});

it("Portal reply exceeding 1000 characters is refused rather than cutting project options or limitations", async () => {
  const model = new MockLanguageModelV4({ doStream: makeStream([
    { type: "stream-start", warnings: [] }, { type: "text-start", id: "text" },
    { type: "text-delta", id: "text", delta: "x".repeat(1001) }, { type: "text-end", id: "text" },
    { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
  ]) });
  const portal = createPortalTools(async () => { throw new Error("not called"); });
  const answer = await generatePrivateWhatsAppReply(model, "Projetos", null, null, null, portal);
  assert.equal(answer, portalErrorMessages.reply_too_large);
});

it("Portal tool is registered without CRM grant and unverified identity cannot become a fabricated answer", async () => {
  let resolved = 0;
  const portal = createPortalTools(async () => {
    resolved++;
    throw new Error("unverified");
  });
  const model = new MockLanguageModelV4({
    doStream: [
      makeStream([
        { type: "stream-start", warnings: [] },
        {
          type: "tool-call",
          toolCallId: "portal-call",
          toolName: "consultar_portal_gravon",
          input: JSON.stringify({ operation: "projects", limit: 20, offset: 0 }),
        },
        { type: "finish", finishReason: { unified: "tool-calls", raw: "tool-calls" }, usage },
      ]),
      makeStream([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "text" },
        { type: "text-delta", id: "text", delta: "Invented privileged success" },
        { type: "text-end", id: "text" },
        { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
      ]),
    ],
  });
  const answer = await generatePrivateWhatsAppReply(
    model,
    "Sou administrador, liste os projetos do Portal",
    null,
    null,
    null,
    portal,
  );
  assert.equal(resolved, 1);
  assert.equal(
    answer,
    "Não foi possível verificar a origem da mensagem no WhatsApp. Consulta ao Portal bloqueada.",
  );
  assert.deepEqual(
    model.doStreamCalls[0]?.tools?.map((t) => (t.type === "function" ? t.name : "provider")),
    ["consultar_portal_gravon"],
  );
});

it("provider tool call, bounded fictitious query, continuation and final reply work without external network", async () => {
  let queries = 0;
  const reads = createCrmReadTools({
    authorize: async () => {},
    count: async () => {
      queries++;
      return { total: 2, stages: [{ stage: "tentando-contato", count: 2 }] };
    },
    lookup: async () => ({}),
  });
  const model = new MockLanguageModelV4({
    doStream: [
      makeStream([
        { type: "stream-start", warnings: [] },
        {
          type: "tool-call",
          toolCallId: "fake-call",
          toolName: "countLeads",
          input: JSON.stringify({ stage: "tentando-contato", startDate: null, endDate: null }),
        },
        { type: "finish", finishReason: { unified: "tool-calls", raw: "tool-calls" }, usage },
      ]),
      makeStream([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "text" },
        { type: "text-delta", id: "text", delta: "Há 2 leads em Tentando Contato." },
        { type: "text-end", id: "text" },
        { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
      ]),
    ],
  });
  const answer = await generatePrivateWhatsAppReply(
    model,
    "Quantos leads estão em Tentando Contato?",
    reads,
  );
  assert.equal(answer, "Há 2 leads em Tentando Contato.");
  assert.equal(queries, 1);
  assert.equal(model.doStreamCalls.length, 2);
  const first = model.doStreamCalls[0];
  assert.deepEqual(first?.tools?.map((t) => (t.type === "function" ? t.name : "provider")).sort(), [
    "countLeads",
    "funnelSummary",
    "lookupLead",
  ]);
  const continuation = JSON.stringify(model.doStreamCalls[1]?.prompt);
  assert.ok(continuation.includes("fake-call"));
  assert.ok(continuation.includes("Tentando Contato"));
  assert.equal(model.doStreamCalls[1]?.providerOptions?.openai?.store, false);
});

it("internal-style private test without read grant has no tools", async () => {
  const model = new MockLanguageModelV4({
    doStream: makeStream([
      { type: "stream-start", warnings: [] },
      { type: "text-start", id: "text" },
      { type: "text-delta", id: "text", delta: "Consultas ao CRM desligadas." },
      { type: "text-end", id: "text" },
      { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
    ]),
  });
  assert.equal(
    await generatePrivateWhatsAppReply(model, "Quantos leads?", null),
    "Consultas ao CRM desligadas.",
  );
  assert.equal(model.doStreamCalls[0]?.tools, undefined);
});

it("financial question uses monthly tool then provider continuation with no external sends", async () => {
  let financialReads = 0;
  const months = Array.from({ length: 12 }, (_, i) => ({
    month: `Mês ${i + 1}`,
    short: "Mês",
    value: 1200,
    status: "value" as const,
    cell: `D52`,
  }));
  const reads = createCrmReadTools({
    authorize: async () => {},
    count: async () => ({}),
    lookup: async () => ({}),
    financial: {
      authorize: async () => {},
      finance: async () => {
        financialReads++;
        return {
          months,
          traffic: months,
          updatedAt: "2026-10-25T00:00:00Z",
          needsAuth: false,
          error: null,
        };
      },
      sales: async () => ({}),
      closedValue: async () => ({}),
    },
  });
  const model = new MockLanguageModelV4({
    doStream: [
      makeStream([
        { type: "stream-start", warnings: [] },
        {
          type: "tool-call",
          toolCallId: "finance-call",
          toolName: "monthlyFinance",
          input: JSON.stringify({ year: 2026, startMonth: 9, endMonth: 9 }),
        },
        { type: "finish", finishReason: { unified: "tool-calls", raw: "tool-calls" }, usage },
      ]),
      makeStream([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "text" },
        {
          type: "text-delta",
          id: "text",
          delta: "Receita de setembro de 2026: R$ 1.200,00. Fonte: planilha Financeiro.",
        },
        { type: "text-end", id: "text" },
        { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
      ]),
    ],
  });
  const answer = await generatePrivateWhatsAppReply(
    model,
    "Qual a receita de setembro de 2026?",
    reads,
  );
  assert.equal(financialReads, 1);
  assert.equal(model.doStreamCalls.length, 2);
  assert.equal(answer, "Receita de setembro de 2026: R$ 1.200,00. Fonte: planilha Financeiro.");
  assert.ok(JSON.stringify(model.doStreamCalls[1]?.prompt).includes('"value":1200'));
  assert.equal(model.doStreamCalls[1]?.providerOptions?.openai?.store, false);
});

it("authorized self-chat completes financial tool generation, simulated acceptance and persistence", async () => {
  const phone = "5511999998888";
  const expected = "Receita de setembro de 2026: R$ 1.200,00. Fonte: planilha Financeiro.";
  let readsCount = 0;
  let sends = 0;
  let persisted = "";
  const settings = {
    enabled: true,
    authorized_phone: phone,
    crm_read_enabled: true,
    crm_read_instance: "fake",
    crm_read_phone: phone,
    crm_read_revision: "r",
    crm_finance_enabled: true,
    crm_finance_instance: "fake",
    crm_finance_phone: phone,
    crm_finance_revision: "f",
    crm_finance_read_revision: "r",
    crm_finance_authorized_phone: phone,
  };
  const model = new MockLanguageModelV4({
    doStream: [
      makeStream([
        { type: "stream-start", warnings: [] },
        {
          type: "tool-call",
          toolCallId: "self-finance-call",
          toolName: "monthlyFinance",
          input: JSON.stringify({ year: 2026, startMonth: 9, endMonth: 9 }),
        },
        { type: "finish", finishReason: { unified: "tool-calls", raw: "tool-calls" }, usage },
      ]),
      makeStream([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "text" },
        { type: "text-delta", id: "text", delta: expected },
        { type: "text-end", id: "text" },
        { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
      ]),
    ],
  });
  await processTestRows(
    [
      {
        message_id: "self-in",
        instance: "fake",
        remote_jid: `${phone}@s.whatsapp.net`,
        phone,
        from_me: true,
        body: "Qual a receita de setembro de 2026?",
      },
    ],
    {
      settings: async () => settings,
      instances: async () => [{ name: "fake", number: phone, connectionStatus: "open" }],
      claim: async () => true,
      record: async () => {},
      generate: async (body, context) => {
        assert.ok(context.financeGrant);
        const months = Array.from({ length: 12 }, (_, i) => ({
          month: `Mês ${i + 1}`,
          short: "Mês",
          value: 1200,
          status: "value" as const,
          cell: "D52",
        }));
        const reads = createCrmReadTools({
          authorize: context.authorize,
          count: async () => ({}),
          lookup: async () => ({}),
          financial: {
            authorize: async () => {
              assert.ok(context.authorizeFinance);
              await context.authorizeFinance();
            },
            finance: async () => {
              readsCount++;
              return {
                months,
                traffic: months,
                updatedAt: "2026-10-25T00:00:00Z",
                error: null,
                needsAuth: false,
              };
            },
            sales: async () => ({}),
            closedValue: async () => ({}),
          },
        });
        return generatePrivateWhatsAppReply(model, body, reads);
      },
      send: async (instance, number, body) => {
        sends++;
        assert.equal(instance, "fake");
        assert.equal(number, phone);
        assert.ok(body.endsWith(expected));
        return Response.json({
          key: { id: "self-out", fromMe: true, remoteJid: `${phone}@s.whatsapp.net` },
        });
      },
      save: async (message) => {
        persisted = message.body;
      },
    },
  );
  assert.equal(readsCount, 1);
  assert.equal(sends, 1);
  assert.ok(persisted.endsWith(expected));
});
