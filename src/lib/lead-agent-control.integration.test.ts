import { test } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { agentDb, configure, lead, inbound, CRM, TESTER } from "./crm-agent-test-db";

const one = async (db: PGlite, sql: string, args: unknown[] = []) => (await db.query<any>(sql, args)).rows[0];
const claim = (db: PGlite, id: string) => one(db, "SELECT claim_crm_agent('gravon',$1) AS r", [id]).then((x) => x.r);
const ACTOR = "a255513a-5e15-4afd-9888-d659670ba500";
const setControl = (db: PGlite, mode: string, hours: number | null, revision: number) =>
  one(db, "SELECT set_crm_agent_contact_control(crm_phone_key($1),$2,$3,$4,$5) AS c", [TESTER, mode, hours, revision, ACTOR]).then((x) => x.c);

test("a lead disabled individually is never answered, even with its funnel agent on", async () => {
  const db = await agentDb();
  try {
    await configure(db, CRM); await lead(db);
    await setControl(db, "disabled", null, 0);
    const r = await claim(db, await inbound(db, TESTER, "Oi"));
    assert.equal(r.status, "skipped");
    assert.match(r.reason, /desativada/);
  } finally { await db.close(); }
});

test("a paused lead is skipped and answers again after reactivation", async () => {
  const db = await agentDb();
  try {
    await configure(db, CRM); await lead(db);
    await setControl(db, "paused", 4, 0);
    assert.match((await claim(db, await inbound(db, TESTER, "Oi"))).reason, /pausada/);
    await setControl(db, "active", null, 1);
    assert.equal((await claim(db, await inbound(db, TESTER, "Oi de novo"))).status, "claimed");
  } finally { await db.close(); }
});

test("pausing a lead during the analysis blocks the send", async () => {
  const db = await agentDb();
  try {
    await configure(db, CRM); await lead(db);
    const r = await claim(db, await inbound(db, TESTER, "Quanto custa?"));
    await db.query("SELECT finish_crm_agent_analysis($1,'{}',$2,NULL)", [r.run.id, "Resposta segura"]);
    await setControl(db, "paused", 1, 0);
    assert.equal((await one(db, "SELECT begin_crm_agent_send($1) ok", [r.run.id])).ok, false);
    assert.match((await one(db, "SELECT reason FROM crm_agent_runs WHERE id=$1", [r.run.id])).reason, /pausada/);
  } finally { await db.close(); }
});

test("stale revisions are rejected and every change is audited", async () => {
  const db = await agentDb();
  try {
    await setControl(db, "disabled", null, 0);
    await assert.rejects(setControl(db, "active", null, 0), /stale_revision/);
    assert.equal(Number((await one(db, "SELECT count(*) n FROM crm_agent_audit WHERE event='contact_control'")).n), 1);
  } finally { await db.close(); }
});
