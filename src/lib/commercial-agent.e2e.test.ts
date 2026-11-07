import { test } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { agentDb, configure, inbound, verdict, CRM, OTHER, TESTER } from "./crm-agent-test-db";
import { processCommercialAgent, type AgentDeps } from "./commercial-agent.server";
import type { AgentVerdict } from "./commercial-agent";

/** Routes the orchestrator's service-role RPCs to the migrated PGlite database (named arguments). */
function rpcOf(db: PGlite): AgentDeps["rpc"] {
  return async (name, args) => {
    const keys = Object.keys(args);
    const values = keys.map((k) => (args[k] !== null && typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k]));
    const sql = `SELECT ${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(",")}) AS r`;
    const rows = (await db.query<{ r: unknown }>(sql, values)).rows;
    return name === "crm_agent_pending_sync" ? rows.map((r) => r.r) : rows[0]?.r;
  };
}
let providerSeq = 0;
function harness(db: PGlite, answer: (n: number) => AgentVerdict | Error = () => verdict({ response: "O plano mensal é R$ 297.", knowledgeTitles: ["Plano CRM"] })) {
  const calls = { generate: 0, send: [] as { number: string; text: string }[] };
  const deps: AgentDeps = {
    rpc: rpcOf(db),
    generate: async () => { calls.generate++; const a = answer(calls.generate); if (a instanceof Error) throw a; return a; },
    verifySender: async () => {},
    send: async (_i, number, text) => {
      calls.send.push({ number, text });
      return new Response(JSON.stringify({ key: { id: `EVO-${++providerSeq}`, remoteJid: `${number}@s.whatsapp.net`, fromMe: true } }), { status: 200 });
    },
  };
  return { deps, calls };
}
const one = async (db: PGlite, sql: string, args: unknown[] = []) => (await db.query<any>(sql, args)).rows[0];
async function referenceToCrm(db: PGlite) {
  await db.query("SELECT save_crm_reference_message(NULL,NULL,0,'Quero conhecer o CRM da Gravon','contains','meta_ads',$1,'crm-novo',true)", [CRM]);
}
async function webhook(db: PGlite, deps: AgentDeps, body: string, phone = TESTER, over: Record<string, unknown> = {}) {
  const id = await inbound(db, phone, body, over);
  await db.query("SELECT capture_crm_reference_message('gravon',$1)", [id]);
  const out = await processCommercialAgent(deps, "gravon", [{ message_id: id, from_me: Boolean(over.from_me) }]);
  return { id, out };
}

test("campaign message → card in CRM funnel → agent answers from Commercial Knowledge → Conversations + stage", async () => {
  const db = await agentDb();
  try {
    await referenceToCrm(db);
    await configure(db, CRM);
    const { deps, calls } = harness(db);
    const { out } = await webhook(db, deps, "Oi! Quero conhecer o CRM da Gravon, quanto custa?");
    assert.deepEqual(out, ["completed"]);
    assert.deepEqual(calls.send, [{ number: TESTER, text: "O plano mensal é R$ 297." }]);
    const lead = await one(db, "SELECT stage,tags,source,pipeline_id FROM leads");
    assert.deepEqual(lead, { stage: "crm-atendimento", tags: ["meta-ads"], source: "Meta Ads", pipeline_id: CRM });
    const reply = await one(db, "SELECT body,from_me,message_source,send_state FROM whatsapp_messages WHERE message_source='commercial_agent'");
    assert.deepEqual(reply, { body: "O plano mensal é R$ 297.", from_me: true, message_source: "commercial_agent", send_state: "accepted" });
    // Replayed webhook: nothing is analysed or sent twice.
    const replay = await processCommercialAgent(deps, "gravon", [{ message_id: (await one(db, "SELECT inbound_id FROM crm_agent_runs")).inbound_id, from_me: false }]);
    assert.deepEqual(replay, []);
    assert.equal(calls.send.length, 1);
    // Next client message with clear intent qualifies the card with literal evidence.
    const { deps: d2 } = harness(db, () => verdict({ response: "Perfeito! Posso te explicar a implantação?", intencaoComercial: true, evidenciaIntencao: "quero contratar para minha empresa" }));
    await webhook(db, d2, "Gostei, quero contratar para minha empresa");
    assert.equal((await one(db, "SELECT stage FROM leads")).stage, "crm-qualificado");
  } finally { await db.close(); }
});

