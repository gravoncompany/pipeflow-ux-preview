import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { normalizeAcceptedMessage, explicitDeliveryUpdate, chronologicalMessages, selectTestInstance } from "./whatsapp-message-sync";
import { processTestRows, type TestDependencies, type TestRecord, type TestIncoming } from "./gravon-test-processing.server";
import { sameWhatsAppNumber } from "./phone";

const number = "5511999998888";
const jid = `${number}@s.whatsapp.net`;
const incoming: TestIncoming = { message_id: "input-1", instance: "test-only", remote_jid: jid, phone: number, from_me: true, body: "Olá" };
const expected = { instance: "test-only", number, body: "🤖 resposta", acceptedAt: "2026-10-25T02:00:00Z" };
const accepted = { key: { id: "output-1", remoteJid: jid, fromMe: true } };

function fixture() {
  const records: TestRecord[] = [];
  const messages = new Map<string, unknown>();
  const claims = new Set<string>();
  let sends = 0;
  const deps: TestDependencies = {
    settings: async () => ({ enabled: true, authorized_phone: number }),
    instances: async () => [{ name: "wrong", number: "5521888887777", connectionStatus: "open" }, { name: "test-only", number, connectionStatus: "open" }],
    claim: async (row) => { const k = row.instance + row.message_id; if (claims.has(k)) return false; claims.add(k); return true; },
    record: async (r) => { records.push(r); }, generate: async () => "resposta",
    send: async () => { sends++; return Response.json(accepted); },
    save: async (m) => { messages.set(m.messageId, m); },
  };
  return { deps, records, messages, sends: () => sends };
}

describe("Gravon accepted-message contract", () => {
  it("uses Evolution ID and exact destination, without asserting delivery", () => {
    const m = normalizeAcceptedMessage(accepted, expected);
    assert.equal(m?.messageId, "output-1"); assert.equal(m?.instance, "test-only");
    assert.equal(m?.remoteJid, jid); assert.equal(m?.phoneKey, "1199998888");
    assert.equal(m && "deliveredAt" in m, false);
  });
  it("rejects missing ID", () => assert.equal(normalizeAcceptedMessage({ key: { remoteJid: jid, fromMe: true } }, expected), null));
  it("rejects another destination", () => assert.equal(normalizeAcceptedMessage({ key: { id: "x", remoteJid: "551199998887@s.whatsapp.net", fromMe: true } }, expected), null));
  it("accepts the optional Brazilian mobile ninth digit in the provider receipt", () => {
    assert.equal(normalizeAcceptedMessage({ key: { id: "x", remoteJid: "551199998888@s.whatsapp.net", fromMe: true } }, expected)?.messageId, "x");
  });
  it("recognizes ownerJid without the optional ninth digit", () => {
    assert.deepEqual(selectTestInstance([{ name: "test-only", ownerJid: "551199998888@s.whatsapp.net", connectionStatus: "open" }], "test-only", number), { name: "test-only", number: "551199998888" });
  });
  it("rejects disconnected and ambiguous instances", () => {
    const row = { name: "test-only", number, connectionStatus: "open" };
    assert.equal(selectTestInstance([{ ...row, connectionStatus: "close" }], "test-only", number), null);
    assert.equal(selectTestInstance([row, row], "test-only", number), null);
  });
  it("does not confuse countries, area codes, subscribers or arbitrary extra digits", () => {
    for (const other of ["552199998888", "551199998887", "5511899998888", "541199998888", "", "12345678"]) {
      assert.equal(sameWhatsAppNumber(number, other), false, other);
    }
    assert.equal(sameWhatsAppNumber("5511933334444", "551133334444"), false);
    assert.equal(sameWhatsAppNumber(number, "11 99999-8888"), true);
    assert.equal(sameWhatsAppNumber("551199998888", number), true);
  });
  it("rejects group destination", () => assert.equal(normalizeAcceptedMessage({ key: { id: "x", remoteJid: "123@g.us", fromMe: true } }, expected), null));
  it("selects only the event instance and authorized own number", () => {
    assert.equal(selectTestInstance([{ name: "other", number, connectionStatus: "open" }], "test-only", number), null);
  });
  it("only recognizes explicit named delivery, not HTTP/echo/numeric status", () => {
    assert.deepEqual(explicitDeliveryUpdate({ key: accepted.key, update: { status: "DELIVERY_ACK" } }), { messageId: "output-1", remoteJid: jid });
    assert.equal(explicitDeliveryUpdate(accepted), null);
    assert.equal(explicitDeliveryUpdate({ key: accepted.key, update: { status: 3 } }), null);
  });
  it("keeps latest 500 chronological rows from a 501-row history", () => {
    const all = Array.from({ length: 501 }, (_, i) => ({ message_id: `${i}`, sent_at: new Date(i * 1000).toISOString() }));
    const newest = chronologicalMessages([...all].reverse().slice(0, 500));
    assert.equal(newest.length, 500); assert.equal(newest[499]?.message_id, "500");
  });
});

