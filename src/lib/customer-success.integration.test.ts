import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const a = "00000000-0000-4000-8000-000000000001";
const b = "00000000-0000-4000-8000-000000000002";
const event = "00000000-0000-4000-8000-000000000003";
const evaluationEvent = "00000000-0000-4000-8000-000000000004";
async function setup() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT coalesce(current_setting('test.role',true),'service_role') $$;
    CREATE TABLE public.crm_clients(id uuid PRIMARY KEY,trade_name text); INSERT INTO public.crm_clients VALUES('${a}','Cliente A'),('${b}','Cliente B');
    CREATE TABLE public.crm_agent_settings(enabled boolean); INSERT INTO public.crm_agent_settings VALUES(false);
    CREATE TABLE public.whatsapp_messages(id uuid PRIMARY KEY,body text);`);
  await db.exec(await readFile("drizzle/migrations/0118_customer_success.sql", "utf8"));
  return db;
}
test("stage and health independent, audited, optimistic and idempotent; no messages or automation change", async () => {
  const db = await setup();
  try {
    const sql = "select update_crm_customer_success($1,0,$2,'Gestor','onboarding','em_risco','Reclamação revisada') as state";
    const saved = await db.query<{ state: { stage: string; health: string; revision: number } }>(sql, [a, event]);
    assert.equal(saved.rows[0].state.stage, "onboarding"); assert.equal(saved.rows[0].state.health, "em_risco");
    await db.query(sql, [a, event]);
    assert.equal((await db.query("select * from crm_cs_history")).rows.length, 1);
    await assert.rejects(db.query(sql, [a, evaluationEvent]), /cs_changed/);
    await db.query("select update_crm_customer_success($1,1,$2,'Gestor','renovacao')", [a, evaluationEvent]);
    const s = await db.query<{ health: string }>("select health from crm_customer_success where client_id=$1", [a]);
    assert.equal(s.rows[0].health, "em_risco");
    assert.equal((await db.query<{ enabled: boolean }>("select enabled from crm_agent_settings")).rows[0].enabled, false);
    assert.equal((await db.query("select * from whatsapp_messages")).rows.length, 0);
    assert.equal((await db.query("select * from crm_clients")).rows.length, 2);
  } finally { await db.close(); }
});
test("AI diagnosis is suggestion only, cannot cross clients or replace stale manual review", async () => {
  const db = await setup();
  try {
    const claim = await db.query<{ id: string }>("select (claim_crm_cs_analysis($1,$2)).id", [a, event]);
    const id = claim.rows[0].id;
    assert.equal((await db.query("select * from crm_customer_success")).rows.length, 0);
    await assert.rejects(db.query("select claim_crm_cs_analysis($1,$2)", [a, evaluationEvent]), /analysis_in_progress/);
    await db.query("update crm_cs_evaluations set status='completed',diagnosis=$1 where id=$2", [{ health: "em_risco" }, id]);
    await assert.rejects(db.query("select update_crm_customer_success($1,0,$2,'Gestor',null,'em_risco','Revisada',null,$3)", [b, evaluationEvent, id]), /evaluation_changed/);
    await db.query("select update_crm_customer_success($1,0,$2,'Gestor',null,'atencao','Ajuste manual')", [a, evaluationEvent]);
    await assert.rejects(db.query("select update_crm_customer_success($1,1,$2,'Gestor',null,'em_risco','Revisada',null,$3)", [a, b, id]), /evaluation_changed/);
  } finally { await db.close(); }
});
test("limited database callers cannot claim analyses or mutate health", async () => {
  const db = await setup();
  try {
    await db.exec("SET test.role='authenticated'");
    await assert.rejects(db.query("select claim_crm_cs_analysis($1,$2)", [a, event]), /forbidden/);
    await assert.rejects(db.query("select update_crm_customer_success($1,0,$2,'Gestor','encerrado')", [a, event]), /forbidden/);
    const grants = await db.query<{ can_read: boolean }>("select has_table_privilege('authenticated','public.crm_cs_evaluations','SELECT') can_read");
    assert.equal(grants.rows[0].can_read, false);
  } finally { await db.close(); }
});