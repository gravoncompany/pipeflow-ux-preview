import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { referenceDb, inbound, PIPELINES } from "./crm-agent-test-db";

const LEASE = "00000000-0000-4000-8000-00000000aaaa";
const EVIDENCE = JSON.stringify([{ messageId: "m", quote: "quanto custa" }]);

async function setup(withSettings = true) {
  const db = await referenceDb();
  await db.exec(`ALTER TABLE public.leads ADD COLUMN service text DEFAULT '', ADD COLUMN email text DEFAULT '';
    CREATE TABLE public.meta_capi_settings(company_key text PRIMARY KEY, pixel_id text NOT NULL, encrypted_token text NOT NULL DEFAULT 'x', enabled boolean NOT NULL DEFAULT true,
      production_enabled boolean NOT NULL DEFAULT false CHECK (production_enabled = false));`);
  if (withSettings) await db.exec(`INSERT INTO public.meta_capi_settings(company_key,pixel_id) VALUES('crm:1','700246889593303')`);
  await db.exec(await readFile("drizzle/migrations/0099_lead_ai_qualification.sql", "utf8"));
  await db.exec(`CREATE SCHEMA net; CREATE TABLE public.wakes(url text, auth text);
    CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO public.wakes VALUES (url, headers->>'Authorization') RETURNING 1::bigint $$;`);
  await db.exec(await readFile("drizzle/migrations/0100_lead_ai_qualification_wake.sql", "utf8"));
  await db.exec(await readFile("drizzle/migrations/0101_meta_capi_event_monitoring.sql", "utf8"));
  const { rows } = await db.query<{ id: string }>(`INSERT INTO leads(name,whatsapp) VALUES('Ana','5511988887777') RETURNING id`);
  return { db, lead: rows[0].id };
}
const claim = async (db: Awaited<ReturnType<typeof setup>>["db"]) => (await db.query<{ lead_id: string }>(`SELECT * FROM claim_lead_ai_qualifications($1,10)`, [LEASE])).rows;
const finish = async (db: Awaited<ReturnType<typeof setup>>["db"], lead: string, outcome: string, evidence = "[]") =>
  (await db.query<{ r: string }>(`SELECT finish_lead_ai_qualification($1,$2,$3,'resumo','adequado',$4::jsonb,'f',now(),'') AS r`, [lead, LEASE, outcome, evidence])).rows[0].r;
const status = async (db: Awaited<ReturnType<typeof setup>>["db"], lead: string) => (await db.query<{ status: string }>(`SELECT status FROM lead_ai_qualifications WHERE lead_id=$1`, [lead])).rows[0]?.status;

