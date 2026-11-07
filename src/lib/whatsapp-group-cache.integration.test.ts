import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("durable group cache isolates bindings, coalesces sync and preserves the snapshot on failure", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT coalesce(current_setting('test.role',true),'service_role') $$;
    CREATE TABLE portal_admin_channels(company_key text, instance text, canonical_phone text);
    INSERT INTO portal_admin_channels VALUES('crm:1','A','5547999998888'),('other','B','5547999997777');`);
    await db.exec(await readFile("drizzle/migrations/0140_whatsapp_group_snapshot.sql","utf8"));
    const token=crypto.randomUUID(), second=crypto.randomUUID();
    const claim=async(company="crm:1",instance="A",phone="5547999998888",t=token) => (await db.query<{ok:boolean}>("SELECT claim_whatsapp_group_sync($1,$2,$3,$4,true) AS ok",[company,instance,phone,t])).rows[0].ok;
    assert.equal(await claim(),true);
    assert.equal(await claim("crm:1","A","5547999998888",second),false);
    await assert.rejects(claim("other","B","5547999997777"),/forbidden/);
    await assert.rejects(claim("crm:1","B","5547999997777"),/binding_changed/);
    await assert.rejects(claim("crm:1","A","5547999990000"),/binding_changed/);
    const groups=[{jid:"123456@g.us",name:"Clientes",canPost:true}];
    await db.query("SELECT finish_whatsapp_group_sync('crm:1','A','5547999998888',$1,$2,NULL)",[token,JSON.stringify(groups)]);
    const before=await db.query<{groups:unknown,synced_at:Date}>("SELECT groups,synced_at FROM crm_whatsapp_group_snapshots");
    assert.deepEqual(before.rows[0].groups,groups);
    assert.equal(await claim("crm:1","A","5547999998888",second),true);
    await db.query("SELECT finish_whatsapp_group_sync('crm:1','A','5547999998888',$1,'[]','sync_failed')",[second]);
    const after=await db.query<{groups:unknown,synced_at:Date}>("SELECT groups,synced_at FROM crm_whatsapp_group_snapshots");
    assert.deepEqual(after.rows[0],before.rows[0]);
    assert.equal(await claim(),true);
    await db.exec("UPDATE portal_admin_channels SET canonical_phone='5547999990000' WHERE instance='A'");
    await assert.rejects(db.query("SELECT finish_whatsapp_group_sync('crm:1','A','5547999998888',$1,'[]',NULL)",[token]),/binding_changed/);
    await db.exec("SET test.role='authenticated'");
    await assert.rejects(claim(),/forbidden/);
  } finally { await db.close(); }
});