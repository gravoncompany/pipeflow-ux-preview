import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { referenceDb, CRM } from "./crm-agent-test-db";

const M0083 = "drizzle/migrations/0083_crm_reference_messages.sql";
const M0084 = "drizzle/migrations/0084_crm_commercial_agent.sql";

test("0083/0084 can be re-applied safely: no duplicates, existing data untouched, every agent off", async () => {
  const db = await referenceDb(); // 0083 already applied once (partial state: 0084 missing)
  try {
    await db.exec(`INSERT INTO leads(id,name,whatsapp,stage,pipeline_id,tags,history) VALUES('00000000-0000-4000-8000-00000000aa01','Cliente real','5551988887777','lead-novo',NULL,'["quente"]','[{"id":"h"}]'),
        ('00000000-0000-4000-8000-00000000aa02','Cliente CRM','5551977776666','crm-novo','${CRM}','[]','[]');
      INSERT INTO whatsapp_messages(message_id,instance,phone,phone_key,remote_jid,from_me,body) VALUES('REAL-1','gravon','5551988887777','5188887777','5551988887777@s.whatsapp.net',false,'Oi');
      INSERT INTO ai_knowledge(company_key,entry_type,title,text) VALUES('crm:1','manual','Plano','R$ 297');`);
    const snapshot = async () => JSON.stringify((await db.query("SELECT (SELECT jsonb_agg(l ORDER BY id) FROM leads l) leads, (SELECT jsonb_agg(jsonb_build_object('id',m.message_id,'body',m.body,'from_me',m.from_me) ORDER BY message_id) FROM whatsapp_messages m) msgs, (SELECT count(*) FROM ai_knowledge) kb")).rows[0]);
    const before = await snapshot();
    const sql83 = await readFile(M0083, "utf8"), sql84 = await readFile(M0084, "utf8");
    for (let i = 0; i < 2; i++) { await db.exec(sql83); await db.exec(sql84); }
    assert.equal(await snapshot(), before);
    const state = (await db.query<any>(`SELECT
      (SELECT count(*)::int FROM crm_agent_settings) settings, (SELECT count(*)::int FROM crm_agent_settings WHERE enabled) enabled,
      (SELECT count(*)::int FROM crm_reference_messages) refs, (SELECT count(*)::int FROM crm_agent_runs) runs,
      (SELECT count(*)::int FROM pg_trigger WHERE tgname='crm_agent_audit_append_only') triggers,
      (SELECT count(*)::int FROM pg_indexes WHERE indexname IN ('crm_reference_messages_unique','crm_agent_settings_pipeline','crm_agent_runs_contact')) indexes,
      (SELECT count(*)::int FROM information_schema.columns WHERE table_name='whatsapp_messages' AND column_name='agent_run_id') columns,
      (SELECT count(*)::int FROM whatsapp_messages WHERE agent_run_id IS NOT NULL) bound`)).rows[0];
    assert.deepEqual(state, { settings: 0, enabled: 0, refs: 0, runs: 0, triggers: 1, indexes: 3, columns: 1, bound: 0 });
    // With nothing configured, inbound messages are ignored: no card, no run, no reply.
    assert.equal((await db.query<any>("SELECT capture_crm_reference_message('gravon','REAL-1') r")).rows[0].r.status, "ignored");
    assert.equal((await db.query<any>("SELECT claim_crm_agent('gravon','REAL-1') r")).rows[0].r.reason, "no_agent");
    assert.equal(await snapshot(), before);
  } finally { await db.close(); }
});
