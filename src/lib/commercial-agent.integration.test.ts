import { test } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { agentDb, configure, lead, inbound, CONFIG, CRM, OTHER, SENDER, TESTER } from "./crm-agent-test-db";

const one = async (db: PGlite, sql: string, args: unknown[] = []) => (await db.query<any>(sql, args)).rows[0];
const claim = (db: PGlite, id: string) => one(db, "SELECT claim_crm_agent('gravon',$1) AS r", [id]).then((x) => x.r);
const runOf = (db: PGlite, inboundId: string) => one(db, "SELECT * FROM crm_agent_runs WHERE inbound_id=$1", [inboundId]);

test("settings are per funnel, default off, validated and revisioned", async () => {
  const db = await agentDb();
  try {
    await assert.rejects(configure(db, CRM, { recipients: [] }), /test_numbers_required/);
    await assert.rejects(configure(db, CRM, { recipients: [SENDER] }), /test_numbers_required/);
    await assert.rejects(configure(db, CRM, { allowedStages: ["nao-existe"] }), /unknown_stage/);
    await assert.rejects(configure(db, CRM, { allowedStages: [] }), /incomplete_settings/);
    await assert.rejects(configure(db, CRM, { audience: "all", recipients: [] }), /audience_confirmation_required/);
    const off = await configure(db, CRM, { enabled: false, recipients: [] });
    assert.equal(off.enabled, false);
    const on = await configure(db, CRM);
    assert.equal(on.revision, 2);
    await assert.rejects(db.query("SELECT save_crm_agent_settings(NULL,$1,1,$2)", [CRM, JSON.stringify(CONFIG)]), /settings_changed/);
    const other = await configure(db, OTHER, { enabled: false, allowedStages: ["out-novo"], stageMap: {} });
    assert.equal(other.enabled, false);
    assert.equal((await one(db, "SELECT count(*)::int n FROM crm_agent_settings")).n, 2);
    await db.exec("SET test.role='authenticated'");
    await assert.rejects(configure(db, OTHER), /forbidden/);
  } finally { await db.close(); }
});

test("never answers when the funnel's agent is off, for other funnels, other instances, unauthorized numbers or own messages", async () => {
  const db = await agentDb();
  try {
    await lead(db, TESTER, CRM);
    assert.equal((await claim(db, await inbound(db, TESTER, "Oi"))).reason, "no_agent");
    await configure(db, CRM);
    await lead(db, "5551999992222", OTHER, "out-novo");
    assert.equal((await claim(db, await inbound(db, "5551999992222", "Oi"))).reason, "no_agent");
    assert.equal((await claim(db, await inbound(db, TESTER, "Oi", { instance: "outra" }))).reason, "not_inbound");
    await lead(db, "5551999993333", CRM);
    assert.equal((await claim(db, await inbound(db, "5551999993333", "Oi"))).reason, "not_authorized");
    assert.equal((await claim(db, await inbound(db, TESTER, "Oi", { from_me: true }))).reason, "not_inbound");
    assert.equal((await one(db, "SELECT count(*)::int n FROM crm_agent_runs")).n, 0);
  } finally { await db.close(); }
});

test("claims each inbound once and records why it is skipped", async () => {
  const db = await agentDb();
  try {
    await configure(db, CRM);
    const leadId = await lead(db);
    const id = await inbound(db, TESTER, "Quanto custa o CRM?");
    const first = await claim(db, id);
    assert.equal(first.status, "claimed");
    assert.equal(first.run.lead_id, leadId);
    assert.equal((await claim(db, id)).status, "duplicate");
    // A second message while analysing waits; finishing hands over to the newest only.
    const second = await claim(db, await inbound(db, TESTER, "Alô?"));
    assert.equal(second.status, "queued");
    const media = await claim(db, await inbound(db, TESTER, "[Áudio]", { media_type: "audio" }));
    assert.equal(media.status, "human");
    assert.equal((await one(db, "SELECT active FROM crm_agent_holds")).active, true);
  } finally { await db.close(); }
});

