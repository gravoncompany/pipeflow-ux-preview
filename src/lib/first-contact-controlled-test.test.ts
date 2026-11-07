import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { firstContactTestSchema, FIRST_CONTACT_TEST_PHONE } from "./first-contact";

test("controlled test permits only the explicitly authorized Brazilian number and consent", () => {
  const input = { phone: "5551999986839", firstName: "Maria", consent: true, instance: "isolated" };
  assert.equal(FIRST_CONTACT_TEST_PHONE, "5551999986839");
  assert.equal(firstContactTestSchema.safeParse(input).success, true);
  assert.equal(firstContactTestSchema.safeParse({ ...input, phone: "5551999986838" }).success, false);
  assert.equal(firstContactTestSchema.safeParse({ ...input, consent: false }).success, false);
  assert.equal(firstContactTestSchema.safeParse({ ...input, firstName: "" }).success, false);
});

test("one-shot controlled test claims, permissions, persistence recovery and no general activation", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE first_contact_settings(company_key text,enabled boolean,runtime_ready boolean);
      INSERT INTO first_contact_settings VALUES('crm:1',false,false);
      CREATE TABLE first_contact_sequences(id uuid,state text);
      CREATE TABLE portal_admin_channels(user_id uuid,company_key text,instance text,canonical_phone text);
      CREATE FUNCTION commercial_knowledge_access(uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT $1='00000000-0000-4000-8000-000000000001'::uuid AND $2='crm:1' $$;
      CREATE FUNCTION first_contact_number(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN length($1)=13 AND substring($1,5,1)='9' THEN substring($1,1,4)||substring($1,6) ELSE $1 END $$;
      CREATE TABLE whatsapp_messages(message_id text PRIMARY KEY,instance text,phone text,remote_jid text,phone_key text,from_me boolean,body text,sent_at timestamptz,send_state text,accepted_at timestamptz,delivered_at timestamptz,read_at timestamptz);
      CREATE FUNCTION reconcile_analysis_delivery(text,text) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;`);
    await db.exec(await readFile("drizzle/migrations/0046_first_contact_controlled_test.sql", "utf8"));
    await db.exec(await readFile("drizzle/migrations/0047_first_contact_test_company_default.sql", "utf8"));
    const author = "00000000-0000-4000-8000-000000000001";
    await db.query("INSERT INTO portal_admin_channels VALUES($1,'crm:1','isolated','5511988887777')", [author]);
    const claim = (phone = FIRST_CONTACT_TEST_PHONE, actor = author, instance = "isolated") => db.query<{ value: { id: string; claimed: boolean } }>("SELECT claim_first_contact_test($1,$2,'5511988887777',$3,'Maria') AS value", [actor,instance,phone]);
    await assert.rejects(claim("5551999986838"), /controlled_test_not_authorized/);
    await assert.rejects(claim(FIRST_CONTACT_TEST_PHONE, "00000000-0000-4000-8000-000000000002"), /controlled_test_not_authorized/);
    await assert.rejects(claim(FIRST_CONTACT_TEST_PHONE, author, "other-instance"), /controlled_test_not_authorized/);
    await db.exec("UPDATE first_contact_settings SET enabled=true");
    await assert.rejects(claim(), /controlled_test_not_authorized/);
    await db.exec("UPDATE first_contact_settings SET enabled=false; INSERT INTO first_contact_sequences VALUES(gen_random_uuid(),'pending')");
    await assert.rejects(claim(), /controlled_test_not_authorized/);
    await db.exec("UPDATE first_contact_sequences SET state='cancelled'");
    const simultaneous = await Promise.all([claim(),claim()]);
    assert.equal(simultaneous.filter(r => r.rows[0]?.value.claimed).length, 1);
    const id = simultaneous[0]?.rows[0]?.value.id;
    assert.ok(id);
    assert.equal((await claim()).rows[0]?.value.claimed, false);
    await db.query("UPDATE first_contact_tests SET state='unknown' WHERE id=$1", [id]);
    assert.equal((await claim()).rows[0]?.value.claimed, false);
    assert.equal((await db.query<{ value: boolean }>("SELECT persist_first_contact_test($1) AS value", [id])).rows[0]?.value, false);
    await db.query("UPDATE first_contact_tests SET state='accepted',provider_id='isolated-provider',remote_jid='5551999986839@s.whatsapp.net',accepted_at='2026-10-29T02:16:00Z' WHERE id=$1", [id]);
    for (let i=0;i<2;i++) assert.equal((await db.query<{ value: boolean }>("SELECT persist_first_contact_test($1) AS value", [id])).rows[0]?.value, true);
    const messages = (await db.query<{ body: string; phone: string }>("SELECT body,phone FROM whatsapp_messages")).rows;
    assert.deepEqual(messages, [{ body: "Olá, Maria! Tudo bem?", phone: "5551999986839" }]);
    assert.deepEqual((await db.query("SELECT enabled,runtime_ready FROM first_contact_settings")).rows, [{ enabled:false,runtime_ready:false }]);
    assert.equal((await db.query<{ value: boolean }>("SELECT has_table_privilege('anon','first_contact_tests','SELECT') AS value")).rows[0]?.value, false);
    assert.equal((await db.query<{ value: boolean }>("SELECT has_function_privilege('authenticated','claim_first_contact_test(uuid,text,text,text,text)','EXECUTE') AS value")).rows[0]?.value, false);
  } finally { await db.close(); }
});