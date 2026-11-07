import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { signCrmSession, verifyCrmSession } from "./crm-session-token";
import { assertCrmAdmin, assertCrmLeadWrite, crmLeadInput, zapierDestination } from "./crm-leads-access";
import { TEAM_STAGE_IDS } from "./crm-permissions";

const secret = "isolated-test-key-not-a-production-credential";
const token = async (level: string, expiry = 2000) => `${level}:${expiry}:${await signCrmSession(`${level}:${expiry}`, secret)}`;

test("signed full and limited sessions preserve the existing signature format", async () => {
  assert.equal(await verifyCrmSession(await token("full"), secret, 1000), "full");
  assert.equal(await verifyCrmSession(await token("limited"), secret, 1000), "limited");
});
test("no cookie, expired cookie, tampered level, unknown level and wrong signer cannot authorize", async () => {
  assert.equal(await verifyCrmSession(undefined, secret, 1000), null);
  assert.equal(await verifyCrmSession(await token("full", 1000), secret, 1000), null);
  assert.equal(await verifyCrmSession((await token("limited")).replace("limited", "full"), secret, 1000), null);
  assert.equal(await verifyCrmSession(await token("admin"), secret, 1000), null);
  assert.equal(await verifyCrmSession(await token("full"), "wrong-signer", 1000), null);
});
test("limited writes allow exactly the five approved stages", () => {
  assert.deepEqual([...TEAM_STAGE_IDS], ["tentando-contato", "contato-realizado", "primeira-ligacao", "segunda-ligacao", "terceira-ligacao"]);
  for (const stage of TEAM_STAGE_IDS) assert.doesNotThrow(() => assertCrmLeadWrite("limited", null, { stage }));
  for (const stage of ["lead-novo", "fechado", "perda", "custom-new-stage"]) assert.throws(() => assertCrmLeadWrite("limited", null, { stage }));
});
test("limited cannot edit a hidden source or move into a forbidden destination", () => {
  assert.throws(() => assertCrmLeadWrite("limited", { stage: "lead-novo", pipeline_id: null }, { stage: "tentando-contato" }));
  assert.throws(() => assertCrmLeadWrite("limited", { stage: "tentando-contato", pipeline_id: null }, { stage: "fechado" }));
});
test("limited cannot access extra pipelines; full retains pipeline editing", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  assert.throws(() => assertCrmLeadWrite("limited", { stage: "tentando-contato", pipeline_id: id }, { stage: "contato-realizado" }));
  assert.throws(() => assertCrmLeadWrite("limited", null, { stage: "tentando-contato", pipelineId: id }));
  assert.doesNotThrow(() => assertCrmLeadWrite("full", { stage: "lead-novo", pipeline_id: null }, { stage: "fechado", pipelineId: id }));
});
test("deletion and settings reject anonymous and limited sessions", () => {
  assert.throws(() => assertCrmAdmin(null));
  assert.throws(() => assertCrmAdmin("limited"));
  assert.doesNotThrow(() => assertCrmAdmin("full"));
});
test("outbound URLs reject private networks, credentials, other hosts and cleartext", () => {
  assert.equal(zapierDestination.safeParse("https://hooks.zapier.com/hooks/catch/123/isolated/").success, true);
  assert.equal(zapierDestination.safeParse("").success, true);
  for (const url of ["http://hooks.zapier.com/hooks/catch/123/x", "https://127.0.0.1/hooks/catch/x", "https://hooks.zapier.com.attacker.invalid/hooks/catch/x", "https://user:pass@hooks.zapier.com/hooks/catch/x", "https://hooks.zapier.com:8443/hooks/catch/x"]) assert.equal(zapierDestination.safeParse(url).success, false);
});
test("lead inputs cannot inject consent evidence, privileges or service fields", () => {
  assert.equal(crmLeadInput.safeParse({ id: crypto.randomUUID(), first_contact_consent_at: "2026-10-28", role: "admin" }).success, false);
});
test("applied RLS cutover denies all browser CRUD while service operations preserve records (isolated database only)", async () => {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE public.leads(id uuid PRIMARY KEY, stage text);
    CREATE TABLE public.crm_settings(id integer PRIMARY KEY, zapier_webhook_url text);
    GRANT ALL ON public.leads,public.crm_settings TO anon,authenticated,service_role;
    ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY; ALTER TABLE public.crm_settings ENABLE ROW LEVEL SECURITY;
    CREATE POLICY leads_public_select ON public.leads FOR SELECT USING(true);
    CREATE POLICY leads_public_insert ON public.leads FOR INSERT WITH CHECK(true);
    CREATE POLICY leads_public_update ON public.leads FOR UPDATE USING(true) WITH CHECK(true);
    CREATE POLICY leads_public_delete ON public.leads FOR DELETE USING(true);
    CREATE POLICY crm_settings_public_select ON public.crm_settings FOR SELECT USING(true);
    CREATE POLICY crm_settings_public_insert ON public.crm_settings FOR INSERT WITH CHECK(true);
    CREATE POLICY crm_settings_public_update ON public.crm_settings FOR UPDATE USING(true) WITH CHECK(true);
    INSERT INTO public.leads VALUES('00000000-0000-4000-8000-000000000001','lead-novo');
    INSERT INTO public.crm_settings VALUES(1,'https://hooks.zapier.com/hooks/catch/isolated/');`);
  await db.exec(await readFile("drizzle/migrations/0052_secure_crm_leads_and_settings_boundary.sql", "utf8"));
  for (const role of ["anon", "authenticated"]) {
    for (const table of ["leads", "crm_settings"]) for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      const result = await db.query<{ allowed: boolean }>("SELECT has_table_privilege($1,$2,$3) AS allowed", [role, `public.${table}`, privilege]);
      assert.equal(result.rows[0]?.allowed, false);
    }
    await db.exec(`SET ROLE ${role}`);
    for (const sql of ["SELECT * FROM leads", "DELETE FROM leads", "UPDATE leads SET stage='fechado'", "INSERT INTO leads VALUES(gen_random_uuid(),'lead-novo')", "SELECT * FROM crm_settings", "UPDATE crm_settings SET zapier_webhook_url='tampered'", "INSERT INTO crm_settings VALUES(2,'tampered')", "DELETE FROM crm_settings"]) await assert.rejects(db.exec(sql), /permission denied/);
    await db.exec("RESET ROLE");
  }
  await db.exec("SET ROLE service_role; UPDATE leads SET stage='tentando-contato';");
  const rows = await db.query<{ stage: string }>("SELECT stage FROM leads");
  assert.equal(rows.rows.length, 1); assert.equal(rows.rows[0]?.stage, "tentando-contato");
  const policies = await db.query("SELECT * FROM pg_policies WHERE schemaname='public'");
  assert.equal(policies.rows.length, 0);
  await db.close();
});