test("respects allowed stages, business hours, human handoff, limits and pauses", async () => {
  const db = await agentDb();
  try {
    await configure(db, CRM);
    const id = await lead(db, TESTER, CRM, "crm-qualificado");
    assert.match((await claim(db, await inbound(db, TESTER, "Oi"))).reason, /Etapa/);
    await db.query("UPDATE leads SET stage='crm-novo' WHERE id=$1", [id]);
    const today = Number((await one(db, "SELECT extract(dow FROM now() AT TIME ZONE 'America/Sao_Paulo')::int d")).d);
    await configure(db, CRM, { businessDays: [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== today) });
    assert.match((await claim(db, await inbound(db, TESTER, "Oi"))).reason, /horário/);
    await configure(db, CRM);
    await inbound(db, TESTER, "Aqui é o vendedor respondendo", { from_me: true });
    assert.match((await claim(db, await inbound(db, TESTER, "Oi de novo"))).reason, /humano/);
    await configure(db, CRM, { pauseOnHumanReply: false, maxRepliesPerContactDay: 1 });
    await db.query("INSERT INTO crm_agent_runs(settings_id,inbound_id,instance,phone,contact_key,settings_revision,status) SELECT id,'old','gravon',$1,crm_phone_key($1),revision,'completed' FROM crm_agent_settings", [TESTER]);
    assert.match((await claim(db, await inbound(db, TESTER, "Mais uma"))).reason, /Limite diário/);
    await configure(db, CRM, { pauseOnHumanReply: false });
    await db.query("SELECT block_crm_agent(id,'Créditos de IA esgotados') FROM crm_agent_settings");
    assert.match((await claim(db, await inbound(db, TESTER, "Ainda aí?"))).reason, /pausado/);
    await db.query("INSERT INTO whatsapp_messages(message_id,instance,phone,phone_key,remote_jid,body,sent_at) VALUES('velha','gravon',$1,crm_phone_key($1),$1||'@s.whatsapp.net','oi',now()-interval '2 hours')", [TESTER]);
    await configure(db, CRM, { pauseOnHumanReply: false });
    assert.match((await claim(db, "velha")).reason, /antiga/);
  } finally { await db.close(); }
});

test("full cycle: analysis, reservation, accepted reply in Conversations and evidenced stage move", async () => {
  const db = await agentDb();
  try {
    await configure(db, CRM, { pauseOnHumanReply: true });
    const leadId = await lead(db);
    const id = await inbound(db, TESTER, "Tenho interesse em contratar o CRM para minha empresa");
    const { run } = await claim(db, id);
    const ctx = (await one(db, "SELECT crm_agent_context($1) AS c", [run.id])).c;
    assert.equal(ctx.knowledge[0].title, "Plano CRM");
    assert.equal(ctx.messages.at(-1).id, id);
    assert.equal(ctx.pipeline.name, "CRM");
    const reply = "Que ótimo! O plano mensal é R$ 297 e a implantação leva 7 dias.";
    const decision = { kind: "move", target: "crm-qualificado", evidence: "Tenho interesse em contratar", side: "cliente", reason: "Intenção clara" };
    assert.equal((await one(db, "SELECT finish_crm_agent_analysis($1,$2,$3,NULL) ok", [run.id, JSON.stringify({ decision }), reply])).ok, true);
    assert.equal((await one(db, "SELECT begin_crm_agent_send($1) ok", [run.id])).ok, true);
    // Sending runs are never claimed or replayed again.
    assert.equal((await one(db, "SELECT begin_crm_agent_send($1) ok", [run.id])).ok, false);
    await db.query("SELECT record_crm_agent_send($1,'PROV-1',now(),NULL)", [run.id]);
    // The provider echo can land before persistence; it is recognised as the agent's own reply.
    await db.query("INSERT INTO whatsapp_messages(message_id,instance,phone,phone_key,remote_jid,from_me,body,sent_at) VALUES('PROV-1','gravon',$1,crm_phone_key($1),$1||'@s.whatsapp.net',true,$2,now())", [TESTER, reply]);
    await db.query("SELECT sync_crm_agent_send($1)", [run.id]);
    const stored = await one(db, "SELECT message_source,agent_run_id FROM whatsapp_messages WHERE message_id='PROV-1'");
    assert.deepEqual(stored, { message_source: "commercial_agent", agent_run_id: run.id });
    assert.equal(await one(db, "SELECT apply_crm_agent_decision($1) r", [run.id]).then((x) => x.r), "moved");
    const moved = await one(db, "SELECT stage,history FROM leads WHERE id=$1", [leadId]);
    assert.equal(moved.stage, "crm-qualificado");
    assert.equal(moved.history.at(-1).kind, "ai_move");
    assert.equal(await one(db, "SELECT apply_crm_agent_decision($1) r", [run.id]).then((x) => x.r), "skipped");
    // The agent's own reply does not count as a human taking over.
    await db.query("UPDATE leads SET stage='crm-novo' WHERE id=$1", [leadId]);
    assert.equal((await claim(db, await inbound(db, TESTER, "Perfeito, como funciona?"))).status, "claimed");
    const events = (await db.query<any>("SELECT event FROM crm_agent_audit WHERE run_id=$1 ORDER BY created_at", [run.id])).rows.map((r) => r.event);
    for (const e of ["received", "analysis", "generated", "send_reserved", "accepted", "crm_recorded", "stage_decision"]) assert.ok(events.includes(e), e);
    await assert.rejects(db.query("DELETE FROM crm_agent_audit"), /append_only/);
  } finally { await db.close(); }
});

