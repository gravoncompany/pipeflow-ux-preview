import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Banco descartável: aplica as migrações reais de campanhas e a 0095 sobre tabelas mínimas.
const P = "00000000-0000-4000-8000-0000000000aa";
const A = "00000000-0000-4000-8000-000000000001", B = "00000000-0000-4000-8000-000000000002", C = "00000000-0000-4000-8000-000000000003";

async function setup() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
   CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'service_role')$$;
   CREATE TABLE leads(id uuid PRIMARY KEY,email text,whatsapp text,stage text NOT NULL DEFAULT 'lead-novo',pipeline_id uuid,history jsonb NOT NULL DEFAULT '[]');
   CREATE TABLE sales_pipelines(id uuid PRIMARY KEY,name text,stages jsonb,archived boolean NOT NULL DEFAULT false);
   CREATE TABLE b2b_companies(cnpj text PRIMARY KEY,lead_id uuid UNIQUE);
   CREATE TABLE b2b_email_suppressions(email text PRIMARY KEY,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());`);
  for (const f of ["0064_campaigns_private_drafts", "0065_campaign_consent_audit", "0086_campaign_email_delivery", "0094_campaign_email_without_consent_requirement", "0095_email_flows"])
    await db.exec(await readFile(`drizzle/migrations/${f}.sql`, "utf8"));
  const stages = [{ id: "lead-novo", title: "Lead Novo" }, { id: "tentando-contato", title: "Tentando Contato" }, { id: "contato-realizado", title: "Contato Realizado" }];
  await db.query("INSERT INTO sales_pipelines VALUES($1,'Outbound',$2::jsonb,false)", [P, JSON.stringify(stages)]);
  await db.query("INSERT INTO leads(id,email,stage,pipeline_id) VALUES($1,'ana@example.test','lead-novo',$4),($2,'bia@example.test','contato-realizado',$4),($3,'caio@example.test','lead-novo',NULL)", [A, B, C, P]);
  await db.query("INSERT INTO b2b_companies VALUES('11111111000111',$1),('22222222000122',$2)", [A, B]);
  await db.query("SELECT save_crm_campaign_email_settings(0,$1::jsonb)", [JSON.stringify({ senderEmail: "contato@gravon.com.br", senderName: "Gravon", replyTo: "", timezone: "America/Sao_Paulo" })]);
  return db;
}
const steps = [{ day: 1, subject: "Apresentação", body: "Olá {{nome}}" }, { day: 3, subject: "Follow-up", body: "Retomando" }];
async function flow(db: PGlite, ai = false, approve = false) {
  const f = (await db.query<{ f: { id: string; revision: number } }>("SELECT save_crm_email_flow(NULL,0,'Prospecção',$1::jsonb,$2,$3) AS f", [JSON.stringify(steps), ai, approve])).rows[0].f;
  return (await db.query<{ f: { id: string; revision: number } }>("SELECT set_crm_email_flow_state($1,$2,'active') AS f", [f.id, f.revision])).rows[0].f;
}
const lead = async (db: PGlite, id: string) => (await db.query<{ stage: string; history: { id: string; text: string }[] }>("SELECT stage,history FROM leads WHERE id=$1", [id])).rows[0];
const enrollment = async (db: PGlite, leadId: string) => (await db.query<{ id: string; status: string; next_step: number; next_send_at: string | null; reason: string }>("SELECT * FROM crm_email_flow_enrollments WHERE lead_id=$1", [leadId])).rows[0];
const reserve = (db: PGlite, e: string, step: number, ai = false) => db.query<{ m: string }>("SELECT reserve_crm_email_flow_step($1,$2,'Assunto','Corpo',$3) AS m", [e, step, ai]);

test("envio aceito registra no card e move para Tentando Contato só no B2B, sem retroceder; falha mantém o card", async () => {
  const db = await setup();
  try {
    const f = await flow(db);
    await db.query("SELECT enroll_crm_email_flow($1,$2::uuid[])", [f.id, [A, B, C]]);
    for (const id of [A, B, C]) {
      const e = await enrollment(db, id);
      const m = (await reserve(db, e.id, 0)).rows[0].m;
      await db.query("SELECT finish_crm_email_flow_step($1,'accepted','msg-1','')", [m]);
    }
    const a = await lead(db, A);
    assert.equal(a.stage, "tentando-contato");
    assert.ok(a.history.some((h) => /fluxo "Prospecção" · etapa 1/.test(h.text)));
    assert.ok(a.history.some((h) => /Movido automaticamente para Tentando Contato/.test(h.text)));
    assert.equal((await lead(db, B)).stage, "contato-realizado", "etapa mais avançada não retrocede");
    assert.equal((await lead(db, C)).stage, "lead-novo", "fora da Prospecção B2B não move");
    assert.equal((await lead(db, C)).history.length, 1, "mas o envio fica registrado");
    const ea = await enrollment(db, A);
    assert.equal(ea.next_step, 1);
    assert.equal(ea.status, "active");
    assert.ok(ea.next_send_at && Date.parse(ea.next_send_at) > Date.now() + 47 * 3600e3, "etapa do dia 3 fica para 2 dias depois");

    // Falha: card não muda e a inscrição pausa sem reenviar.
    await db.query("UPDATE leads SET stage='lead-novo', history='[]' WHERE id=$1", [A]);
    await db.query("UPDATE crm_email_flow_enrollments SET next_send_at=now() - interval '1 minute' WHERE lead_id=$1", [A]);
    const m2 = (await reserve(db, ea.id, 1)).rows[0].m;
    await db.query("SELECT finish_crm_email_flow_step($1,'failed','','http_400')", [m2]);
    assert.equal((await lead(db, A)).stage, "lead-novo");
    assert.equal((await lead(db, A)).history.length, 0);
    assert.equal((await enrollment(db, A)).status, "paused");
  } finally { await db.close(); }
});

test("campanha aceita também registra no card e move o B2B", async () => {
  const db = await setup();
  try {
    const c = (await db.query<{ d: { id: string; revision: number } }>("SELECT save_crm_campaign_draft(NULL,1,$1::jsonb) AS d", [JSON.stringify({ name: "Campanha X", channel: "email", subject: "Oferta", body: "Mensagem", leadIds: [A], scheduledAt: null })])).rows[0].d;
    const r = (await db.query<{ r: { id: string }[] }>("SELECT claim_crm_campaign_email($1,$2,$3::jsonb,NULL,gen_random_uuid()) AS r", [c.id, c.revision, JSON.stringify([{ lead_id: A, contact: "ana@example.test" }])])).rows[0].r;
    await db.query("SELECT finish_crm_campaign_delivery($1,'failed','','http_400')", [r[0].id]);
    assert.equal((await lead(db, A)).stage, "lead-novo", "falha mantém o card");
    const c2 = (await db.query<{ d: { id: string; revision: number } }>("SELECT save_crm_campaign_draft(NULL,1,$1::jsonb) AS d", [JSON.stringify({ name: "Campanha Y", channel: "email", subject: "Oferta 2", body: "Mensagem", leadIds: [A], scheduledAt: null })])).rows[0].d;
    const r2 = (await db.query<{ r: { id: string }[] }>("SELECT claim_crm_campaign_email($1,$2,$3::jsonb,NULL,gen_random_uuid()) AS r", [c2.id, c2.revision, JSON.stringify([{ lead_id: A, contact: "ana@example.test" }])])).rows[0].r;
    await db.query("SELECT finish_crm_campaign_delivery($1,'accepted','m','')", [r2[0].id]);
    const a = await lead(db, A);
    assert.equal(a.stage, "tentando-contato");
    assert.ok(a.history.some((h) => /campanha "Campanha Y"/.test(h.text)));
  } finally { await db.close(); }
});

test("etapa não é enviada duas vezes; IA exige aprovação da revisão atual", async () => {
  const db = await setup();
  try {
    const f = await flow(db);
    await db.query("SELECT enroll_crm_email_flow($1,$2::uuid[])", [f.id, [A]]);
    const e = await enrollment(db, A);
    await reserve(db, e.id, 0);
    await assert.rejects(reserve(db, e.id, 0), /not_due/);
    await assert.rejects(reserve(db, e.id, 0, true), /not_due|ai_not_approved/);

    // IA ligada sem aprovação não ativa; com aprovação ativa; editar remove a aprovação.
    const draft = (await db.query<{ f: { id: string; revision: number } }>("SELECT save_crm_email_flow(NULL,0,'Com IA',$1::jsonb,true,false) AS f", [JSON.stringify(steps)])).rows[0].f;
    await assert.rejects(db.query("SELECT set_crm_email_flow_state($1,$2,'active')", [draft.id, draft.revision]), /ai_not_approved/);
    const approved = (await db.query<{ f: { id: string; revision: number; ai_approved_revision: number } }>("SELECT save_crm_email_flow($1,$2,'Com IA',$3::jsonb,true,true) AS f", [draft.id, draft.revision, JSON.stringify(steps)])).rows[0].f;
    assert.equal(approved.ai_approved_revision, approved.revision);
    const active = (await db.query<{ f: { revision: number; ai_approved_revision: number } }>("SELECT set_crm_email_flow_state($1,$2,'active') AS f", [draft.id, approved.revision])).rows[0].f;
    assert.equal(active.ai_approved_revision, active.revision);
    const edited = (await db.query<{ f: { revision: number; ai_approved_revision: number | null } }>("SELECT save_crm_email_flow($1,$2,'Com IA',$3::jsonb,true,false) AS f", [draft.id, active.revision, JSON.stringify(steps)])).rows[0].f;
    assert.equal(edited.ai_approved_revision, null);
  } finally { await db.close(); }
});

test("resposta pausa, gera pendência e só envia após aprovação; descadastro encerra e bloqueia", async () => {
  const db = await setup();
  try {
    const f = await flow(db);
    await db.query("SELECT enroll_crm_email_flow($1,$2::uuid[])", [f.id, [A, C]]);
    const e = await enrollment(db, A);
    const m = (await reserve(db, e.id, 0)).rows[0].m;
    await db.query("SELECT finish_crm_email_flow_step($1,'accepted','x','')", [m]);
    const inbound = (await db.query<{ m: string }>("SELECT record_crm_email_flow_reply($1,'gmail-1','<id@mail>','Re: Apresentação','Tenho interesse, me liga',false) AS m", [e.id])).rows[0].m;
    assert.ok(inbound);
    assert.equal((await db.query<{ m: string | null }>("SELECT record_crm_email_flow_reply($1,'gmail-1','','','',false) AS m", [e.id])).rows[0].m, null, "mesma mensagem não é registrada duas vezes");
    const after = await enrollment(db, A);
    assert.equal(after.status, "awaiting_reply");
    assert.equal(after.next_send_at, null);
    assert.ok((await lead(db, A)).history.some((h) => /Resposta recebida por e-mail/.test(h.text)));
    // Próxima etapa não pode mais ser reservada.
    await db.query("UPDATE crm_email_flow_enrollments SET next_send_at=now() WHERE id=$1", [e.id]);
    await assert.rejects(reserve(db, e.id, 1), /not_due/);

    const s = (await db.query<{ s: string }>("SELECT save_crm_email_flow_suggestion($1,'Interesse','Re: Apresentação','Obrigado!') AS s", [inbound])).rows[0].s;
    const pending = (await db.query<{ state: string; revision: number }>("SELECT state,revision FROM crm_email_flow_suggestions WHERE id=$1", [s])).rows[0];
    assert.equal(pending.state, "pending", "nada sai sem aprovação");
    await db.query("SELECT reserve_crm_email_flow_reply($1,$2,'Re: Apresentação','Texto editado')", [s, pending.revision]);
    await assert.rejects(db.query("SELECT reserve_crm_email_flow_reply($1,$2,'Re','x')", [s, pending.revision]), /stale_suggestion/, "clique duplo não envia de novo");
    await db.query("SELECT finish_crm_email_flow_reply($1,'accepted','p','')", [s]);
    assert.equal((await enrollment(db, A)).status, "in_conversation");

    const ec = await enrollment(db, C);
    await db.query("SELECT record_crm_email_flow_reply($1,'gmail-2','','Re','DESCADASTRAR',true)", [ec.id]);
    assert.equal((await enrollment(db, C)).status, "stopped");
    assert.equal((await db.query<{ n: number }>("SELECT count(*)::int n FROM b2b_email_suppressions WHERE email='caio@example.test'")).rows[0].n, 1);
    // Bloqueado não entra em novos fluxos.
    const f2 = (await db.query<{ f: { id: string } }>("SELECT save_crm_email_flow(NULL,0,'Outro',$1::jsonb,false,false) AS f", [JSON.stringify(steps)])).rows[0].f;
    const res = (await db.query<{ r: { added: number } }>("SELECT enroll_crm_email_flow($1,$2::uuid[]) AS r", [f2.id, [C]])).rows[0].r;
    assert.equal(res.added, 0);
  } finally { await db.close(); }
});

test("endereço não participa de duas sequências ao mesmo tempo; executor tem trava única", async () => {
  const db = await setup();
  try {
    const f1 = await flow(db);
    const f2 = (await db.query<{ f: { id: string } }>("SELECT save_crm_email_flow(NULL,0,'Segundo',$1::jsonb,false,false) AS f", [JSON.stringify(steps)])).rows[0].f;
    assert.equal((await db.query<{ r: { added: number } }>("SELECT enroll_crm_email_flow($1,$2::uuid[]) AS r", [f1.id, [A]])).rows[0].r.added, 1);
    assert.equal((await db.query<{ r: { added: number } }>("SELECT enroll_crm_email_flow($1,$2::uuid[]) AS r", [f2.id, [A]])).rows[0].r.added, 0);
    const t1 = "00000000-0000-4000-8000-0000000000f1", t2 = "00000000-0000-4000-8000-0000000000f2";
    assert.equal((await db.query<{ ok: boolean }>("SELECT claim_crm_email_flow_runner($1,60) ok", [t1])).rows[0].ok, true);
    assert.equal((await db.query<{ ok: boolean }>("SELECT claim_crm_email_flow_runner($1,60) ok", [t2])).rows[0].ok, false);
    await db.exec("SET request.jwt.claim.role='authenticated'");
    await assert.rejects(db.query("SELECT enroll_crm_email_flow($1,'{}'::uuid[])", [f1.id]), /access_denied/);
  } finally { await db.close(); }
});
