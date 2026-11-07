import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { compileAutomation, defaultAutomationGraph, manualAutomationGraph } from "./automations";

// Banco descartável: migrações reais de campanhas, fluxos (0095/0096) e automações (0109). Nenhum envio real.
const P = "00000000-0000-4000-8000-0000000000aa", Q = "00000000-0000-4000-8000-0000000000bb";

async function migration(prefix: string) {
  const file = (await readdir("drizzle/migrations")).find((f) => f.startsWith(prefix) && f.endsWith(".sql"));
  if (!file) throw new Error(`migração ${prefix} ausente`);
  return readFile(`drizzle/migrations/${file}`, "utf8");
}

async function setup() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
   CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'service_role')$$;
   CREATE TABLE leads(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL DEFAULT '',company text NOT NULL DEFAULT '',source text NOT NULL DEFAULT '',
    email text NOT NULL DEFAULT '',whatsapp text,stage text NOT NULL DEFAULT 'lead-novo',status text NOT NULL DEFAULT '',tags jsonb NOT NULL DEFAULT '[]',
    utm_content text NOT NULL DEFAULT '',pipeline_id uuid,history jsonb NOT NULL DEFAULT '[]',created_at timestamptz NOT NULL DEFAULT clock_timestamp());
   CREATE TABLE sales_pipelines(id uuid PRIMARY KEY,name text,stages jsonb,archived boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now());
   CREATE TABLE b2b_companies(cnpj text PRIMARY KEY,lead_id uuid UNIQUE);
   CREATE TABLE b2b_email_suppressions(email text PRIMARY KEY,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());`);
  for (const f of ["0064_", "0065_", "0086_", "0094_", "0095_", "0096_", "0109_", "0110_", "0111_", "0113_", "0114_"]) await db.exec(await migration(f));
  const stages = ["lead-novo", "tentando-contato", "contato-realizado", "qualificacao", "fechado"].map((id) => ({ id, title: id }));
  await db.query("INSERT INTO sales_pipelines(id,name,stages) VALUES($1,'Outbound',$2::jsonb),($3,'Principal',$2::jsonb)", [P, JSON.stringify(stages), Q]);
  await db.query("SELECT save_crm_campaign_email_settings(0,$1::jsonb)", [JSON.stringify({ senderEmail: "contato@gravon.com.br", senderName: "Gravon", replyTo: "", timezone: "America/Sao_Paulo" })]);
  await db.query("UPDATE crm_email_flow_runner SET agent_enabled=true");
  return db;
}

type Auto = { id: string; revision: number; state: string; flow_id: string };
async function automation(db: PGlite, tests: string[] = []) {
  const c = compileAutomation(defaultAutomationGraph(P));
  if (!c.ok) throw new Error(c.errors.join());
  const a = (await db.query<{ a: Auto }>("SELECT save_crm_automation(NULL,0,'Outbound diagnóstico',$1::jsonb,$2::jsonb,true,$3,'https://gravoncompany.com/diagnostico',$4::text[],'outbound') AS a",
    [JSON.stringify(defaultAutomationGraph(P)), JSON.stringify(c.compiled), P, tests])).rows[0].a;
  return a;
}
const setState = async (db: PGlite, a: Auto, state: string, approve = true) =>
  (await db.query<{ a: Auto }>("SELECT set_crm_automation_state($1,$2,$3,$4) AS a", [a.id, a.revision, state, approve])).rows[0].a;
const addLead = async (db: PGlite, email: string, pipeline: string | null = P, extra = "") =>
  (await db.query<{ id: string }>(`INSERT INTO leads(name,email,pipeline_id${extra ? ",utm_content" : ""}) VALUES('Contato',$1,$2${extra ? ",$3" : ""}) RETURNING id`, extra ? [email, pipeline, extra] : [email, pipeline])).rows[0].id;
const run = async (db: PGlite, leadId: string) => (await db.query<{ id: string; token: string; enrollment_id: string; reply_at: string | null; form_at: string | null; finished_at: string | null }>("SELECT * FROM crm_automation_runs WHERE lead_id=$1", [leadId])).rows[0];
const enr = async (db: PGlite, id: string) => (await db.query<{ status: string; next_step: number; next_send_at: string | null; reason: string }>("SELECT * FROM crm_email_flow_enrollments WHERE id=$1", [id])).rows[0];
const lead = async (db: PGlite, id: string) => (await db.query<{ stage: string; status: string; tags: string[]; history: { text: string }[] }>("SELECT * FROM leads WHERE id=$1", [id])).rows[0];

test("nasce desligada: card que entra no funil não é inscrito", async () => {
  const db = await setup();
  try {
    const a = await automation(db);
    assert.equal(a.state, "draft");
    const flow = (await db.query<{ state: string; automation_id: string; max_messages: number; ai_approved_revision: number | null }>("SELECT * FROM crm_email_flows WHERE id=$1", [a.flow_id])).rows[0];
    assert.equal(flow.state, "draft"); assert.equal(flow.automation_id, a.id); assert.equal(flow.max_messages, 5); assert.equal(flow.ai_approved_revision, null);
    const l = await addLead(db, "ana@example.test");
    await db.query("SELECT process_crm_automation_entries(50)");
    assert.equal(await run(db, l), undefined);
  } finally { await db.close(); }
});

test("ligar exige aprovação da IA; modo teste só inscreve os e-mails de teste", async () => {
  const db = await setup();
  try {
    const a = await automation(db, ["teste@gravon.test"]);
    await assert.rejects(setState(db, a, "test", false), /ai_not_approved/);
    const t = await setState(db, a, "test");
    assert.equal(t.state, "test");
    const fora = await addLead(db, "cliente@empresa.test");
    const teste = await addLead(db, "teste@gravon.test");
    await db.query("SELECT process_crm_automation_entries(50)");
    assert.equal(await run(db, fora), undefined, "cliente real não entra no teste");
    const r = await run(db, teste);
    assert.ok(r && /^[0-9a-f]{32}$/.test(r.token));
    const e = await enr(db, r.enrollment_id);
    assert.equal(e.status, "active");
    assert.ok(e.next_send_at && Date.parse(e.next_send_at) <= Date.now() + 1000, "1º e-mail no dia 1");
    // Uma vez por card: reentrada não duplica.
    const again = (await db.query<{ r: { ok: boolean; reason: string } }>("SELECT start_crm_automation_run($1,$2,'test') AS r", [a.id, teste])).rows[0].r;
    assert.equal(again.ok, false);
    assert.equal((await db.query("SELECT 1 FROM crm_automation_runs")).rows.length, 1);
  } finally { await db.close(); }
});

test("card que entrou antes de ligar não dispara; outro funil não dispara", async () => {
  const db = await setup();
  try {
    let a = await automation(db);
    a = await setState(db, a, "active");
    const antes = await addLead(db, "antes@empresa.test");
    await db.query("UPDATE crm_automation_entries SET entered_at = now() - interval '1 hour'");
    const outro = await addLead(db, "outro@empresa.test", Q);
    await db.query("SELECT process_crm_automation_entries(50)");
    assert.equal(await run(db, antes), undefined);
    assert.equal(await run(db, outro), undefined);
    // Card movido para o Outbound depois de ligar dispara.
    await db.query("UPDATE leads SET pipeline_id=$1 WHERE id=$2", [P, outro]);
    await db.query("SELECT process_crm_automation_entries(50)");
    assert.ok(await run(db, outro));
  } finally { await db.close(); }
});

test("intervalos: depois do 1º envio, o 2º fica para 2 dias; resposta pausa e aplica as ações do caminho Sim", async () => {
  const db = await setup();
  try {
    let a = await automation(db); a = await setState(db, a, "active");
    const l = await addLead(db, "ana@example.test");
    await db.query("SELECT process_crm_automation_entries(50)");
    const r = await run(db, l);
    const m = (await db.query<{ m: string }>("SELECT reserve_crm_email_flow_step($1,0,'Assunto','Corpo',false) AS m", [r.enrollment_id])).rows[0].m;
    await db.query("SELECT finish_crm_email_flow_step($1,'accepted','x','')", [m]);
    const e = await enr(db, r.enrollment_id);
    assert.equal(e.next_step, 1);
    const hrs = (Date.parse(e.next_send_at!) - Date.now()) / 3600e3;
    assert.ok(hrs > 47 && hrs <= 48.1, `2º e-mail ~48h depois (${hrs.toFixed(1)}h)`);
    // Duplicidade: a mesma etapa não é reservada duas vezes.
    await assert.rejects(db.query("SELECT reserve_crm_email_flow_step($1,0,'Assunto','Corpo',false)", [r.enrollment_id]));
    await db.query("SELECT record_crm_email_flow_reply($1,'g1','','Re','Tenho interesse',false)", [r.enrollment_id]);
    await db.query("SELECT settle_crm_automation_runs()");
    assert.ok((await run(db, l)).reply_at);
    const c = await lead(db, l);
    assert.equal(c.stage, "contato-realizado");
    assert.equal(c.status, "Respondeu o e-mail da automação");
    await assert.rejects(db.query("SELECT reserve_crm_email_flow_step($1,1,'A','B',false)", [r.enrollment_id]), /not_due/);
    await db.query("SELECT settle_crm_automation_runs()");
    assert.equal((await db.query("SELECT 1 FROM crm_automation_events WHERE kind='reply'")).rows.length, 1, "resposta registrada uma vez");
  } finally { await db.close(); }
});

test("formulário (mesmo e-mail ou link) encerra a sequência e move o card para Qualificação", async () => {
  const db = await setup();
  try {
    let a = await automation(db); a = await setState(db, a, "active");
    const l1 = await addLead(db, "ana@example.test"), l2 = await addLead(db, "bia@example.test");
    await db.query("SELECT process_crm_automation_entries(50)");
    const r1 = await run(db, l1), r2 = await run(db, l2);
    await addLead(db, "ANA@example.test ", Q);
    await addLead(db, "outro-endereco@empresa.test", Q, `pf-${r2.token}`);
    assert.equal((await db.query<{ n: number }>("SELECT detect_crm_automation_forms() AS n")).rows[0].n, 2);
    for (const [r, l] of [[r1, l1], [r2, l2]] as const) {
      assert.equal((await enr(db, r.enrollment_id)).status, "stopped");
      const c = await lead(db, l);
      assert.equal(c.stage, "qualificacao");
      assert.deepEqual(c.tags, ["quente"]);
    }
    assert.equal((await db.query<{ n: number }>("SELECT detect_crm_automation_forms() AS n")).rows[0].n, 0, "não reaplica");
  } finally { await db.close(); }
});

test("etapa nunca retrocede nem vai para Fechado; pausar/retomar/cancelar no card", async () => {
  const db = await setup();
  try {
    let a = await automation(db); a = await setState(db, a, "active");
    const l = await addLead(db, "ana@example.test");
    await db.query("SELECT process_crm_automation_entries(50)");
    const r = await run(db, l);
    await db.query("UPDATE leads SET stage='qualificacao' WHERE id=$1", [l]);
    await db.query("SELECT crm_automation_apply_actions($1,$2,'{\"stage\":\"contato-realizado\",\"tag\":\"\",\"status\":\"\"}'::jsonb,'x',$3,$4)", [l, P, r.id, a.id]);
    assert.equal((await lead(db, l)).stage, "qualificacao");
    await db.query("SELECT crm_automation_apply_actions($1,$2,'{\"stage\":\"fechado\",\"tag\":\"\",\"status\":\"\"}'::jsonb,'x',$3,$4)", [l, P, r.id, a.id]);
    assert.equal((await lead(db, l)).stage, "qualificacao");
    assert.equal((await db.query<{ ok: boolean }>("SELECT set_crm_automation_run($1,'pause') AS ok", [r.id])).rows[0].ok, true);
    assert.equal((await enr(db, r.enrollment_id)).status, "paused");
    assert.equal((await db.query<{ ok: boolean }>("SELECT set_crm_automation_run($1,'send_now') AS ok", [r.id])).rows[0].ok, false, "antecipar só em testes");
    await db.query("SELECT set_crm_automation_run($1,'resume')", [r.id]);
    assert.equal((await enr(db, r.enrollment_id)).status, "active");
    await db.query("SELECT set_crm_automation_run($1,'cancel')", [r.id]);
    assert.equal((await enr(db, r.enrollment_id)).status, "stopped");
    assert.equal((await db.query<{ ok: boolean }>("SELECT set_crm_automation_run($1,'resume') AS ok", [r.id])).rows[0].ok, false);
  } finally { await db.close(); }
});

test("descadastrado não entra; editar exige pausar; clique registra e devolve a landing", async () => {
  const db = await setup();
  try {
    let a = await automation(db); a = await setState(db, a, "active");
    await db.query("INSERT INTO b2b_email_suppressions VALUES('saiu@empresa.test','pediu')");
    const s = await addLead(db, "saiu@empresa.test");
    const l = await addLead(db, "ana@example.test");
    await db.query("SELECT process_crm_automation_entries(50)");
    assert.equal(await run(db, s), undefined);
    await assert.rejects(db.query("SELECT save_crm_automation($1,$2,'x','{}'::jsonb,'{}'::jsonb,false,$3,'',ARRAY[]::text[],'')", [a.id, a.revision, P]), /pause_first/);
    const r = await run(db, l);
    const c = (await db.query<{ c: { url: string } | null }>("SELECT record_crm_automation_click($1) AS c", [r.token])).rows[0].c;
    assert.equal(c?.url, "https://gravoncompany.com/diagnostico");
    assert.equal((await db.query<{ c: unknown }>("SELECT record_crm_automation_click('ffffffffffffffffffffffffffffffff') AS c")).rows[0].c, null);
    const p = await setState(db, a, "paused");
    const flow = (await db.query<{ state: string }>("SELECT state FROM crm_email_flows WHERE id=$1", [p.flow_id])).rows[0];
    assert.equal(flow.state, "paused");
  } finally { await db.close(); }
});

test("cadência concluída sem resposta aplica a ação final só depois da última espera", async () => {
  const db = await setup();
  try {
    let a = await automation(db); a = await setState(db, a, "active");
    const l = await addLead(db, "ana@example.test");
    await db.query("SELECT process_crm_automation_entries(50)");
    const r = await run(db, l);
    await db.query("UPDATE crm_email_flow_enrollments SET status='finished', next_step=5, reason='Sequência concluída sem resposta', last_sent_at=now() - interval '1 day' WHERE id=$1", [r.enrollment_id]);
    await db.query("SELECT settle_crm_automation_runs()");
    assert.equal((await run(db, l)).finished_at, null, "ainda dentro da espera final de 3 dias");
    await db.query("UPDATE crm_email_flow_enrollments SET last_sent_at=now() - interval '73 hours' WHERE id=$1", [r.enrollment_id]);
    await db.query("SELECT settle_crm_automation_runs()");
    assert.ok((await run(db, l)).finished_at);
    assert.equal((await lead(db, l)).status, "Cadência de e-mail concluída sem resposta");
  } finally { await db.close(); }
});

test("1º e-mail aceito move para Tentando Contato sem parar a cadência; resposta move para Contato Realizado", async () => {
  const db = await setup();
  try {
    let a = await automation(db); a = await setState(db, a, "active");
    const l = await addLead(db, "ana@example.test");
    await db.query("SELECT process_crm_automation_entries(50)");
    const r = await run(db, l);
    assert.equal((await lead(db, l)).stage, "lead-novo", "card criado fica em Lead Novo");
    const m = (await db.query<{ m: string }>("SELECT reserve_crm_email_flow_step($1,0,'Assunto','Corpo',false) AS m", [r.enrollment_id])).rows[0].m;
    assert.equal((await lead(db, l)).stage, "lead-novo", "reservar não move: só o envio aceito");
    await db.query("SELECT finish_crm_email_flow_step($1,'accepted','x','')", [m]);
    const c = await lead(db, l);
    assert.equal(c.stage, "tentando-contato");
    const e = await enr(db, r.enrollment_id);
    assert.equal(e.status, "active", "a cadência continua depois do Atualizar card");
    assert.equal(e.next_step, 1);
    const kinds = (await db.query<{ kind: string }>("SELECT kind FROM crm_automation_events WHERE run_id=$1 ORDER BY created_at", [r.id])).rows.map((x) => x.kind);
    assert.deepEqual(kinds.filter((k) => k !== "enrolled"), ["sent", "card_updated"]);
    // Sem resposta: 2º e-mail segue normalmente e o card continua em Tentando Contato.
    await db.query("UPDATE crm_email_flow_enrollments SET next_send_at=now() WHERE id=$1", [r.enrollment_id]);
    const m2 = (await db.query<{ m: string }>("SELECT reserve_crm_email_flow_step($1,1,'A2','B2',true) AS m", [r.enrollment_id])).rows[0].m;
    await db.query("SELECT finish_crm_email_flow_step($1,'accepted','y','')", [m2]);
    assert.equal((await lead(db, l)).stage, "tentando-contato");
    assert.equal((await enr(db, r.enrollment_id)).next_step, 2);
    // Resposta: Contato Realizado e a cadência para.
    await db.query("SELECT record_crm_email_flow_reply($1,'g1','','Re','Tenho interesse',false)", [r.enrollment_id]);
    await db.query("SELECT settle_crm_automation_runs()");
    assert.equal((await lead(db, l)).stage, "contato-realizado");
    await assert.rejects(db.query("SELECT reserve_crm_email_flow_step($1,2,'A','B',false)", [r.enrollment_id]), /not_due/);
  } finally { await db.close(); }
});

test("falha e bloqueio do envio ficam no histórico do card e nada é reenviado", async () => {
  const db = await setup();
  try {
    let a = await automation(db); a = await setState(db, a, "active");
    const l1 = await addLead(db, "ana@example.test"), l2 = await addLead(db, "bia@example.test");
    await db.query("SELECT process_crm_automation_entries(50)");
    const r1 = await run(db, l1), r2 = await run(db, l2);
    const m = (await db.query<{ m: string }>("SELECT reserve_crm_email_flow_step($1,0,'Assunto','Corpo',false) AS m", [r1.enrollment_id])).rows[0].m;
    await db.query("SELECT finish_crm_email_flow_step($1,'failed','','invalid_parameter')", [m]);
    assert.equal((await enr(db, r1.enrollment_id)).status, "paused");
    assert.equal((await lead(db, l1)).stage, "lead-novo", "falha não move o card");
    assert.match((await lead(db, l1)).history.map((h) => h.text).join("\n"), /recusado pela Brevo \(invalid_parameter\)/);
    await assert.rejects(db.query("SELECT reserve_crm_email_flow_step($1,0,'Assunto','Corpo',false)", [r1.enrollment_id]), /not_due/);
    // E-mail do card mudou: bloqueia e registra.
    await db.query("UPDATE leads SET email='novo@empresa.test' WHERE id=$1", [l2]);
    assert.equal((await db.query<{ m: string | null }>("SELECT reserve_crm_email_flow_step($1,0,'Assunto','Corpo',false) AS m", [r2.enrollment_id])).rows[0].m, null);
    assert.equal((await db.query("SELECT 1 FROM crm_automation_events WHERE run_id=$1 AND kind='blocked'", [r2.id])).rows.length, 1);
    assert.match((await lead(db, l2)).history.map((h) => h.text).join("\n"), /envios pausados — E-mail do card mudou/);
    // Pausa manual não gera bloqueio duplicado.
    await db.query("SELECT set_crm_automation_run($1,'resume')", [r2.id]).catch(() => undefined);
    assert.equal((await db.query("SELECT 1 FROM crm_automation_events WHERE kind='blocked'")).rows.length, 1);
  } finally { await db.close(); }
});

test("início manual: card que entra no funil não dispara; só os selecionados entram; sem cadências simultâneas", async () => {
  const db = await setup();
  try {
    const original = await setState(db, await automation(db), "paused").catch(() => null);
    const g = manualAutomationGraph(P);
    const c = compileAutomation(g); if (!c.ok) throw new Error(c.errors.join());
    assert.equal(c.compiled.triggerMode, "manual");
    let m = (await db.query<{ a: Auto & { trigger_mode: string } }>("SELECT save_crm_automation(NULL,0,'Manual',$1::jsonb,$2::jsonb,true,$3,'https://gravoncompany.com/diagnostico',ARRAY['teste@gravon.test']::text[],'manual') AS a",
      [JSON.stringify(g), JSON.stringify(c.compiled), P])).rows[0].a;
    assert.equal(m.trigger_mode, "manual");
    m = { ...(await setState(db, m, "test")), trigger_mode: "manual" };
    const teste = await addLead(db, "teste@gravon.test"), real = await addLead(db, "cliente@empresa.test");
    await db.query("SELECT process_crm_automation_entries(50)");
    assert.equal(await run(db, teste), undefined, "início manual não dispara pela entrada no funil");
    const start = async (lead: string) => (await db.query<{ r: { ok: boolean; reason?: string } }>("SELECT start_crm_automation_run($1,$2,'manual') AS r", [m.id, lead])).rows[0].r;
    assert.equal((await start(real)).ok, false, "em teste, contato real não entra");
    assert.equal((await start(teste)).ok, true);
    assert.equal((await start(teste)).ok, false, "sem duplicidade no mesmo card");
    // Outra automação manual com o mesmo contato ativo: bloqueada pela sequência em andamento.
    let m2 = (await db.query<{ a: Auto }>("SELECT save_crm_automation(NULL,0,'Manual 2',$1::jsonb,$2::jsonb,true,$3,'https://gravoncompany.com/diagnostico',ARRAY['teste@gravon.test']::text[],'manual-2') AS a",
      [JSON.stringify(g), JSON.stringify(c.compiled), P])).rows[0].a;
    m2 = await setState(db, m2, "test");
    const r2 = (await db.query<{ r: { ok: boolean; reason: string } }>("SELECT start_crm_automation_run($1,$2,'manual') AS r", [m2.id, teste])).rows[0].r;
    assert.equal(r2.ok, false); assert.match(r2.reason, /outra sequência/);
    assert.equal(original === null || original.state === "paused", true);
  } finally { await db.close(); }
});