test("stage moves need literal evidence, never touch final stages and respect auto-move off", async () => {
  const db = await agentDb();
  try {
    await configure(db, CRM);
    const finish = async (decision: Record<string, unknown>, text = "Oi, quero o CRM") => {
      const id = await inbound(db, TESTER, text);
      await db.query("UPDATE crm_agent_holds SET active=false");
      const r = await claim(db, id);
      await db.query("SELECT finish_crm_agent_analysis($1,$2,'Resposta',NULL)", [r.run.id, JSON.stringify({ decision })]);
      await db.query("SELECT begin_crm_agent_send($1)", [r.run.id]);
      await db.query("SELECT record_crm_agent_send($1,$2,now(),NULL)", [r.run.id, `P-${r.run.id}`]);
      await db.query("SELECT sync_crm_agent_send($1)", [r.run.id]);
      return (await one(db, "SELECT apply_crm_agent_decision($1) r", [r.run.id])).r;
    };
    await lead(db);
    assert.equal(await finish({ kind: "move", target: "crm-qualificado", evidence: "frase inventada", side: "cliente" }), "invalid_evidence");
    assert.equal(await finish({ kind: "move", target: "crm-fechado", evidence: "quero o CRM", side: "cliente" }), "suggested");
    assert.equal(await finish({ kind: "move", target: "nao-existe", evidence: "quero o CRM", side: "cliente" }), "invalid_target");
    await configure(db, CRM, { autoMove: false });
    assert.equal(await finish({ kind: "move", target: "crm-qualificado", evidence: "quero o CRM", side: "cliente" }), "suggested");
    assert.equal((await one(db, "SELECT stage FROM leads")).stage, "crm-novo");
  } finally { await db.close(); }
});

test("send is refused when the card, configuration or conversation changed during analysis", async () => {
  const db = await agentDb();
  try {
    await configure(db, CRM);
    const leadId = await lead(db);
    const start = async () => {
      await db.query("UPDATE crm_agent_holds SET active=false");
      const r = await claim(db, await inbound(db, TESTER, `pergunta ${Math.random()}`));
      await db.query("SELECT finish_crm_agent_analysis($1,'{}',$2,NULL)", [r.run.id, "Resposta segura"]);
      return r.run.id as string;
    };
    let id = await start();
    await db.query("UPDATE leads SET name='Editado' WHERE id=$1", [leadId]);
    assert.equal((await one(db, "SELECT begin_crm_agent_send($1) ok", [id])).ok, false);
    assert.match((await one(db, "SELECT reason FROM crm_agent_runs WHERE id=$1", [id])).reason, /Card/);
    id = await start();
    await configure(db, CRM, { instructions: "Mudou" });
    assert.equal((await one(db, "SELECT begin_crm_agent_send($1) ok", [id])).ok, false);
    id = await start();
    await inbound(db, TESTER, "Vendedor assumiu", { from_me: true });
    assert.equal((await one(db, "SELECT begin_crm_agent_send($1) ok", [id])).ok, false);
    assert.match((await one(db, "SELECT reason FROM crm_agent_runs WHERE id=$1", [id])).reason, /humano/);
  } finally { await db.close(); }
});

