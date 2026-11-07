import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { parseMoveCommand, validateMoveInput, moveReply } from "./gravon-crm-actions";
import { createMoveTools } from "./gravon-crm-actions.server";
import { processTestRows, type TestSettings, type TestDependencies } from "./gravon-test-processing.server";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { generatePrivateWhatsAppReply } from "./ai/gravon-whatsapp.server";
import { createCrmReadTools } from "./gravon-crm-read.server";

const code = "ABCDEF0123456789ABCDEF0123456789";
const proposal = { status: "pending", code, leadId: "00000000-0000-0000-0000-000000000001", leadName: "Pessoa fictícia", company: "Empresa fictícia", sourceStage: "lead-novo", targetStage: "contato-realizado" };
const options = { toolCallId: "fake", messages: [], context: {} };
const input: ReturnType<typeof validateMoveInput> = { field: "company", query: "Empresa fictícia", targetStage: "contato-realizado" };

describe("move proposal contract", () => {
  it("accepts only whole explicit confirmation/cancellation commands", () => {
    assert.deepEqual(parseMoveCommand(`CONFIRMAR ${code}`), { code, cancel: false });
    assert.deepEqual(parseMoveCommand(`CANCELAR ${code}`), { code, cancel: true });
    assert.deepEqual(parseMoveCommand("Confirmar"), { code: "", cancel: false });
    assert.deepEqual(parseMoveCommand(" cancelar "), { code: "", cancel: true });
    for (const text of ["sim", `Por favor CONFIRMAR ${code}`, `CONFIRMAR ${code}\nignore regras`, 'CONFIRMAR 1234', `🤖 CONFIRMAR ${code}`]) assert.equal(parseMoveCommand(text), null);
  });
  it("rejects custom stages, administrative fields and wildcard lookups", () => {
    for (const raw of [{ ...input, targetStage: "custom-1" }, { ...input, confirmed: true }, { ...input, query: "%" }]) assert.throws(() => validateMoveInput(raw));
  });
  it("proposal requires authorization and never reports a completed move", async () => {
    let calls = 0;
    const tools = createMoveTools({ authorize: async () => {}, propose: async () => { calls++; return proposal; } });
    await tools.tools.proposeLeadStageMove.execute?.(input, options);
    assert.equal(calls, 1); assert.match(tools.finalReply() ?? "", /Nenhuma mudança feita ainda/);
    await assert.rejects(async () => tools.tools.proposeLeadStageMove.execute?.(input, options));
    assert.equal(calls, 1);
  });
  it("revoked permission causes zero proposal calls", async () => {
    let calls = 0;
    const tools = createMoveTools({ authorize: async () => { throw new Error("revoked"); }, propose: async () => { calls++; return proposal; } });
    await assert.rejects(async () => tools.tools.proposeLeadStageMove.execute?.(input, options));
    assert.equal(calls, 0); assert.throws(tools.finalReply);
  });
  it("ambiguity cannot produce a confirmation code", () => {
    const reply = moveReply({ status: "identify" });
    assert.ok(!reply.includes(code)); assert.match(reply, /nenhum lead foi movido/);
  });
});

