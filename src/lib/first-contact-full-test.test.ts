import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("full controlled test binds the authorized number, four messages, 10s, one-shot, history and terminal replies", async () => {
  const db = new PGlite();
  const author = "00000000-0000-4000-8000-000000000001";
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE first_contact_settings(company_key text,enabled boolean,runtime_ready boolean);
      INSERT INTO first_contact_settings VALUES('crm:1',false,false);
      CREATE TABLE first_contact_sequences(id uuid,state text);
      CREATE TABLE first_contact_tests(state text);
      CREATE TABLE portal_admin_channels(user_id uuid,company_key text,instance text,canonical_phone text);
      CREATE FUNCTION commercial_knowledge_access(uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT $1='${author}'::uuid AND $2='crm:1' $$;
      CREATE FUNCTION first_contact_number(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN length($1)=13 AND substring($1,5,1)='9' THEN substring($1,1,4)||substring($1,6) ELSE $1 END $$;
      CREATE TABLE whatsapp_messages(message_id text PRIMARY KEY,instance text,phone text,remote_jid text,phone_key text,from_me boolean,body text,sent_at timestamptz,send_state text,accepted_at timestamptz);
      CREATE FUNCTION reconcile_analysis_delivery(text,text) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;`);
    await db.exec(await readFile("drizzle/migrations/0049_first_contact_full_controlled_test.sql", "utf8"));
    await db.exec(await readFile("drizzle/migrations/0050_first_contact_full_test_reply_cancel.sql", "utf8"));
    await db.query("INSERT INTO portal_admin_channels VALUES($1,'crm:1','isolated','5511988887777')", [author]);
    const start = (phone = "5551999986839", who = author) => db.query<{ v: { id: string; claimed: boolean } }>("SELECT start_full_first_contact_test($1,'isolated','5511988887777',$2,'Maria') v", [who, phone]);
    await assert.rejects(start("5551999986838"), /not_authorized/);
    await assert.rejects(start("5551999986839", "00000000-0000-4000-8000-000000000002"), /not_authorized/);
    await db.exec("UPDATE first_contact_settings SET enabled=true");
    await assert.rejects(start(), /not_authorized/);
    await db.exec("UPDATE first_contact_settings SET enabled=false");
    const starts = await Promise.all([start(),start()]);
    assert.equal(starts.filter(s => s.rows[0]?.v.claimed).length, 1);
    const id = starts[0]?.rows[0]?.v.id;
    assert.ok(id);
    const claim = () => db.query<{ v: { step: number; body: string; phone: string } | null }>("SELECT claim_full_first_contact_test_step($1,$2) v", [id, author]);
    for (let step=1;step<=4;step++) {
      if(step>1) await db.query("UPDATE first_contact_full_tests SET due_at=now() WHERE id=$1",[id]);
      const claims = await Promise.all([claim(),claim()]);
      const c = claims.find(c => c.rows[0]?.v)?.rows[0]?.v;
      assert.ok(c);
      assert.equal(c.step,step);
      assert.equal(c.phone,"5551999986839");
      assert.equal(claims.filter(c => c.rows[0]?.v).length,1);
      for (let replay=0;replay<2;replay++) await db.query("SELECT finish_full_first_contact_test_step($1,$2,'accepted',$3,'5551999986839@s.whatsapp.net',now(),'')", [id,step,`provider-${step}`]);
      const timing = (await db.query<{ seconds: number }>("SELECT extract(epoch from due_at-now())::float8 seconds FROM first_contact_full_tests")).rows[0];
      assert.ok(timing && timing.seconds>9 && timing.seconds<=10);
      assert.equal((await claim()).rows[0]?.v,null);
    }
    assert.equal((await db.query<{ state: string; next_step: number }>("SELECT state,next_step FROM first_contact_full_tests")).rows[0]?.state,"completed");
    assert.equal((await db.query("SELECT body FROM whatsapp_messages")).rows.length,4);
    assert.deepEqual((await db.query("SELECT enabled,runtime_ready FROM first_contact_settings")).rows,[{enabled:false,runtime_ready:false}]);
    assert.equal((await start()).rows[0]?.v.claimed,false);
    // A simulated independent test run checks a real inbound record and terminal cancellation.
    await db.query("UPDATE first_contact_full_tests SET state='running',next_step=2,due_at=now(),started_at=now()-interval '1 second' WHERE id=$1",[id]);
    await db.exec("INSERT INTO whatsapp_messages(message_id,instance,phone,from_me,sent_at) VALUES('echo','isolated','5551999986839',true,now())");
    assert.equal((await db.query<{ v: boolean }>("SELECT revalidate_full_first_contact_test($1,$2) v",[id,author])).rows[0]?.v,true);
    await db.exec("INSERT INTO whatsapp_messages(message_id,instance,phone,from_me,sent_at) VALUES('reply','isolated','5551999986839',false,now())");
    assert.equal((await db.query<{ state: string; reason: string }>("SELECT state,reason FROM first_contact_full_tests")).rows[0]?.reason,"lead_replied");
    assert.equal((await db.query<{ v: boolean }>("SELECT revalidate_full_first_contact_test($1,$2) v",[id,author])).rows[0]?.v,false);
    assert.equal((await claim()).rows[0]?.v,null);
    assert.equal((await start()).rows[0]?.v.claimed,false);
    assert.equal((await db.query<{ state: string }>("SELECT state FROM first_contact_full_tests")).rows[0]?.state,"cancelled");
    for(const role of ['anon','authenticated']) {
      assert.equal((await db.query<{ v: boolean }>(`SELECT has_table_privilege('${role}','first_contact_full_tests','SELECT') v`)).rows[0]?.v,false);
      assert.equal((await db.query<{ v: boolean }>(`SELECT has_function_privilege('${role}','claim_full_first_contact_test_step(uuid,uuid)','EXECUTE') v`)).rows[0]?.v,false);
    }
  } finally { await db.close(); }
});