test("interrupted analyses and sends are quarantined, never resent, and need human release", async () => {
  const db = await agentDb();
  try {
    await configure(db, CRM);
    await lead(db);
    const r = await claim(db, await inbound(db, TESTER, "Oi"));
    await db.query("SELECT finish_crm_agent_analysis($1,'{}','Olá!',NULL)", [r.run.id]);
    await db.query("SELECT begin_crm_agent_send($1)", [r.run.id]);
    await db.query("UPDATE crm_agent_runs SET updated_at=now()-interval '10 minutes' WHERE id=$1", [r.run.id]);
    assert.equal((await one(db, "SELECT quarantine_crm_agent_runs() n")).n, 1);
    assert.equal((await runOf(db, r.run.inbound_id)).status, "unknown");
    assert.match((await claim(db, await inbound(db, TESTER, "Olá?"))).reason, /humano|confirmação/);
    await db.query("SELECT release_crm_agent_hold(crm_phone_key($1),NULL)", [TESTER]);
    assert.equal((await runOf(db, r.run.inbound_id)).status, "failed");
    assert.equal((await claim(db, await inbound(db, TESTER, "Voltei"))).status, "claimed");
    await db.exec(`SET crm_agent.now='${new Date(Date.now() + 10 * 60000).toISOString()}'`);
    assert.equal((await one(db, "SELECT quarantine_crm_agent_runs() n")).n, 1);
    assert.equal((await one(db, "SELECT active FROM crm_agent_holds")).active, true);
  } finally { await db.close(); }
});

test("a contact with cards in two agent-enabled funnels is ambiguous and not answered", async () => {
  const db = await agentDb();
  try {
    await configure(db, CRM);
    await configure(db, OTHER, { allowedStages: ["out-novo"], stageMap: {} });
    await lead(db, TESTER, CRM);
    await lead(db, TESTER, OTHER, "out-novo");
    assert.equal((await claim(db, await inbound(db, TESTER, "Oi"))).reason, "ambiguous_contact");
  } finally { await db.close(); }
});

test("Regras do Pipeline: move permission is per funnel and independent of reply permission", async () => {
  const db = await agentDb();
  try {
    // Two funnels saved with different rules: one never changes the other.
    const crm = await configure(db, CRM, { allowedStages: ["crm-novo", "crm-atendimento"], moveStages: ["crm-atendimento"] });
    const other = await configure(db, OTHER, { enabled: false, allowedStages: ["out-novo"], stageMap: {}, moveStages: [] });
    assert.deepEqual(crm.move_stages, ["crm-atendimento"]);
    assert.deepEqual(other.move_stages, []);
    assert.deepEqual((await one(db, "SELECT allowed_stages, move_stages FROM crm_agent_settings WHERE pipeline_id=$1", [CRM])), { allowed_stages: ["crm-atendimento", "crm-novo"], move_stages: ["crm-atendimento"] });
    // A save without moveStages (older clients) keeps the stored move rule.
    assert.deepEqual((await configure(db, CRM, { allowedStages: ["crm-novo", "crm-atendimento"] })).move_stages, ["crm-atendimento"]);
    await assert.rejects(configure(db, CRM, { moveStages: ["out-novo"] }), /unknown_stage/);
    const leadId = await lead(db);
    const finish = async (decision: Record<string, unknown>) => {
      await db.query("UPDATE crm_agent_holds SET active=false");
      const r = await claim(db, await inbound(db, TESTER, `Quero o CRM ${Math.random()}`));
      assert.equal(r.status, "claimed"); // reply allowed in crm-novo
      await db.query("SELECT finish_crm_agent_analysis($1,$2,'Resposta',NULL)", [r.run.id, JSON.stringify({ decision })]);
      await db.query("SELECT begin_crm_agent_send($1)", [r.run.id]);
      await db.query("SELECT record_crm_agent_send($1,$2,now(),NULL)", [r.run.id, `P-${r.run.id}`]);
      await db.query("SELECT sync_crm_agent_send($1)", [r.run.id]);
      return (await one(db, "SELECT apply_crm_agent_decision($1) r", [r.run.id])).r;
    };
    // Replying in a stage does not grant moving to a stage outside the move rule.
    assert.equal(await finish({ kind: "move", target: "crm-qualificado", evidence: "Quero o CRM", side: "cliente" }), "not_permitted");
    assert.equal((await one(db, "SELECT stage FROM leads WHERE id=$1", [leadId])).stage, "crm-novo");
    // Moving permission does not grant replying: the card can be moved into crm-qualificado, where the AI may not reply.
    await configure(db, CRM, { allowedStages: ["crm-novo"], moveStages: ["crm-qualificado"] });
    await db.query("UPDATE leads SET stage='crm-qualificado' WHERE id=$1", [leadId]);
    await db.query("UPDATE crm_agent_holds SET active=false");
    assert.notEqual((await claim(db, await inbound(db, TESTER, "Mais uma pergunta"))).status, "claimed");
  } finally { await db.close(); }
});