describe("qualificação automática no funil principal", () => {
  it("só começa quando o card entra em Qualificação no funil principal", async () => {
    const { db, lead } = await setup();
    assert.equal(await status(db, lead), undefined);
    await db.query(`UPDATE leads SET stage='qualificacao' WHERE id=$1`, [lead]);
    assert.equal(await status(db, lead), "em_analise");
    assert.equal((await db.query(`SELECT 1 FROM wakes`)).rows.length, 1);
    const { rows } = await db.query<{ id: string }>(`INSERT INTO leads(name,whatsapp,pipeline_id,stage) VALUES('Outro','5511977776666',$1,'qualificacao') RETURNING id`, [PIPELINES.CRM]);
    assert.equal(await status(db, rows[0].id), undefined);
  });

  it("sem evidência suficiente mantém Em análise e não prepara evento", async () => {
    const { db, lead } = await setup();
    await db.query(`UPDATE leads SET stage='qualificacao' WHERE id=$1`, [lead]);
    assert.equal((await claim(db)).length, 1);
    assert.equal(await finish(db, lead, "insufficient"), "ok");
    assert.equal(await status(db, lead), "em_analise");
    assert.equal((await db.query(`SELECT 1 FROM meta_capi_lead_events`)).rows.length, 0);
  });

  it("Qualificado não move o card e prepara um único evento com o Pixel da empresa, sem envio", async () => {
    const { db, lead } = await setup();
    await db.query(`UPDATE leads SET stage='qualificacao' WHERE id=$1`, [lead]);
    await claim(db);
    assert.equal(await finish(db, lead, "qualified", EVIDENCE), "ok");
    assert.equal(await status(db, lead), "qualificado");
    const card = (await db.query<{ stage: string; tags: unknown }>(`SELECT stage,tags FROM leads WHERE id=$1`, [lead])).rows[0];
    assert.equal(card.stage, "qualificacao");
    assert.deepEqual(card.tags, []);
    // Sai e volta para Qualificação: continua Qualificado e não duplica o evento.
    await db.query(`UPDATE leads SET stage='mql' WHERE id=$1`, [lead]);
    await db.query(`UPDATE leads SET stage='qualificacao' WHERE id=$1`, [lead]);
    assert.equal(await status(db, lead), "qualificado");
    await db.query(`UPDATE lead_ai_qualifications SET lease_token=$2 WHERE lead_id=$1`, [lead, LEASE]);
    await finish(db, lead, "qualified", EVIDENCE);
    const events = (await db.query<{ status: string; pixel_id: string; event_id: string }>(`SELECT status,pixel_id,event_id FROM meta_capi_lead_events`)).rows;
    assert.deepEqual(events, [{ status: "ready", pixel_id: "700246889593303", event_id: `pipeflow-qualified-${lead}` }]);
    // Envio real desligado: nada é liberado para envio.
    assert.equal((await db.query(`SELECT * FROM claim_meta_capi_lead_events(10)`)).rows.length, 0);
    assert.equal((await db.query<{ status: string }>(`SELECT status FROM meta_capi_lead_events`)).rows[0].status, "ready");
  });

  it("Qualificado exige evidência", async () => {
    const { db, lead } = await setup();
    await db.query(`UPDATE leads SET stage='qualificacao' WHERE id=$1`, [lead]);
    await claim(db);
    await assert.rejects(finish(db, lead, "qualified", "[]"), /evidence_required/);
  });

  it("sem configuração da Meta o evento fica aguardando configuração", async () => {
    const { db, lead } = await setup(false);
    await db.query(`UPDATE leads SET stage='qualificacao' WHERE id=$1`, [lead]);
    await claim(db);
    await finish(db, lead, "qualified", EVIDENCE);
    assert.deepEqual((await db.query<{ status: string; pixel_id: string | null }>(`SELECT status,pixel_id FROM meta_capi_lead_events`)).rows, [{ status: "waiting_settings", pixel_id: null }]);
  });

  it("Em análise volta a ser avaliado só quando o cliente envia mensagem nova", async () => {
    const { db, lead } = await setup();
    await db.query(`UPDATE leads SET stage='qualificacao' WHERE id=$1`, [lead]);
    await claim(db);
    await finish(db, lead, "insufficient");
    await db.query(`UPDATE lead_ai_qualifications SET next_check_at=now()-interval '1 minute' WHERE lead_id=$1`, [lead]);
    assert.equal((await claim(db)).length, 0);
    const before = (await db.query(`SELECT 1 FROM wakes`)).rows.length;
    await inbound(db, "5511988887777", "Quero saber o preço", { sent_at: new Date(Date.now() + 60_000).toISOString() });
    assert.equal((await db.query(`SELECT 1 FROM wakes`)).rows.length, before + 1);
    assert.equal((await claim(db)).length, 1);
  });

  it("funções recusam quem não é o servidor", async () => {
    const { db } = await setup();
    await db.exec(`SET test.role='authenticated'`);
    await assert.rejects(db.query(`SELECT * FROM claim_lead_ai_qualifications($1,1)`, [LEASE]), /access_denied/);
  });

  it("tentativas: falha recuperável reagenda, aceito conclui, nova tentativa manual só na própria empresa", async () => {
    const { db, lead } = await setup();
    await db.query(`UPDATE leads SET stage='qualificacao' WHERE id=$1`, [lead]);
    await claim(db);
    await finish(db, lead, "qualified", EVIDENCE);
    const id = (await db.query<{ id: string }>(`SELECT id FROM meta_capi_lead_events`)).rows[0].id;
    // Simula a reserva que só acontece com envio real ligado (travado em false neste projeto).
    await db.query(`UPDATE meta_capi_lead_events SET status='sending', attempts=1 WHERE id=$1`, [id]);
    await db.query(`SELECT record_meta_capi_attempt($1,'automatic','recoverable',503,'2','{"event_id":"x"}','{"http":503}')`, [id]);
    let ev = (await db.query<{ status: string; retryable: boolean; next_attempt_at: string | null }>(`SELECT status,retryable,next_attempt_at FROM meta_capi_lead_events`)).rows[0];
    assert.equal(ev.status, "retry_scheduled"); assert.equal(ev.retryable, true); assert.ok(ev.next_attempt_at);
    assert.equal((await db.query<{ r: string }>(`SELECT request_meta_capi_retry($1,'crm:2') AS r`, [id])).rows[0].r, "not_found");
    assert.equal((await db.query<{ r: string }>(`SELECT request_meta_capi_retry($1,'crm:1') AS r`, [id])).rows[0].r, "ok");
    await db.query(`UPDATE meta_capi_lead_events SET status='sending', attempts=2 WHERE id=$1`, [id]);
    await db.query(`SELECT record_meta_capi_attempt($1,'automatic','accepted',200,null,'{}','{"events_received":1}')`, [id]);
    ev = (await db.query<{ status: string; retryable: boolean; next_attempt_at: string | null }>(`SELECT status,retryable,next_attempt_at FROM meta_capi_lead_events`)).rows[0];
    assert.equal(ev.status, "sent"); assert.equal(ev.retryable, false);
    assert.equal((await db.query(`SELECT 1 FROM meta_capi_event_attempts`)).rows.length, 2);
    assert.equal((await db.query<{ r: string }>(`SELECT request_meta_capi_retry($1,'crm:1') AS r`, [id])).rows[0].r, "not_retryable");
  });

  it("recusa definitiva não permite nova tentativa", async () => {
    const { db, lead } = await setup();
    await db.query(`UPDATE leads SET stage='qualificacao' WHERE id=$1`, [lead]);
    await claim(db);
    await finish(db, lead, "qualified", EVIDENCE);
    const id = (await db.query<{ id: string }>(`SELECT id FROM meta_capi_lead_events`)).rows[0].id;
    await db.query(`UPDATE meta_capi_lead_events SET status='sending', attempts=1 WHERE id=$1`, [id]);
    await db.query(`SELECT record_meta_capi_attempt($1,'automatic','rejected',400,'190','{}','{}')`, [id]);
    assert.equal((await db.query<{ r: string }>(`SELECT request_meta_capi_retry($1,'crm:1') AS r`, [id])).rows[0].r, "not_retryable");
  });
});
