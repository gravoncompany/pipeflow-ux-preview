import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("durable claim accepts one paid request and blocks repeats including failed and expired",async()=>{
 const db=new PGlite();try {
  await db.exec("CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'service_role')$$;");
  await db.exec(await readFile("drizzle/migrations/0059_b2b_hybrid_private_cache.sql","utf8"));
  const key="a".repeat(64);
  const claim=async()=> (await db.query<{ok:boolean}>("SELECT public.claim_b2b_lookup($1,'deskdata') AS ok",[key])).rows[0].ok;
  assert.equal(await claim(),true);assert.equal(await claim(),false);
  await db.query("UPDATE public.b2b_lookup_cache SET state='failed',valid_until=now()-interval '1 day' WHERE query_key=$1",[key]);assert.equal(await claim(),false);
  for(const role of ["anon","authenticated"]){assert.equal((await db.query<{ok:boolean}>("SELECT has_table_privilege($1,'public.b2b_lookup_cache','SELECT,INSERT,UPDATE,DELETE') AS ok",[role])).rows[0].ok,false);assert.equal((await db.query<{ok:boolean}>("SELECT has_function_privilege($1,'public.claim_b2b_lookup(text,text)','EXECUTE') AS ok",[role])).rows[0].ok,false);}
  await db.exec("SET request.jwt.claim.role='authenticated'");await assert.rejects(claim(),/access_denied/);
 }finally{await db.close();}
});