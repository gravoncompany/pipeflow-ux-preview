import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Banco descartável com as migrações reais de campanhas, fluxos (0095) e agente de e-mail (0096).
const P = "00000000-0000-4000-8000-0000000000aa", Q = "00000000-0000-4000-8000-0000000000bb";
const A = "00000000-0000-4000-8000-000000000001", B = "00000000-0000-4000-8000-000000000002", M = "00000000-0000-4000-8000-000000000004", C = "00000000-0000-4000-8000-000000000003";

async function migration(prefix: string) {
  const file = (await readdir("drizzle/migrations")).find((f) => f.startsWith(prefix) && f.endsWith(".sql"));
  if (!file) throw new Error(`migração ${prefix} ausente`);
  return readFile(`drizzle/migrations/${file}`, "utf8");
}

async function setup() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
   CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'service_role')$$;
   CREATE TABLE leads(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL DEFAULT '',company text NOT NULL DEFAULT '',source text NOT NULL DEFAULT '',email text NOT NULL DEFAULT '',whatsapp text,stage text NOT NULL DEFAULT 'lead-novo',pipeline_id uuid,history jsonb NOT NULL DEFAULT '[]');
   CREATE TABLE sales_pipelines(id uuid PRIMARY KEY,name text,stages jsonb,archived boolean NOT NULL DEFAULT false);
   CREATE TABLE b2b_companies(cnpj text PRIMARY KEY,lead_id uuid UNIQUE);
   CREATE TABLE b2b_email_suppressions(email text PRIMARY KEY,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());`);
  for (const f of ["0064_", "0065_", "0086_", "0094_", "0095_", "0096_"]) await db.exec(await migration(f));
  const stages = [{ id: "lead-novo", title: "Lead Novo" }, { id: "tentando-contato", title: "Tentando Contato" }, { id: "contato-realizado", title: "Contato Realizado" }];
  await db.query("INSERT INTO sales_pipelines VALUES($1,'Outbound',$2::jsonb,false),($3,'CRM',$2::jsonb,false)", [P, JSON.stringify(stages), Q]);
  await db.query(`INSERT INTO leads(id,name,email,stage,pipeline_id) VALUES
    ($1,'Ana','ana@example.test','lead-novo',$5),($2,'Bia','bia@example.test','contato-realizado',$5),
    ($3,'Manual','manual@example.test','lead-novo',$5),($4,'Caio','caio@example.test','lead-novo',$6)`, [A, B, M, C, P, Q]);
  // Só Ana e Bia vieram da Prospecção B2B; "Manual" foi criado à mão no mesmo funil (o caso do teste real).
  await db.query("INSERT INTO b2b_companies VALUES('11111111000111',$1),('22222222000122',$2)", [A, B]);
  await db.query("SELECT save_crm_campaign_email_settings(0,$1::jsonb)", [JSON.stringify({ senderEmail: "contato@gravon.com.br", senderName: "Gravon", replyTo: "", timezone: "America/Sao_Paulo" })]);
  return db;
}
const steps = [{ day: 1, subject: "Apresentação", body: "Olá {{nome}}" }, { day: 3, subject: "Follow-up", body: "Retomando" }, { day: 7, subject: "Última", body: "Até mais" }];
type Flow = { id: string; revision: number; ai_approved_revision: number | null };
async function flow(db: PGlite) {
  const f = (await db.query<{ f: Flow }>("SELECT save_crm_email_flow(NULL,0,'Prospecção',$1::jsonb,false,false) AS f", [JSON.stringify(steps)])).rows[0].f;
  return (await db.query<{ f: Flow }>("SELECT set_crm_email_flow_state($1,$2,'active') AS f", [f.id, f.revision])).rows[0].f;
}
const lead = async (db: PGlite, id: string) => (await db.query<{ stage: string; history: { id: string; text: string; kind: string }[] }>("SELECT stage,history FROM leads WHERE id=$1", [id])).rows[0];
const enrollment = async (db: PGlite, leadId: string) => (await db.query<{ id: string; status: string; next_step: number; reason: string }>("SELECT * FROM crm_email_flow_enrollments WHERE lead_id=$1", [leadId])).rows[0];
const reserve = (db: PGlite, e: string, step: number) => db.query<{ m: string | null }>("SELECT reserve_crm_email_flow_step($1,$2,'Assunto','Corpo',false) AS m", [e, step]);
const due = (db: PGlite, e: string) => db.query("UPDATE crm_email_flow_enrollments SET next_send_at=now() - interval '1 minute' WHERE id=$1", [e]);
const inbox = (db: PGlite, p: Record<string, unknown>, refs: string[] = []) =>
  db.query<{ r: { id: string; lead: string | null; new: boolean; status: string; match?: string } }>("SELECT record_crm_email_inbox($1::jsonb,$2::text[]) AS r", [JSON.stringify(p), refs]).then((x) => x.rows[0].r);

test("envio aceito move para Tentando Contato também o card criado à mão no funil de prospecção; fora dele só registra", async () => {
  const db = await setup();
  try {
    const f = await flow(db);
    await db.query("SELECT enroll_crm_email_flow($1,$2::uuid[])", [f.id, [M, B, C]]);
    for (const id of [M, B, C]) {
      const m = (await reserve(db, (await enrollment(db, id)).id, 0)).rows[0].m;
      await db.query("SELECT finish_crm_email_flow_step($1,'accepted','<msg-1@relay>','')", [m]);
    }
    const manual = await lead(db, M);
    assert.equal(manual.stage, "tentando-contato");
    assert.ok(manual.history.some((h) => h.kind === "movimentacao" && /Tentando Contato/.test(h.text)), "movimentação registrada no histórico");
    assert.equal((await lead(db, B)).stage, "contato-realizado", "etapa mais avançada não retrocede");
    assert.equal((await lead(db, C)).stage, "lead-novo", "funil sem cards da prospecção não move");
    assert.equal((await lead(db, C)).history.length, 1, "mas o envio fica registrado no card");
  } finally { await db.close(); }
});

test("falha de envio não move o card", async () => {
  const db = await setup();
  try {
    const f = await flow(db);
    await db.query("SELECT enroll_crm_email_flow($1,$2::uuid[])", [f.id, [M]]);
    const m = (await reserve(db, (await enrollment(db, M)).id, 0)).rows[0].m;
    await db.query("SELECT finish_crm_email_flow_step($1,'failed','','http_400')", [m]);
    assert.equal((await lead(db, M)).stage, "lead-novo");
    assert.equal((await lead(db, M)).history.length, 0);
  } finally { await db.close(); }
});

test("interruptor geral, dias/horários e limite de mensagens bloqueiam a reserva", async () => {
  const db = await setup();
  try {
    let f = await flow(db);
    await db.query("SELECT enroll_crm_email_flow($1,$2::uuid[])", [f.id, [A]]);
    const e = await enrollment(db, A);
    await db.query("SELECT set_crm_email_agent_enabled(false)");
    await assert.rejects(reserve(db, e.id, 0), /agent_disabled/);
    await db.query("SELECT set_crm_email_agent_enabled(true)");

    // Janela que exclui o dia de hoje (em Brasília): não envia.
    const today = (await db.query<{ d: number }>("SELECT extract(dow FROM now() AT TIME ZONE 'America/Sao_Paulo')::int d")).rows[0].d;
    const other = [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== today);
    f = (await db.query<{ f: Flow }>("SELECT save_crm_email_flow_schedule($1,$2,$3::int[],'08:00','18:00',2) AS f", [f.id, f.revision, other])).rows[0].f;
    assert.equal(f.ai_approved_revision, null);
    await assert.rejects(reserve(db, e.id, 0), /outside_window/);
    await assert.rejects(db.query("SELECT save_crm_email_flow_schedule($1,$2,'{1}'::int[],'18:00','08:00',2)", [f.id, f.revision]), /invalid_schedule/);

    // Dia inteiro, todos os dias, limite de 2 mensagens.
    f = (await db.query<{ f: Flow }>("SELECT save_crm_email_flow_schedule($1,$2,'{0,1,2,3,4,5,6}'::int[],'00:00','24:00',2) AS f", [f.id, f.revision])).rows[0].f;
    for (const step of [0, 1]) {
      await due(db, e.id);
      const m = (await reserve(db, e.id, step)).rows[0].m;
      assert.ok(m);
      await db.query("SELECT finish_crm_email_flow_step($1,'accepted','p','')", [m]);
    }
    const after = await enrollment(db, A);
    assert.equal(after.status, "finished", "para no limite de 2 mensagens mesmo com 3 etapas");
  } finally { await db.close(); }
});

test("aprovação da IA continua válida quando só a janela muda", async () => {
  const db = await setup();
  try {
    const d = (await db.query<{ f: Flow }>("SELECT save_crm_email_flow(NULL,0,'IA',$1::jsonb,true,true) AS f", [JSON.stringify(steps)])).rows[0].f;
    const s = (await db.query<{ f: Flow }>("SELECT save_crm_email_flow_schedule($1,$2,'{1,2,3,4,5}'::int[],'09:00','17:00',4) AS f", [d.id, d.revision])).rows[0].f;
    assert.equal(s.ai_approved_revision, s.revision);
  } finally { await db.close(); }
});

test("caixa de entrada: associa pelo endereço, pela conversa e pela referência; desconhecido fica em revisão; sem duplicar", async () => {
  const db = await setup();
  try {
    const r1 = await inbox(db, { gmailId: "g1", threadId: "t1", from: "Ana@Example.test", subject: "Oi", body: "Tenho interesse", receivedAt: new Date().toISOString(), unread: true });
    assert.equal(r1.lead, A); assert.equal(r1.match, "address"); assert.equal(r1.status, "linked");
    assert.ok((await lead(db, A)).history.some((h) => /E-mail recebido de ana@example.test/.test(h.text)));
    const again = await inbox(db, { gmailId: "g1", from: "ana@example.test", unread: false });
    assert.equal(again.new, false, "mesma mensagem não é registrada duas vezes");
    assert.equal((await lead(db, A)).history.filter((h) => h.id.startsWith("email-inbox:")).length, 1);

    const r2 = await inbox(db, { gmailId: "g2", threadId: "t1", from: "socio@outra.test", subject: "Re: Oi", body: "Eu também" });
    assert.equal(r2.lead, A); assert.equal(r2.match, "thread");

    const camp = (await db.query<{ d: { id: string; revision: number } }>("SELECT save_crm_campaign_draft(NULL,1,$1::jsonb) AS d", [JSON.stringify({ name: "Campanha Z", channel: "email", subject: "Oferta", body: "Mensagem", leadIds: [B], scheduledAt: null })])).rows[0].d;
    const del = (await db.query<{ r: { id: string }[] }>("SELECT claim_crm_campaign_email($1,$2,$3::jsonb,NULL,gen_random_uuid()) AS r", [camp.id, camp.revision, JSON.stringify([{ lead_id: B, contact: "bia@example.test" }])])).rows[0].r;
    await db.query("SELECT finish_crm_campaign_delivery($1,'accepted','<abc@smtp-relay.test>','')", [del[0].id]);
    const r3 = await inbox(db, { gmailId: "g3", from: "assistente@bia.test", subject: "Re: S", body: "Encaminhando" }, ["<ABC@smtp-relay.test>"]);
    assert.equal(r3.lead, B); assert.equal(r3.match, "reference");

    const r4 = await inbox(db, { gmailId: "g4", from: "novo@desconhecido.test", subject: "Orçamento", body: "Quero saber mais" });
    assert.equal(r4.lead, null); assert.equal(r4.status, "review");

    // Criar lead a partir do remetente desconhecido, no primeiro estágio do funil escolhido.
    const created = (await db.query<{ r: { lead: string } }>("SELECT resolve_crm_email_inbox($1,'create',NULL,$2,'Novo Contato','Desconhecida') AS r", [r4.id, P])).rows[0].r;
    const nl = (await db.query<{ email: string; stage: string; pipeline_id: string; source: string }>("SELECT email,stage,pipeline_id,source FROM leads WHERE id=$1", [created.lead])).rows[0];
    assert.deepEqual(nl, { email: "novo@desconhecido.test", stage: "lead-novo", pipeline_id: P, source: "E-mail" });
    await assert.rejects(db.query("SELECT resolve_crm_email_inbox($1,'ignore',NULL,NULL,'','')", [r4.id]), /stale_inbox/, "já resolvido não muda de novo");

    const r5 = await inbox(db, { gmailId: "g5", from: "spam@x.test", subject: "Promo", body: "..." });
    await db.query("SELECT resolve_crm_email_inbox($1,'ignore',NULL,NULL,'','')", [r5.id]);
    assert.equal((await db.query<{ n: number }>("SELECT count(*)::int n FROM leads WHERE email='spam@x.test'")).rows[0].n, 0, "ignorar não cria lead");
  } finally { await db.close(); }
});

test("mensagem recebida do contato depois do envio suspende o próximo follow-up", async () => {
  const db = await setup();
  try {
    const f = await flow(db);
    await db.query("SELECT enroll_crm_email_flow($1,$2::uuid[])", [f.id, [A]]);
    const e = await enrollment(db, A);
    const m = (await reserve(db, e.id, 0)).rows[0].m;
    await db.query("SELECT finish_crm_email_flow_step($1,'accepted','p','')", [m]);
    await inbox(db, { gmailId: "g9", from: "ana@example.test", subject: "Re", body: "Me liga", receivedAt: new Date(Date.now() + 1000).toISOString() });
    await due(db, e.id);
    assert.equal((await reserve(db, e.id, 1)).rows[0].m, null);
    const after = await enrollment(db, A);
    assert.equal(after.status, "paused");
    assert.match(after.reason, /Mensagem recebida/);
  } finally { await db.close(); }
});

test("funções da caixa de entrada e do agente são exclusivas do servidor", async () => {
  const db = await setup();
  try {
    await db.exec("SET request.jwt.claim.role='authenticated'");
    await assert.rejects(db.query("SELECT set_crm_email_agent_enabled(true)"), /access_denied/);
    await assert.rejects(db.query("SELECT record_crm_email_inbox('{}'::jsonb,'{}'::text[])"), /access_denied/);
  } finally { await db.close(); }
});
