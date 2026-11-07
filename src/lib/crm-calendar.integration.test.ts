import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const leadId = "00000000-0000-4000-8000-000000000001";
const pipelineId = "00000000-0000-4000-8000-000000000002";
const leadCustom = "00000000-0000-4000-8000-000000000003";
const leadNoStage = "00000000-0000-4000-8000-000000000004";
const pipelineNoStage = "00000000-0000-4000-8000-000000000005";

async function setup() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT coalesce(current_setting('test.role',true),'service_role') $$;
    CREATE TABLE leads(id uuid PRIMARY KEY, pipeline_id uuid, name text, stage text DEFAULT 'lead-novo', history jsonb);
    CREATE TABLE sales_pipelines(id uuid PRIMARY KEY, name text, stages jsonb, archived boolean DEFAULT false);
    INSERT INTO leads VALUES('${leadId}',NULL,'Lead Teste','lead-novo','[]'),('${leadCustom}','${pipelineId}','Lead Funil','lead-novo','[]'),('${leadNoStage}','${pipelineNoStage}','Lead Sem Etapa','lead-novo','[]');
    INSERT INTO sales_pipelines VALUES('${pipelineId}','Funil X','[{"id":"lead-novo","title":"Lead Novo"},{"id":"reuniao-agendada","title":"Reunião Agendada"}]'),('${pipelineNoStage}','Funil Y','[{"id":"lead-novo","title":"Lead Novo"}]');`);
  await db.exec(await readFile("drizzle/migrations/0066_crm_calendar_module.sql", "utf8"));
  return db;
}

const save = (db: PGlite, over: Record<string, unknown> = {}) => {
  const p = { actor: "Gestor", calendar: "comercial@gravon.com", duration: 30, gap: 15, days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00", lunchStart: "13:30", lunchEnd: "14:00", notice: 2, responsible: "Wilian", enabled: true, revision: 0, ...over };
  return db.query("SELECT save_crm_calendar_settings($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)", [p.actor, p.calendar, p.duration, p.gap, p.days, p.start, p.end, p.lunchStart, p.lunchEnd, p.notice, p.responsible, p.enabled, p.revision]);
};
const book = (db: PGlite, start: string, end: string, event = "evt-1", lead = leadId, origin = "manual") =>
  db.query<any>("SELECT book_crm_appointment($1,$2,$3,$4,$5,$6,$7) AS id", ["Gestor", lead, event, "Reunião fictícia", start, end, origin]);

test("starts with the spec defaults: seg–sex 09:00–18:00, almoço 13:30–14:00, 30min, intervalo 15, São Paulo, desativada", async () => {
  const db = await setup();
  try {
    const row = (await db.query<any>("SELECT * FROM crm_calendar_settings WHERE id=1")).rows[0];
    assert.equal(row.calendar_id, "");
    assert.equal(row.duration_minutes, 30);
    assert.equal(row.gap_minutes, 15);
    assert.equal(row.timezone, "America/Sao_Paulo");
    assert.deepEqual(row.business_days, [1, 2, 3, 4, 5]);
    assert.equal(row.min_notice_hours, 2);
    assert.equal(row.enabled, false);
    assert.equal(String(row.day_start).slice(0, 5), "09:00");
    assert.equal(String(row.day_end).slice(0, 5), "18:00");
    assert.equal(String(row.lunch_start).slice(0, 5), "13:30");
    assert.equal(String(row.lunch_end).slice(0, 5), "14:00");
  } finally { await db.close(); }
});

test("saves availability settings and rejects invalid windows, gaps above 20 and invalid lunch", async () => {
  const db = await setup();
  try {
    await save(db);
    const row = (await db.query<any>("SELECT calendar_id,duration_minutes,enabled,responsible FROM crm_calendar_settings")).rows[0];
    assert.deepEqual(row, { calendar_id: "comercial@gravon.com", duration_minutes: 30, enabled: true, responsible: "Wilian" });
    await assert.rejects(save(db, { start: "18:00", end: "09:00" }), /invalid_settings/);
    await assert.rejects(save(db, { days: [7] }), /invalid_settings/);
    await assert.rejects(save(db, { gap: 21 }));
    await assert.rejects(save(db, { lunchStart: "14:00", lunchEnd: "13:30" }), /invalid_settings/);
    await assert.rejects(save(db, { lunchStart: "08:00", lunchEnd: "08:30" }), /invalid_settings/);
    await assert.rejects(save(db, { enabled: true, calendar: "" }), /calendar_required/);
  } finally { await db.close(); }
});

test("enforces optimistic revision on settings", async () => {
  const db = await setup();
  try {
    await save(db);
    await assert.rejects(save(db, { revision: 0 }), /settings_changed/);
    await save(db, { revision: 1, duration: 45 });
    const row = (await db.query<any>("SELECT duration_minutes,revision FROM crm_calendar_settings")).rows[0];
    assert.equal(row.duration_minutes, 45);
    assert.equal(row.revision, 2);
  } finally { await db.close(); }
});

test("books only with an enabled calendar, records history and moves the card to Reunião Agendada", async () => {
  const db = await setup();
  try {
    await assert.rejects(book(db, "2099-01-05T14:00:00Z", "2099-01-05T14:30:00Z"), /calendar_disabled/);
    await save(db);
    const id = (await book(db, "2099-01-05T14:00:00Z", "2099-01-05T14:30:00Z")).rows[0].id;
    assert.ok(id);
    const lead = (await db.query<any>("SELECT stage,history FROM leads WHERE id=$1", [leadId])).rows[0];
    assert.equal(lead.stage, "reuniao-agendada");
    assert.equal(lead.history[0].kind, "appointment_booked");
    assert.equal(lead.history[0].event, "evt-1");
    assert.equal(lead.history[0].origin, "manual");
    assert.equal(lead.history[0].responsible, "Gestor");
    assert.ok(lead.history[0].text.includes("Reunião agendada para 05/01/2099"));
    assert.ok(lead.history[0].text.includes("Reunião Agendada"));
    assert.equal(lead.history[0].id, `appt:${id}:booked`);
  } finally { await db.close(); }
});

test("moves the card in a custom pipeline that has the stage and preserves the stage when it does not", async () => {
  const db = await setup();
  try {
    await save(db);
    await book(db, "2099-01-05T14:00:00Z", "2099-01-05T14:30:00Z", "evt-a", leadCustom);
    assert.equal((await db.query<any>("SELECT stage FROM leads WHERE id=$1", [leadCustom])).rows[0].stage, "reuniao-agendada");
    await book(db, "2099-01-06T14:00:00Z", "2099-01-06T14:30:00Z", "evt-b", leadNoStage);
    const lead = (await db.query<any>("SELECT stage,history FROM leads WHERE id=$1", [leadNoStage])).rows[0];
    assert.equal(lead.stage, "lead-novo");
    assert.ok(lead.history[0].text.includes("não tem a etapa Reunião Agendada"));
  } finally { await db.close(); }
});

test("rejects overlapping appointments, past starts and duplicate event ids", async () => {
  const db = await setup();
  try {
    await save(db);
    await book(db, "2099-01-05T14:00:00Z", "2099-01-05T14:30:00Z");
    await assert.rejects(book(db, "2099-01-05T14:15:00Z", "2099-01-05T14:45:00Z", "evt-2"), /slot_conflict/);
    await assert.rejects(book(db, "2099-01-05T15:00:00Z", "2099-01-05T15:30:00Z", "evt-1"));
    await assert.rejects(book(db, "2020-01-05T14:00:00Z", "2020-01-05T14:30:00Z", "evt-3"), /invalid_appointment/);
    assert.equal((await db.query("SELECT id FROM crm_appointments")).rows.length, 1);
  } finally { await db.close(); }
});

test("reschedules once with history and conflict protection, then cancels once and frees the slot", async () => {
  const db = await setup();
  try {
    await save(db);
    const id = (await book(db, "2099-01-05T14:00:00Z", "2099-01-05T14:30:00Z")).rows[0].id;
    await db.query("SELECT reschedule_crm_appointment($1,$2,$3,$4)", ["Gestor", id, "2099-01-06T15:00:00Z", "2099-01-06T15:30:00Z"]);
    await assert.rejects(db.query("SELECT reschedule_crm_appointment($1,$2,$3,$4)", ["Gestor", id, "2020-01-06T15:00:00Z", "2020-01-06T15:30:00Z"]), /invalid_appointment/);
    await db.query("SELECT cancel_crm_appointment($1,$2)", ["Gestor", id]);
    assert.equal((await db.query<any>("SELECT status FROM crm_appointments WHERE id=$1", [id])).rows[0].status, "cancelled");
    await assert.rejects(db.query("SELECT cancel_crm_appointment($1,$2)", ["Gestor", id]), /already_cancelled/);
    await book(db, "2099-01-06T15:00:00Z", "2099-01-06T15:30:00Z", "evt-9");
    const history = (await db.query<any>("SELECT history FROM leads WHERE id=$1", [leadId])).rows[0].history;
    assert.deepEqual(history.map((h: any) => h.kind), ["appointment_booked", "appointment_rescheduled", "appointment_cancelled", "appointment_booked"]);
  } finally { await db.close(); }
});

test("manages blocked periods and rejects invalid ones", async () => {
  const db = await setup();
  try {
    const id = (await db.query<any>("SELECT add_crm_calendar_blocked($1,$2,$3,$4) AS id", ["Gestor", "2026-11-20T03:00:00Z", "2026-11-21T03:00:00Z", "Feriado"])).rows[0].id;
    assert.ok(id);
    await assert.rejects(db.query("SELECT add_crm_calendar_blocked($1,$2,$3,$4)", ["Gestor", "2026-11-21T03:00:00Z", "2026-11-20T03:00:00Z", "Invertido"]));
    await db.query("SELECT remove_crm_calendar_blocked($1,$2)", ["Gestor", id]);
    await assert.rejects(db.query("SELECT remove_crm_calendar_blocked($1,$2)", ["Gestor", id]), /block_unavailable/);
  } finally { await db.close(); }
});

test("does not permit browser callers to read or execute the module", async () => {
  const db = await setup();
  try {
    for (const fn of ["save_crm_calendar_settings(text,text,integer,integer,integer[],time,time,time,time,integer,text,boolean,bigint)", "book_crm_appointment(text,uuid,text,text,timestamptz,timestamptz,text)", "reschedule_crm_appointment(text,uuid,timestamptz,timestamptz)", "cancel_crm_appointment(text,uuid)", "add_crm_calendar_blocked(text,timestamptz,timestamptz,text)", "remove_crm_calendar_blocked(text,uuid)"]) {
      assert.equal((await db.query<any>(`SELECT has_function_privilege('authenticated','${fn}','EXECUTE') AS allowed`)).rows[0].allowed, false);
    }
    for (const t of ["crm_calendar_settings", "crm_calendar_blocked", "crm_appointments"]) {
      assert.equal((await db.query<any>(`SELECT has_table_privilege('authenticated','${t}','SELECT') AS allowed`)).rows[0].allowed, false);
    }
    await db.exec("SET test.role='authenticated'");
    await assert.rejects(save(db), /forbidden/);
  } finally { await db.close(); }
});
