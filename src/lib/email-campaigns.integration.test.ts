import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const A = "00000000-0000-4000-8000-000000000001", B = "00000000-0000-4000-8000-000000000002", C = "00000000-0000-4000-8000-000000000003";

async function setup() {
  const db = new PGlite();
  await db.exec("CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'service_role')$$;CREATE TABLE leads(id uuid PRIMARY KEY,email text,whatsapp text);CREATE TABLE b2b_email_suppressions(email text PRIMARY KEY,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());");
  for (const f of ["0064_campaigns_private_drafts", "0065_campaign_consent_audit", "0086_campaign_email_delivery", "0094_campaign_email_without_consent_requirement"]) await db.exec(await readFile(`drizzle/migrations/${f}.sql`, "utf8"));
  await db.query("INSERT INTO leads VALUES($1,'Ana@Example.test',''),($2,'bia@example.test',''),($3,'caio@example.test','')", [A, B, C]);
  await db.query("SELECT save_crm_campaign_email_settings(0,$1::jsonb)", [JSON.stringify({ senderEmail: "contato@gravon.com.br", senderName: "Gravon", replyTo: "", timezone: "America/Sao_Paulo" })]);
  return db;
}
async function draft(db: PGlite, leadIds: string[], scheduledAt: string | null = null) {
  const payload = { name: "Campanha teste", channel: "email", subject: "Assunto", body: "Mensagem", leadIds, scheduledAt };
  return (await db.query<{ d: { id: string; revision: number; scheduled_at: string | null } }>("SELECT save_crm_campaign_draft(NULL,1,$1::jsonb) AS d", [JSON.stringify(payload)])).rows[0].d;
}
const claim = (db: PGlite, id: string, revision: number, recipients: unknown[], scheduledAt: string | null = null) =>
  db.query<{ r: { id: string; contact: string }[] }>("SELECT claim_crm_campaign_email($1,$2,$3::jsonb,$4,gen_random_uuid()) AS r", [id, revision, JSON.stringify(recipients), scheduledAt]);

