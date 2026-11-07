import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const renata = "00000000-0000-4000-8000-000000000601";
const open = "00000000-0000-4000-8000-000000000602";

async function setup() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT coalesce(current_setting('test.role',true),'service_role') $$;
    CREATE TABLE leads(id uuid PRIMARY KEY, name text, stage text, potential_value numeric NOT NULL DEFAULT 0, history jsonb);
    INSERT INTO leads VALUES('${renata}','Renata','fechado',600,'[{"id":"old","date":"2026-01-01","text":"antigo"}]'),('${open}','Aberto','sql',900,'[]');`);
  await db.exec(await readFile("drizzle/migrations/0104_lead_closed_value.sql", "utf8"));
  return db;
}

test("card antigo em Fechado confirma e depois corrige o valor fechado, preservando o histórico", async () => {
  const db = await setup();
  try {
    await db.query("SELECT confirm_lead_closed_value($1,$2,$3)", ["Gestor", renata, 600]);
    let row = (await db.query<any>("SELECT closed_value, closed_value_confirmed_at, potential_value, history FROM leads WHERE id=$1", [renata])).rows[0];
    assert.equal(Number(row.closed_value), 600);
    assert.ok(row.closed_value_confirmed_at);
    assert.equal(Number(row.potential_value), 600);
    assert.equal(row.history.length, 2);
    assert.equal(row.history[0].id, "old");
    assert.equal(row.history[1].kind, "closed_value");
    await db.query("SELECT confirm_lead_closed_value($1,$2,$3)", ["Gestor", renata, 750.5]);
    row = (await db.query<any>("SELECT closed_value, history FROM leads WHERE id=$1", [renata])).rows[0];
    assert.equal(Number(row.closed_value), 750.5);
    assert.match(row.history[2].text, /corrigido/);
  } finally { await db.close(); }
});

test("valor fechado só vale para cards em Fechado, com valor válido e pelo servidor", async () => {
  const db = await setup();
  try {
    await assert.rejects(db.query("SELECT confirm_lead_closed_value($1,$2,$3)", ["Gestor", open, 900]), /not_closed/);
    await assert.rejects(db.query("SELECT confirm_lead_closed_value($1,$2,$3)", ["Gestor", renata, -1]), /invalid_value/);
    await db.exec("SET test.role = 'authenticated'");
    await assert.rejects(db.query("SELECT confirm_lead_closed_value($1,$2,$3)", ["Gestor", renata, 600]), /forbidden/);
  } finally { await db.close(); }
});