describe("isolated processing with no real network", () => {
  it("accepts both ninth-digit inbound variants and sends only to the connected own number", async () => {
    for (const remoteJid of [jid, "551199998888@s.whatsapp.net"]) {
      const f = fixture();
      f.deps.instances = async () => [{ name: "test-only", ownerJid: "551199998888@s.whatsapp.net", connectionStatus: "open" }];
      f.deps.send = async (instance, destination) => {
        assert.equal(instance, "test-only"); assert.equal(destination, "551199998888");
        return Response.json(accepted);
      };
      await processTestRows([{ ...incoming, remote_jid: remoteJid }], f.deps);
      assert.equal(f.messages.size, 1);
    }
  });
  it("blocks a changed authorized number even when its last eight digits match", async () => {
    const f = fixture(); let reads = 0;
    f.deps.settings = async () => ({ enabled: true, authorized_phone: ++reads === 1 ? number : "5521999998888" });
    await processTestRows([incoming], f.deps); assert.equal(f.sends(), 0);
  });
  it("persists after acceptance before any webhook echo", async () => {
    const f = fixture(); await processTestRows([incoming], f.deps);
    assert.equal(f.sends(), 1); assert.equal(f.messages.size, 1);
    assert.equal(f.records.find((r) => r.status === "accepted")?.outbound_id, "output-1");
    assert.equal(f.records.some((r) => r.status === "delivered"), false);
  });
  it("concurrent duplicate input initiates only one send", async () => {
    const f = fixture(); await Promise.all([processTestRows([incoming], f.deps), processTestRows([incoming], f.deps)]);
    assert.equal(f.sends(), 1); assert.equal(f.messages.size, 1);
  });
  it("provider rejection creates no sent message", async () => {
    const f = fixture(); f.deps.send = async () => new Response("", { status: 500 });
    await processTestRows([incoming], f.deps); assert.equal(f.messages.size, 0); assert.equal(f.records.at(-1)?.status, "error");
  });
  it("no response remains unknown and duplicate does not retry", async () => {
    const f = fixture(); let attempts = 0; f.deps.send = async () => { attempts++; throw new Error("network"); };
    await processTestRows([incoming], f.deps); await processTestRows([incoming], f.deps);
    assert.equal(attempts, 1); assert.equal(f.messages.size, 0); assert.equal(f.records.at(-1)?.status, "unknown");
  });
  it("invalid success body does not invent an ID", async () => {
    const f = fixture(); f.deps.send = async () => Response.json({});
    await processTestRows([incoming], f.deps); assert.equal(f.messages.size, 0); assert.equal(f.records.at(-1)?.status, "unknown");
  });
  it("save failure retains accepted evidence and never resends", async () => {
    const f = fixture(); f.deps.save = async () => { throw new Error("isolated DB unavailable"); };
    await processTestRows([incoming], f.deps); await processTestRows([incoming], f.deps);
    assert.equal(f.sends(), 1); assert.equal(f.records.at(-1)?.status, "sync_error");
    assert.equal(f.records.at(-1)?.outbound_id, "output-1");
  });
  it("claim failure stops before provider send", async () => {
    const f = fixture(); f.deps.claim = async () => { throw new Error("DB unavailable"); };
    await assert.rejects(processTestRows([incoming], f.deps)); assert.equal(f.sends(), 0);
  });
  it("revoked authorization before send is respected", async () => {
    const f = fixture(); let reads = 0; f.deps.settings = async () => ({ enabled: ++reads === 1, authorized_phone: number });
    await processTestRows([incoming], f.deps); assert.equal(f.sends(), 0);
  });
  it("other contact and AI-generated message never send", async () => {
    const f = fixture(); await processTestRows([{ ...incoming, remote_jid: "5521888887777@s.whatsapp.net" }, { ...incoming, body: "🤖 resposta" }], f.deps);
    assert.equal(f.sends(), 0);
  });
  it("continues beyond ten replies without an hourly cap", async () => {
    const f = fixture();
    for (let i = 0; i < 60; i++) await processTestRows([{ ...incoming, message_id: `human-${i}` }], f.deps);
    assert.equal(f.sends(), 60);
    assert.equal(f.records.some((r) => r.status === "skipped"), false);
  });
  it("omits robot prefix and reserves exact sent content before provider call", async () => {
    const f = fixture(); let reserved = "";
    f.deps.generate = async () => "🤖 Resposta comercial";
    f.deps.reserve = async (_row, body) => { reserved = body; return true; };
    f.deps.send = async (_instance, _destination, body) => { assert.equal(body, "Resposta comercial"); assert.equal(reserved, body); return Response.json(accepted); };
    await processTestRows([incoming], f.deps);
    assert.equal(reserved, "Resposta comercial");
  });
  it("reserved echo before receipt persistence does not trigger another reply", async () => {
    const f = fixture(); f.deps.isOwnEcho = async row => row.message_id === "output-1";
    await processTestRows([{ ...incoming, message_id: "output-1", body: "Resposta sem prefixo" }], f.deps);
    assert.equal(f.sends(), 0);
  });
  it("an ordinary matching human body without a reservation still runs", async () => {
    const f = fixture(); f.deps.isOwnEcho = async () => false;
    await processTestRows([{ ...incoming, body: "Resposta sem prefixo" }], f.deps);
    assert.equal(f.sends(), 1);
  });
});