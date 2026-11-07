import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { confirmBlocker, saveThenStart } from "./campaign-confirm";
import type { CampaignInput } from "./campaigns";

const lead = "00000000-0000-4000-8000-000000000001";
const base: CampaignInput = { id: null, revision: 1, name: "Campanha teste", channel: "email", subject: "Assunto", body: "Olá", senderReference: "", instanceReference: "", leadIds: [lead], scheduledAt: null };

test("confirm button is enabled with valid data and a ready validation, without any saved draft", () => {
  assert.equal(confirmBlocker({ draft: base, validation: { ready: true }, busy: false }), null);
});
test("confirm button explains real blockers", () => {
  assert.match(confirmBlocker({ draft: base, validation: null, busy: false }) ?? "", /Validar canal/);
  assert.match(confirmBlocker({ draft: base, validation: { ready: false }, busy: false }) ?? "", /impedimentos/);
  assert.match(confirmBlocker({ draft: { ...base, leadIds: [] }, validation: { ready: true }, busy: false }) ?? "", /destinatário/);
  assert.match(confirmBlocker({ draft: { ...base, subject: " " }, validation: { ready: true }, busy: false }) ?? "", /assunto/);
  assert.notEqual(confirmBlocker({ draft: base, validation: { ready: true }, busy: true }), null);
});
test("a failed save stops before any send", async () => {
  let started = 0;
  const out = await saveThenStart(base, { save: async () => { throw new Error("Falha ao salvar."); }, start: async () => { started++; return { ok: true, message: "x" }; } });
  assert.equal(started, 0);
  assert.equal(out.result.ok, false);
  assert.match(out.result.message, /Nada foi enviado/);
});

test("simulated send: new campaign, existing draft and future schedule send exactly the saved revision once", async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT 'service_role'$$;CREATE TABLE leads(id uuid PRIMARY KEY,email text,whatsapp text);");
    await db.exec(await readFile("drizzle/migrations/0064_campaigns_private_drafts.sql", "utf8"));
    type Row = { id: string; revision: number; state: string; body: string; scheduled_at: string | null };
    const save = async (input: CampaignInput) => (await db.query<{ d: Row }>("SELECT save_crm_campaign_draft($1,$2,$3::jsonb) AS d", [input.id, input.revision, JSON.stringify(input)])).rows[0].d;
    const sent: Row[] = [];
    // Simulated dispatch: like the real one it only accepts the current revision of a draft and then locks it.
    const start = async (id: string, revision: number) => {
      const r = (await db.query<Row>("SELECT * FROM crm_campaigns WHERE id=$1", [id])).rows[0];
      if (r.state !== "draft" || r.revision !== revision) return { ok: false, message: "já confirmada ou alterada" };
      await db.query("UPDATE crm_campaigns SET state=$2 WHERE id=$1", [id, r.scheduled_at ? "scheduled" : "running"]);
      sent.push(r);
      return { ok: true, message: "simulado" };
    };

    // 1. New campaign, never saved: confirm saves it and sends.
    const fresh = await saveThenStart(base, { save, start });
    assert.equal(fresh.result.ok, true);
    assert.equal(sent.length, 1);

    // 2. Existing draft edited after its last save: confirm saves the current text and sends that.
    const draft = await save({ ...base, name: "Rascunho" });
    const edited = await saveThenStart({ ...base, id: draft.id, revision: draft.revision, name: "Rascunho", body: "Texto alterado" }, { save, start });
    assert.equal(edited.result.ok, true);
    assert.equal(sent[1].body, "Texto alterado");
    assert.equal(sent[1].revision, 2);

    // 3. Future schedule is kept as a schedule.
    const at = "2026-12-01T15:00:00.000Z";
    const sched = await saveThenStart({ ...base, scheduledAt: at }, { save, start });
    assert.equal(sched.result.ok, true);
    assert.equal(new Date(sent[2].scheduled_at ?? "").toISOString(), at);

    // Repeated click with the same form data: save is rejected and nothing is sent again.
    const again = await saveThenStart({ ...base, id: draft.id, revision: draft.revision, name: "Rascunho" }, { save, start });
    assert.equal(again.result.ok, false);
    assert.equal(sent.length, 3);
  } finally {
    await db.close();
  }
});