test("reserva usa o e-mail do card sem exigir consentimento, bloqueia descadastro/bloqueio e impede envio duplicado", async () => {
  const db = await setup();
  try {
    await db.query("SELECT record_crm_campaign_consent($1,'email','ana@example.test','Formulário do site com opt-in',now() - interval '1 day',false)", [A]);
    await db.query("SELECT record_crm_campaign_consent($1,'email','bia@example.test','Opt-in em evento presencial',now(),false)", [B]);
    const c = await draft(db, [A, B, C]);
    // Sem consentimento registrado (C) o e-mail do card é aceito, sem criar consentimento.
    const free = await draft(db, [C]);
    assert.equal((await claim(db, free.id, free.revision, [{ lead_id: C, contact: "caio@example.test" }])).rows[0].r.length, 1);
    assert.equal((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM crm_campaign_permissions WHERE lead_id=$1", [C])).rows[0].n, 0);
    // Endereço repetido na mesma reserva é recusado.
    const dup = await draft(db, [A]);
    await assert.rejects(claim(db, dup.id, dup.revision, [{ lead_id: A, contact: "ana@example.test" }, { lead_id: A, contact: "ana@example.test" }]), /duplicate_recipient/);
    // Descadastro sem consentimento prévio também bloqueia.
    await db.query("INSERT INTO b2b_email_suppressions VALUES('caio@example.test','descadastro')");
    const again = await draft(db, [C]);
    await assert.rejects(claim(db, again.id, again.revision, [{ lead_id: C, contact: "caio@example.test" }]), /recipient_not_eligible/);
    await db.query("DELETE FROM b2b_email_suppressions");
    // Contato divergente do cadastro atual.
    await assert.rejects(claim(db, c.id, c.revision, [{ lead_id: A, contact: "outro@example.test" }]), /contact_changed/);
    // Bloqueio global vence o consentimento.
    await db.query("INSERT INTO b2b_email_suppressions VALUES('bia@example.test','bounce')");
    await assert.rejects(claim(db, c.id, c.revision, [{ lead_id: B, contact: "bia@example.test" }]), /recipient_not_eligible/);
    await db.query("DELETE FROM b2b_email_suppressions");
    // Lead fora da campanha não entra.
    const other = await draft(db, [B]);
    await assert.rejects(claim(db, other.id, other.revision, [{ lead_id: A, contact: "ana@example.test" }]), /recipient_not_selected/);
    // Revisão desatualizada não confirma.
    await assert.rejects(claim(db, c.id, c.revision + 1, [{ lead_id: A, contact: "ana@example.test" }]), /stale_or_locked/);

    const reserved = (await claim(db, c.id, c.revision, [{ lead_id: A, contact: "ana@example.test" }, { lead_id: B, contact: "bia@example.test" }])).rows[0].r;
    assert.equal(reserved.length, 2);
    assert.equal((await db.query<{ state: string }>("SELECT state FROM crm_campaigns WHERE id=$1", [c.id])).rows[0].state, "running");
    // Segunda confirmação (outra aba / clique duplo) é recusada: nada é reservado de novo.
    await assert.rejects(claim(db, c.id, c.revision, [{ lead_id: A, contact: "ana@example.test" }]), /stale_or_locked/);
    await assert.rejects(claim(db, c.id, c.revision + 1, [{ lead_id: A, contact: "ana@example.test" }]), /stale_or_locked/);
    // Rascunho em envio não pode ser editado nem cancelado como rascunho.
    await assert.rejects(db.query("SELECT save_crm_campaign_draft($1,$2,$3::jsonb)", [c.id, c.revision + 1, JSON.stringify({ name: "x1", channel: "email", leadIds: [] })]), /stale_or_locked/);
    assert.equal((await db.query<{ ok: boolean }>("SELECT cancel_crm_campaign($1,$2) AS ok", [c.id, c.revision + 1])).rows[0].ok, false);

    assert.equal((await db.query<{ ok: boolean }>("SELECT finish_crm_campaign_delivery($1,'accepted','<m1>','') AS ok", [reserved[0].id])).rows[0].ok, true);
    // Resultado só é gravado uma vez.
    assert.equal((await db.query<{ ok: boolean }>("SELECT finish_crm_campaign_delivery($1,'failed','','x') AS ok", [reserved[0].id])).rows[0].ok, false);
    assert.equal((await db.query<{ s: string }>("SELECT complete_crm_campaign_dispatch($1) AS s", [c.id])).rows[0].s, "running", "ainda há reserva pendente");
    await db.query("SELECT finish_crm_campaign_delivery($1,'unknown','','network_or_timeout')", [reserved[1].id]);
    assert.equal((await db.query<{ s: string }>("SELECT complete_crm_campaign_dispatch($1) AS s", [c.id])).rows[0].s, "completed");
    const events = (await db.query<{ kind: string; lead_id: string | null }>("SELECT kind,lead_id FROM crm_campaign_events WHERE campaign_id=$1", [c.id])).rows;
    assert.ok(events.some(e => e.kind === "accepted" && e.lead_id === A));
    assert.ok(events.some(e => e.kind === "unknown" && e.lead_id === B));

    // Descadastro posterior em qualquer lead bloqueia o contato em novas campanhas.
    await db.query("SELECT record_crm_campaign_consent($1,'email','ana@example.test','Descadastro',now(),true)", [A]);
    const next = await draft(db, [A]);
    await assert.rejects(claim(db, next.id, next.revision, [{ lead_id: A, contact: "ana@example.test" }]), /recipient_not_eligible/);
  } finally { await db.close(); }
});

test("agendamento valida a data salva, cancela no CRM só o que foi cancelado no provedor e recupera reservas sem reenviar", async () => {
  const db = await setup();
  try {
    await db.query("SELECT record_crm_campaign_consent($1,'email','ana@example.test','Formulário do site com opt-in',now(),false)", [A]);
    const when = new Date(Date.now() + 24 * 3600e3).toISOString();
    const c = await draft(db, [A], when);
    await assert.rejects(claim(db, c.id, c.revision, [{ lead_id: A, contact: "ana@example.test" }], new Date(Date.now() + 48 * 3600e3).toISOString()), /schedule_changed/);
    const past = await draft(db, [A], new Date(Date.now() - 60e3).toISOString());
    await assert.rejects(claim(db, past.id, past.revision, [{ lead_id: A, contact: "ana@example.test" }], past.scheduled_at), /schedule_past/);
    const [d] = (await claim(db, c.id, c.revision, [{ lead_id: A, contact: "ana@example.test" }], c.scheduled_at)).rows[0].r;
    assert.equal((await db.query<{ state: string }>("SELECT state FROM crm_campaigns WHERE id=$1", [c.id])).rows[0].state, "scheduled");
    await db.query("SELECT finish_crm_campaign_delivery($1,'scheduled','<m>','')", [d.id]);
    assert.equal((await db.query<{ s: string }>("SELECT complete_crm_campaign_dispatch($1) AS s", [c.id])).rows[0].s, "scheduled");
    // Cancelamento genérico não pode descartar um agendamento já entregue ao provedor.
    assert.equal((await db.query<{ ok: boolean }>("SELECT cancel_crm_campaign($1,$2) AS ok", [c.id, c.revision + 1])).rows[0].ok, false);
    const partial = (await db.query<{ r: { remaining: number } }>("SELECT cancel_crm_campaign_schedule($1,$2,$3::uuid[]) AS r", [c.id, c.revision + 1, []])).rows[0].r;
    assert.equal(partial.remaining, 1);
    const done = (await db.query<{ r: { remaining: number } }>("SELECT cancel_crm_campaign_schedule($1,$2,$3::uuid[]) AS r", [c.id, c.revision + 1, [d.id]])).rows[0].r;
    assert.equal(done.remaining, 0);
    assert.equal((await db.query<{ state: string }>("SELECT state FROM crm_campaigns WHERE id=$1", [c.id])).rows[0].state, "cancelled");

    // Reserva órfã (processo interrompido) vira desconhecida, nunca volta a "reservada".
    const crash = await draft(db, [A]);
    const [orphan] = (await claim(db, crash.id, crash.revision, [{ lead_id: A, contact: "ana@example.test" }])).rows[0].r;
    await db.query("UPDATE crm_campaign_deliveries SET created_at=now()-interval '1 hour' WHERE id=$1", [orphan.id]);
    await db.query("SELECT settle_crm_campaigns()");
    assert.equal((await db.query<{ state: string }>("SELECT state FROM crm_campaign_deliveries WHERE id=$1", [orphan.id])).rows[0].state, "unknown");
    assert.equal((await db.query<{ state: string }>("SELECT state FROM crm_campaigns WHERE id=$1", [crash.id])).rows[0].state, "completed");
  } finally { await db.close(); }
});

test("testes só para endereço próprio autorizado, com limite atômico; tabelas permanecem privadas", async () => {
  const db = await setup();
  try {
    await db.query("SELECT record_crm_campaign_test_recipient('Eu@Gravon.com.br','Meu e-mail','Endereço próprio confirmado no CRM','admin@gravon.com.br',false)");
    const id = (await db.query<{ id: string; email: string }>("SELECT id,email FROM crm_campaign_test_recipients")).rows[0];
    assert.equal(id.email, "eu@gravon.com.br");
    for (let i = 0; i < 2; i++) assert.equal((await db.query<{ e: string }>("SELECT reserve_crm_campaign_test($1,NULL,2,600) AS e", [id.id])).rows[0].e, "eu@gravon.com.br");
    await assert.rejects(db.query("SELECT reserve_crm_campaign_test($1,NULL,2,600)", [id.id]), /test_rate_limited/);
    await db.query("SELECT finish_crm_campaign_test($1,NULL,'accepted','<t>','')", [id.id]);
    await db.query("SELECT record_crm_campaign_test_recipient('eu@gravon.com.br','x','Revogação manual','CRM',true)");
    await assert.rejects(db.query("SELECT reserve_crm_campaign_test($1,NULL,10,600)", [id.id]), /test_recipient_not_authorized/);
    await db.query("INSERT INTO b2b_email_suppressions VALUES('bloq@gravon.com.br','descadastro')");
    await assert.rejects(db.query("SELECT record_crm_campaign_test_recipient('bloq@gravon.com.br','Bloqueado','Endereço próprio confirmado no CRM','admin',false)"), /suppressed_contact/);
    // Configuração com revisão desatualizada é recusada.
    await assert.rejects(db.query("SELECT save_crm_campaign_email_settings(0,$1::jsonb)", [JSON.stringify({ senderEmail: "x@y.com", senderName: "X", timezone: "UTC" })]), /stale_settings/);
    for (const table of ["crm_campaign_email_settings", "crm_campaign_test_recipients", "crm_campaign_deliveries"]) for (const role of ["anon", "authenticated"])
      assert.equal((await db.query<{ ok: boolean }>("SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') AS ok", [role, table])).rows[0].ok, false);
    assert.equal((await db.query<{ ok: boolean }>("SELECT has_table_privilege('service_role','crm_campaign_deliveries','INSERT,UPDATE,DELETE') AS ok")).rows[0].ok, false, "escrita só via RPC");
    await db.exec("SET request.jwt.claim.role='authenticated'");
    await assert.rejects(db.query("SELECT settle_crm_campaigns()"), /access_denied/);
    await assert.rejects(db.query("SELECT reserve_crm_campaign_test($1,NULL,10,600)", [id.id]), /access_denied/);
  } finally { await db.close(); }
});

test("0086 aplica depois das migrações da main (0083–0085) sem alterar dados do Agente Comercial", async () => {
  const { referenceDb } = await import("./crm-agent-test-db");
  const db = await referenceDb(); // já contém 0083
  try {
    for (const f of ["0084_crm_commercial_agent", "0085_crm_reference_messages"]) await db.exec(await readFile(`drizzle/migrations/${f}.sql`, "utf8"));
    await db.exec("ALTER TABLE leads ADD COLUMN email text DEFAULT '';CREATE TABLE b2b_email_suppressions(email text PRIMARY KEY,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());");
    const agentBefore = JSON.stringify((await db.query("SELECT count(*) FROM pg_proc WHERE proname LIKE '%crm_agent%'")).rows);
    for (const f of ["0064_campaigns_private_drafts", "0065_campaign_consent_audit", "0086_campaign_email_delivery", "0094_campaign_email_without_consent_requirement"]) await db.exec(await readFile(`drizzle/migrations/${f}.sql`, "utf8"));
    assert.equal(JSON.stringify((await db.query("SELECT count(*) FROM pg_proc WHERE proname LIKE '%crm_agent%'")).rows), agentBefore);
    await db.query("INSERT INTO leads(id,name,email) VALUES($1,'Ana','ana@example.test')", [A]);
    await db.query("SELECT save_crm_campaign_email_settings(0,$1::jsonb)", [JSON.stringify({ senderEmail: "contato@gravon.com.br", senderName: "Gravon", replyTo: "", timezone: "America/Sao_Paulo" })]);
    await db.query("SELECT record_crm_campaign_consent($1,'email','ana@example.test','Formulário do site com opt-in',now(),false)", [A]);
    const c = await draft(db, [A]);
    // O gatilho de revisão de leads (Agente Comercial) não interfere na reserva.
    const reserved = (await claim(db, c.id, c.revision, [{ lead_id: A, contact: "ana@example.test" }])).rows[0].r;
    assert.equal(reserved.length, 1);
    assert.equal((await db.query<{ n: number }>("SELECT gravon_change_revision AS n FROM leads WHERE id=$1", [A])).rows[0].n, 0, "reserva não altera o lead");
  } finally { await db.close(); }
});
