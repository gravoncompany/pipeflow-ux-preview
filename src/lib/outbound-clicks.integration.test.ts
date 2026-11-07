import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
test('clique aponta para um único card, mantém históricos posteriores, deduplica redirecionamento e exclui scanner/HEAD', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'service_role') $$;
    CREATE FUNCTION gen_random_bytes(integer) RETURNS bytea LANGUAGE sql AS $$ SELECT decode(repeat('ab',$1),'hex') $$;
    CREATE TABLE leads(id uuid PRIMARY KEY, pipeline_id uuid, stage text, tags jsonb DEFAULT '[]',history jsonb DEFAULT '[]');
    CREATE TABLE sales_pipelines(id uuid PRIMARY KEY,name text,archived boolean);
    CREATE TABLE crm_email_flow_messages(id uuid PRIMARY KEY, lead_id uuid, enrollment_id uuid, direction text,kind text,state text,subject text);
    CREATE TABLE crm_automation_runs(id uuid PRIMARY KEY,enrollment_id uuid,automation_id uuid,clicks integer DEFAULT 0,last_click_at timestamptz,updated_at timestamptz);
    CREATE TABLE crm_automation_events(automation_id uuid,run_id uuid,lead_id uuid,kind text,detail text);`);
    await db.exec(await readFile('drizzle/migrations/0145_outbound_email_click_tracking.sql','utf8'));
    await db.exec(await readFile('drizzle/migrations/0146_preserve_outbound_click_audit.sql','utf8'));
    const p='00000000-0000-4000-8000-000000000001', a='00000000-0000-4000-8000-000000000002', b='00000000-0000-4000-8000-000000000003', m='00000000-0000-4000-8000-000000000004';
    await db.query("INSERT INTO sales_pipelines VALUES($1,'Outbound',false)",[p]);
    await db.query("INSERT INTO leads(id,pipeline_id,stage) VALUES($1,$3,'lead-novo'),($2,$3,'qualificacao')",[a,b,p]);
    await db.query("INSERT INTO crm_email_flow_messages VALUES($1,$2,NULL,'out','sequence','reserved','E-mail 1')",[m,a]);
    const token=(await db.query<{t:string}>("SELECT register_outbound_email_link($1,'https://example.com/') t",[m])).rows[0].t;
    const click=async (kind:string, fp='1'.repeat(64),record=true) => (await db.query<{u:string|null}>('SELECT record_outbound_email_click($1,$2,$3,$4) u',[token,kind,fp,record])).rows[0].u;
    assert.equal(await click('human'),null,'não conta antes do aceite');
    await db.query("UPDATE crm_email_flow_messages SET state='accepted' WHERE id=$1",[m]);
    await click('automated'); await click('unknown'); await click('human','2'.repeat(64),false);
    assert.deepEqual((await db.query<{tags:string[]}>('SELECT tags FROM leads WHERE id=$1',[a])).rows[0].tags,[]);
    assert.equal(await click('human'),'https://example.com/'); await click('human');
    await click('human','3'.repeat(64));
    const rows=(await db.query<{id:string;stage:string;tags:string[];history:unknown[]}>('SELECT * FROM leads ORDER BY id')).rows;
    assert.deepEqual(rows[0].tags,['clicou-no-link']); assert.equal(rows[0].history.length,2); assert.equal(rows[0].stage,'lead-novo');
    assert.deepEqual(rows[1].tags,[]); assert.equal(rows.length,2,'nunca cria card');
    await assert.rejects(db.query("UPDATE leads SET history='[]' WHERE id=$1",[a]),/stale_outbound_click_history/);
    await db.exec("SET request.jwt.claim.role='anon'"); await assert.rejects(click('human'),/access_denied/);
  } finally { await db.close(); }
});