test("agent off, other funnel or unauthorized number: no AI call and no message", async () => {
  const db = await agentDb();
  try {
    await referenceToCrm(db);
    const { deps, calls } = harness(db);
    await webhook(db, deps, "Quero conhecer o CRM da Gravon");
    await configure(db, OTHER, { allowedStages: ["out-novo"], stageMap: {} });
    await webhook(db, deps, "Quero conhecer o CRM da Gravon");
    await configure(db, CRM);
    await webhook(db, deps, "Quero conhecer o CRM da Gravon", "5551999997777");
    assert.equal(calls.generate, 0);
    assert.equal(calls.send.length, 0);
    assert.equal((await one(db, "SELECT count(*)::int n FROM leads WHERE pipeline_id=$1", [CRM])).n, 2);
  } finally { await db.close(); }
});

test("handoff, ungrounded answers and AI outages transfer to a person without sending", async () => {
  const db = await agentDb();
  try {
    await referenceToCrm(db);
    await configure(db, CRM);
    let h = harness(db);
    await webhook(db, h.deps, "Quero conhecer o CRM da Gravon, posso falar com um atendente?");
    assert.equal(h.calls.generate, 0);
    assert.equal((await one(db, "SELECT status FROM crm_agent_runs")).status, "human");
    await db.query("SELECT release_crm_agent_hold(crm_phone_key($1),NULL)", [TESTER]);
    h = harness(db, () => verdict({ response: "Custa só R$ 99!", knowledgeTitles: ["Plano CRM"] }));
    await webhook(db, h.deps, "Qual o preço?");
    assert.equal(h.calls.send.length, 0);
    assert.match((await one(db, "SELECT reason FROM crm_agent_runs ORDER BY created_at DESC LIMIT 1")).reason, /numérica/);
    await db.query("SELECT release_crm_agent_hold(crm_phone_key($1),NULL)", [TESTER]);
    h = harness(db, () => Object.assign(new Error("payment required"), { statusCode: 402 }));
    await webhook(db, h.deps, "Olá?");
    assert.equal(h.calls.send.length, 0);
    assert.match((await one(db, "SELECT blocked_reason FROM crm_agent_settings")).blocked_reason, /402/);
    await db.query("SELECT release_crm_agent_hold(crm_phone_key($1),NULL)", [TESTER]);
    await webhook(db, h.deps, "Alguém aí?");
    assert.equal(h.calls.generate, 1); // Blocked agent stays quiet until an admin saves the settings again.
  } finally { await db.close(); }
});

test("uncertain send is never retried and pauses the contact", async () => {
  const db = await agentDb();
  try {
    await referenceToCrm(db);
    await configure(db, CRM);
    const h = harness(db);
    h.deps.send = async () => { throw new Error("timeout"); };
    const first = await webhook(db, h.deps, "Quero conhecer o CRM da Gravon");
    assert.deepEqual(first.out, ["unknown"]);
    const second = await webhook(db, h.deps, "Ainda está aí?");
    assert.deepEqual(second.out, []);
    assert.equal(h.calls.generate, 1);
    assert.equal((await one(db, "SELECT active FROM crm_agent_holds")).active, true);
  } finally { await db.close(); }
});

test("a reply waiting on the AI is dropped when the client sends a newer message; the newest is answered", async () => {
  const db = await agentDb();
  try {
    await referenceToCrm(db);
    await configure(db, CRM);
    let newerId = "";
    const h = harness(db, (n) => verdict({ response: n === 1 ? "Resposta antiga" : "Resposta nova" }));
    const generate = h.deps.generate;
    h.deps.generate = async (input, max) => {
      if (h.calls.generate === 0) { newerId = await inbound(db, TESTER, "Na verdade, quero saber da implantação"); await db.query("SELECT claim_crm_agent('gravon',$1)", [newerId]); }
      return generate(input, max);
    };
    await webhook(db, h.deps, "Quero conhecer o CRM da Gravon");
    assert.deepEqual(h.calls.send.map((s) => s.text), ["Resposta nova"]);
    const runs = (await db.query<any>("SELECT inbound_id,status FROM crm_agent_runs ORDER BY created_at")).rows;
    assert.equal(runs[0].status, "skipped");
    assert.deepEqual([runs[1].inbound_id, runs[1].status], [newerId, "completed"]);
  } finally { await db.close(); }
});
