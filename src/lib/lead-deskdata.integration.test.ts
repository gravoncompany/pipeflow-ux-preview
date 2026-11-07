import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("private lead DeskData persists original pending handle and isolates history without overwriting leads", async () => {
 const db = new PGlite();
 try {
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role'::text $$; CREATE TABLE public.leads(id uuid PRIMARY KEY, name text);");
  await db.exec(await readFile("drizzle/migrations/0059_b2b_hybrid_private_cache.sql", "utf8"));
  await db.exec(await readFile("drizzle/migrations/0062_lead_deskdata_enrichment.sql", "utf8"));
  const lead = "00000000-0000-4000-8000-000000000001", key = "a".repeat(64);
  await db.query("INSERT INTO leads VALUES($1,'Nome confirmado')", [lead]);
  await db.query("INSERT INTO lead_deskdata_bindings(lead_id,cnpj) VALUES($1,'50621449000145')", [lead]);
  await db.query("SELECT claim_b2b_lookup($1,'deskdata')", [key]);
  await db.query("UPDATE b2b_lookup_cache SET desk_query_code='Q-ABCDEF0123',desk_pending=true WHERE query_key=$1", [key]);
  await db.query("INSERT INTO lead_deskdata_history(lead_id,cnpj,query_key,datasets,estimated_credits,status) VALUES($1,'50621449000145',$2,'[\"basic\"]',1,'pending')", [lead,key]);
  assert.equal((await db.query<{ok:boolean}>("SELECT claim_b2b_lookup($1,'deskdata') AS ok",[key])).rows[0].ok, false);
  assert.equal((await db.query<{desk_query_code:string}>("SELECT desk_query_code FROM b2b_lookup_cache")).rows[0].desk_query_code, "Q-ABCDEF0123");
  for (const table of ["lead_deskdata_bindings","lead_deskdata_history"]) for (const role of ["anon","authenticated"]) assert.equal((await db.query<{ok:boolean}>("SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') AS ok",[role,`public.${table}`])).rows[0].ok, false);
  await db.query("UPDATE lead_deskdata_history SET status='success',profile='{\"legalName\":\"Empresa retornada\"}' WHERE lead_id=$1",[lead]);
  assert.equal((await db.query<{name:string}>("SELECT name FROM leads")).rows[0].name,"Nome confirmado");
  assert.equal((await db.query("SELECT * FROM lead_deskdata_history WHERE lead_id='00000000-0000-4000-8000-000000000002'")).rows.length,0);
 } finally { await db.close(); }
});