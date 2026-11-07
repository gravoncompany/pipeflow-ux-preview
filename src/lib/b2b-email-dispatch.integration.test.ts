import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { dispatchIssues, scheduleWithinBrevoWindow, withGravonSignature, type AiEmailItem } from "./b2b-email-ai";

// Banco descartável com as migrações reais: disparo B2B só depois de aprovar, uma vez por endereço.
const P = "00000000-0000-4000-8000-0000000000aa";
const A = "00000000-0000-4000-8000-000000000001";
async function setup() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
   CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'service_role')$$;
   CREATE TABLE leads(id uuid PRIMARY KEY,email text,whatsapp text,stage text NOT NULL DEFAULT 'lead-novo',pipeline_id uuid,history jsonb NOT NULL DEFAULT '[]');
   CREATE TABLE sales_pipelines(id uuid PRIMARY KEY,name text,stages jsonb,archived boolean NOT NULL DEFAULT false);
   CREATE TABLE b2b_companies(cnpj text PRIMARY KEY,lead_id uuid UNIQUE,place_id text NOT NULL DEFAULT '');
   CREATE TABLE b2b_email_suppressions(email text PRIMARY KEY,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
   CREATE TABLE whatsapp_messages(id serial PRIMARY KEY, phone_key text, from_me boolean NOT NULL DEFAULT false);
   CREATE FUNCTION crm_phone_key(v text) RETURNS text LANGUAGE sql IMMUTABLE AS $$SELECT right(regexp_replace(coalesce(v,''),'[^0-9]','','g'),8)$$;`);
  for (const f of ["0064_campaigns_private_drafts", "0065_campaign_consent_audit", "0075_b2b_ai_email_drafts", "0086_campaign_email_delivery", "0094_campaign_email_without_consent_requirement", "0095_email_flows", "0105_b2b_email_dispatch", "0106_b2b_outreach_automation"])
    await db.exec(await readFile(`drizzle/migrations/${f}.sql`, "utf8"));
  const stages = [{ id: "lead-novo" }, { id: "tentando-contato" }, { id: "contato-realizado" }];
  await db.query("INSERT INTO sales_pipelines VALUES($1,'Outbound',$2::jsonb,false)", [P, JSON.stringify(stages)]);
  await db.query("INSERT INTO leads(id,email,stage,pipeline_id) VALUES($1,'clinica@example.test','lead-novo',$2)", [A, P]);
  await db.query("INSERT INTO b2b_companies VALUES('11111111000111',$1,'place-1')", [A]);
  await db.query("SELECT save_crm_campaign_email_settings(0,$1::jsonb)", [JSON.stringify({ senderEmail: "contato@gravon.com.br", senderName: "Gravon", replyTo: "", timezone: "America/Sao_Paulo" })]);
  const companies = [{ key: "place-1", name: "Clínica Um" }, { key: "place-2", name: "Clínica Dois" }, { key: "place-3", name: "Sem E-mail" }];
  const batch = (await db.query<{ id: string }>("SELECT create_b2b_ai_email_batch('k','auto','Ana',$1::jsonb) id", [JSON.stringify(companies)])).rows[0].id;
  await db.query("UPDATE b2b_ai_email_items SET state='draft',subject='Olá',body='Corpo individual do e-mail',revision=2 WHERE batch_id=$1", [batch]);
  const ids = (await db.query<{ id: string; company_key: string }>("SELECT id,company_key FROM b2b_ai_email_items ORDER BY position")).rows;
  return { db, ids: Object.fromEntries(ids.map((r) => [r.company_key, r.id])) as Record<string, string> };
}
const review = (db: PGlite, id: string, rev: number, recipient: string, ok = true) =>
  db.query<{ r: number }>("SELECT review_b2b_ai_email_item($1,$2,'Olá','Corpo individual do e-mail',$3,$4) r", [id, rev, recipient, ok]).then((x) => x.rows[0].r);

test("rascunho não aprovado nunca é reservado para envio", async () => {
  const { db, ids } = await setup();
  try {
    await assert.rejects(db.query("SELECT reserve_b2b_ai_email_send($1,2)", [ids["place-1"]]), /stale_draft/);
    const rev = await review(db, ids["place-1"], 2, "clinica@example.test", false);
    await assert.rejects(db.query("SELECT reserve_b2b_ai_email_send($1,$2)", [ids["place-1"], rev]), /stale_draft/);
  } finally { await db.close(); }
});

test("empresa sem e-mail fica pendente e não bloqueia as completas", async () => {
  const { db, ids } = await setup();
  try {
    const r3 = await review(db, ids["place-3"], 2, "");
    await assert.rejects(db.query("SELECT reserve_b2b_ai_email_send($1,$2)", [ids["place-3"], r3]), /missing_recipient/);
    const r1 = await review(db, ids["place-1"], 2, "clinica@example.test");
    const res = (await db.query<{ r: { recipient: string; lead_id: string } }>("SELECT reserve_b2b_ai_email_send($1,$2) r", [ids["place-1"], r1])).rows[0].r;
    assert.equal(res.recipient, "clinica@example.test");
    assert.equal(res.lead_id, A);
  } finally { await db.close(); }
});

test("envio aceito vira primeiro contato no card e o endereço não recebe de novo", async () => {
  const { db, ids } = await setup();
  try {
    const r1 = await review(db, ids["place-1"], 2, "clinica@example.test");
    await db.query("SELECT reserve_b2b_ai_email_send($1,$2)", [ids["place-1"], r1]);
    await db.query("SELECT finish_b2b_ai_email_send($1,'accepted','msg-1','')", [ids["place-1"]]);
    const lead = (await db.query<{ stage: string; history: { text: string }[] }>("SELECT stage,history FROM leads WHERE id=$1", [A])).rows[0];
    assert.equal(lead.stage, "tentando-contato");
    assert.ok(lead.history.some((h) => h.text.startsWith("Primeiro contato B2B · E-mail")));
    const r2 = await review(db, ids["place-2"], 2, "clinica@example.test");
    await assert.rejects(db.query("SELECT reserve_b2b_ai_email_send($1,$2)", [ids["place-2"], r2]), /already_sent/);
    await assert.rejects(review(db, ids["place-1"], r1 + 1, "outra@example.test"), /stale_draft/);
  } finally { await db.close(); }
});

test("descadastrado é recusado no envio", async () => {
  const { db, ids } = await setup();
  try {
    await db.query("INSERT INTO b2b_email_suppressions VALUES('clinica@example.test','pediu remoção')");
    const r1 = await review(db, ids["place-1"], 2, "clinica@example.test");
    await assert.rejects(db.query("SELECT reserve_b2b_ai_email_send($1,$2)", [ids["place-1"], r1]), /suppressed_contact/);
  } finally { await db.close(); }
});

test("limite diário compartilhado de 250 e-mails", async () => {
  const { db, ids } = await setup();
  try {
    // Cópia descartável: libera as chaves só para simular 250 envios de fluxos nas últimas 24 h.
    await db.exec("ALTER TABLE crm_email_flow_messages DROP CONSTRAINT crm_email_flow_messages_enrollment_id_fkey, DROP CONSTRAINT crm_email_flow_messages_flow_id_fkey");
    await db.exec("INSERT INTO crm_email_flow_messages(enrollment_id,flow_id,direction,kind,contact,state) SELECT gen_random_uuid(),gen_random_uuid(),'out','reply','n'||g||'@example.test','accepted' FROM generate_series(1,250) g");
    const r1 = await review(db, ids["place-1"], 2, "clinica@example.test");
    await assert.rejects(db.query("SELECT reserve_b2b_ai_email_send($1,$2)", [ids["place-1"], r1]), /daily_limit/);
  } finally { await db.close(); }
});

test("pendências da prévia: sem e-mail, falta aprovar, repetido", () => {
  const item = { id: "1", state: "draft", send_state: "none" } as AiEmailItem;
  assert.deepEqual(dispatchIssues(item, "", new Set(), new Set()), ["missing_email", "not_reviewed"]);
  assert.deepEqual(dispatchIssues({ ...item, state: "reviewed" }, "a@b.com", new Set(), new Set()), []);
  assert.deepEqual(dispatchIssues({ ...item, state: "reviewed" }, "a@b.com", new Set(), new Set(["a@b.com"])), ["duplicate_recipient"]);
  assert.deepEqual(dispatchIssues({ ...item, state: "reviewed" }, "a@b.com", new Set(["a@b.com"]), new Set()), ["suppressed"]);
  assert.deepEqual(dispatchIssues({ ...item, state: "reviewed", send_state: "accepted" }, "a@b.com", new Set(), new Set()), ["already_sent"]);
});

test("card da Prospecção em Lead Novo do Outbound entra na fila uma única vez", async () => {
  const { db } = await setup();
  try {
    const L = "00000000-0000-4000-8000-0000000000b1";
    await db.query("INSERT INTO leads(id,email,stage,pipeline_id) VALUES($1,'nova@example.test','contato-realizado',$2)", [L, P]);
    await db.query("INSERT INTO b2b_companies VALUES('22222222000122',$1,'place-9')", [L]);
    const count = async () => Number((await db.query<{ n: number }>("SELECT count(*)::int n FROM b2b_prep_queue WHERE lead_id=$1", [L])).rows[0].n);
    assert.equal(await count(), 0);
    await db.query("UPDATE leads SET stage='lead-novo' WHERE id=$1", [L]);
    assert.equal(await count(), 1);
    await db.query("UPDATE b2b_prep_queue SET state='done' WHERE lead_id=$1", [L]);
    await db.query("UPDATE leads SET stage='contato-realizado' WHERE id=$1", [L]);
    await db.query("UPDATE leads SET stage='lead-novo' WHERE id=$1", [L]);
    assert.equal((await db.query<{ state: string }>("SELECT state FROM b2b_prep_queue WHERE lead_id=$1", [L])).rows[0].state, "done");
  } finally { await db.close(); }
});

test("outro funil não entra na fila automática", async () => {
  const { db } = await setup();
  try {
    const Q = "00000000-0000-4000-8000-0000000000ab", L = "00000000-0000-4000-8000-0000000000b2";
    await db.query("INSERT INTO sales_pipelines VALUES($1,'CRM','[{\"id\":\"lead-novo\"}]'::jsonb,false)", [Q]);
    await db.query("INSERT INTO leads(id,email,stage,pipeline_id) VALUES($1,'x@example.test','lead-novo',$2)", [L, Q]);
    await db.query("INSERT INTO b2b_companies VALUES('33333333000133',$1,'place-8')", [L]);
    assert.equal(Number((await db.query<{ n: number }>("SELECT count(*)::int n FROM b2b_prep_queue WHERE lead_id=$1", [L])).rows[0].n), 0);
  } finally { await db.close(); }
});

test("resposta pelo WhatsApp interrompe os follow-ups de e-mail", async () => {
  const { db } = await setup();
  try {
    await db.query("UPDATE leads SET whatsapp='+55 41 99611-0372' WHERE id=$1", [A]);
    const f = (await db.query<{ f: { id: string; revision: number } }>("SELECT save_crm_email_flow(NULL,0,'Follow',$1::jsonb,false,false) AS f", [JSON.stringify([{ day: 2, subject: "Oi", body: "Retomando" }])])).rows[0].f;
    await db.query("SELECT set_crm_email_flow_state($1,$2,'active')", [f.id, f.revision]);
    await db.query("SELECT enroll_crm_email_flow($1,ARRAY[$2]::uuid[])", [f.id, A]);
    await db.query("INSERT INTO whatsapp_messages(phone_key,from_me) VALUES('96110372',false)");
    assert.equal((await db.query<{ status: string }>("SELECT status FROM crm_email_flow_enrollments WHERE lead_id=$1", [A])).rows[0].status, "paused");
  } finally { await db.close(); }
});

test("agendamento só entre 5 minutos e 72 horas; agendado fica registrado no card", async () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  assert.equal(scheduleWithinBrevoWindow(null, now), true);
  assert.equal(scheduleWithinBrevoWindow("2026-11-04T12:03:00Z", now), false);
  assert.equal(scheduleWithinBrevoWindow("2026-11-04T13:00:00Z", now), true);
  assert.equal(scheduleWithinBrevoWindow("2026-11-07T12:01:00Z", now), false);
  const { db, ids } = await setup();
  try {
    const r1 = await review(db, ids["place-1"], 2, "clinica@example.test");
    await assert.rejects(db.query("SELECT reserve_b2b_ai_email_send($1,$2,now()+interval '1 minute')", [ids["place-1"], r1]), /invalid_schedule/);
    await db.query("SELECT reserve_b2b_ai_email_send($1,$2,now()+interval '2 hours')", [ids["place-1"], r1]);
    await db.query("SELECT finish_b2b_ai_email_send($1,'accepted','msg-9','')", [ids["place-1"]]);
    const h = (await db.query<{ history: { text: string }[] }>("SELECT history FROM leads WHERE id=$1", [A])).rows[0].history;
    assert.ok(h.some((x) => x.text.includes("Agendado na Brevo")));
  } finally { await db.close(); }
});

test("e-mail final leva a assinatura e o banner da Gravon uma única vez", () => {
  const out = withGravonSignature("Olá, equipe.\n\nPodemos conversar?\n\nGravon Company\nMarketing, tecnologia e inteligência comercial.");
  assert.equal(out.match(/Gravon Company\nMarketing/g)?.length, 1);
  assert.match(out, /\[imagem: https:\/\/crm\.gravoncompany\.com\/api\/public\/email-images\//);
  assert.match(out, /\(51\) 99548-6303/);
});