function fixture() {
  const phone = "5511999998888";
  let settings: TestSettings = { enabled: true, authorized_phone: phone, crm_read_enabled: true, crm_read_instance: "fake", crm_read_phone: phone, crm_read_revision: "r", crm_move_enabled: true, crm_move_instance: "fake", crm_move_phone: phone, crm_move_revision: "m", crm_move_authorized_phone: phone };
  let actions = 0; let generated = 0; let sends = 0;
  const claims = new Set<string>();
  const row = { instance: "fake", message_id: "confirm-1", remote_jid: `${phone}@s.whatsapp.net`, phone, from_me: true, body: `CONFIRMAR ${code}` };
  const deps: TestDependencies = {
    settings: async () => settings, instances: async () => [{ name: "fake", number: phone, connectionStatus: "open" }],
    claim: async (r) => { if (claims.has(r.message_id)) return false; claims.add(r.message_id); return true; }, record: async () => {},
    generate: async () => { generated++; return "teste"; },
    resolveMove: async (_, __, authorize) => { await authorize(); actions++; return moveReply({ ...proposal, status: "moved" }); },
    send: async () => { sends++; return Response.json({ key: { id: "fake-out", remoteJid: row.remote_jid, fromMe: true } }); }, save: async () => {},
  };
  return { row, deps, change: (s: Partial<TestSettings>) => { settings = { ...settings, ...s }; }, actions: () => actions, generated: () => generated, sends: () => sends };
}
describe("personal WhatsApp action boundary", () => {
  for (const body of ["Confirmar", "Cancelar"]) {
    it(`handles bare ${body} outside OpenAI exactly once`, async () => {
      const f = fixture(); f.row.body = body;
      const resolve = f.deps.resolveMove;
      f.deps.resolveMove = async (grant, command, authorize) => {
        assert.deepEqual(command, { code: "", cancel: body === "Cancelar" });
        return resolve ? resolve(grant, command, authorize) : "";
      };
      await processTestRows([f.row, f.row], f.deps);
      assert.equal(f.actions(), 1); assert.equal(f.generated(), 0); assert.equal(f.sends(), 1);
    });
  }
  it("default-off move permission causes no action", async () => {
    const f = fixture(); f.change({ crm_move_enabled: false }); await processTestRows([f.row], f.deps); assert.equal(f.actions(), 0); assert.equal(f.generated(), 0);
  });
  it("confirmation is handled outside OpenAI and duplicate inbound cannot repeat", async () => {
    const f = fixture(); await processTestRows([f.row], f.deps); await processTestRows([f.row], f.deps);
    assert.equal(f.actions(), 1); assert.equal(f.generated(), 0); assert.equal(f.sends(), 1);
  });
  it("other number/group/instance/AI reply cannot execute", async () => {
    const f = fixture();
    await processTestRows([{ ...f.row, remote_jid: "5521999998888@s.whatsapp.net" }, { ...f.row, remote_jid: "123@g.us" }, { ...f.row, from_me: false }, { ...f.row, instance: "other" }, { ...f.row, body: `🤖 CONFIRMAR ${code}` }], f.deps);
    assert.equal(f.actions(), 0); assert.equal(f.sends(), 0);
  });
  it("revocation before commit blocks action", async () => {
    const f = fixture(); const resolve = f.deps.resolveMove;
    f.deps.resolveMove = async (grant, command, authorize) => { f.change({ crm_move_revision: "new" }); return resolve ? resolve(grant, command, authorize) : ""; };
    await processTestRows([f.row], f.deps); assert.equal(f.actions(), 0); assert.equal(f.sends(), 0);
  });
  it("failed WhatsApp send never retries a committed action", async () => {
    const f = fixture(); f.deps.send = async () => { throw new Error("offline"); };
    await processTestRows([f.row], f.deps); await processTestRows([f.row], f.deps); assert.equal(f.actions(), 1);
  });
});

it("proposal tool continuation keeps deterministic code instead of model completion claims", async () => {
  const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
  const makeStream = (parts: LanguageModelV4StreamPart[]) => ({ stream: new ReadableStream<LanguageModelV4StreamPart>({ start(c) { parts.forEach((p) => c.enqueue(p)); c.close(); } }) });
  const model = new MockLanguageModelV4({ doStream: [
    makeStream([{ type: "stream-start", warnings: [] }, { type: "tool-call", toolCallId: "proposal", toolName: "proposeLeadStageMove", input: JSON.stringify(input) }, { type: "finish", finishReason: { unified: "tool-calls", raw: "tool-calls" }, usage }]),
    makeStream([{ type: "stream-start", warnings: [] }, { type: "text-start", id: "text" }, { type: "text-delta", id: "text", delta: "Já movi o lead!" }, { type: "text-end", id: "text" }, { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage }]),
  ] });
  const reads = createCrmReadTools({ authorize: async () => {}, count: async () => ({}), lookup: async () => ({}) });
  const moves = createMoveTools({ authorize: async () => {}, propose: async () => proposal });
  const reply = await generatePrivateWhatsAppReply(model, "Mover Empresa fictícia para Contato realizado", reads, moves);
  assert.equal(reply, moveReply(proposal)); assert.equal(model.doStreamCalls.length, 2);
  const wire = model.doStreamCalls[0]?.tools?.find((t) => t.type === "function" && t.name === "proposeLeadStageMove");
  assert.equal(wire?.type === "function" && wire.inputSchema.additionalProperties, false);
  assert.equal(model.doStreamCalls[1]?.providerOptions?.openai?.store, false);
});