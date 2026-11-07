import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { compileAutomation, defaultAutomationGraph } from "./automations";
import { apiKeyFromHeaders, hashApiKey, newApiKey, normalizeDiagnosis } from "./api-keys";
import { prepareDiagnosisMessage } from "./diagnosis-automation";

// Banco descartável com as migrações reais de fluxos, automações e da API de diagnóstico. Nenhum envio real.
const P = "00000000-0000-4000-8000-0000000000aa", Q = "00000000-0000-4000-8000-0000000000bb";

async function migration(prefix: string) {
  const file = (await readdir("drizzle/migrations")).find((f) => f.startsWith(prefix) && f.endsWith(".sql"));
  if (!file) throw new Error(`migração ${prefix} ausente`);
  return readFile(`drizzle/migrations/${file}`, "utf8");
}

async function setup(diagnosis = false) {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
   CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'service_role')$$;
   CREATE TABLE leads(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL DEFAULT '',company text NOT NULL DEFAULT '',source text NOT NULL DEFAULT '',
    email text NOT NULL DEFAULT '',whatsapp text NOT NULL DEFAULT '',stage text NOT NULL DEFAULT 'lead-novo',status text NOT NULL DEFAULT '',tags jsonb NOT NULL DEFAULT '[]',
    utm_content text NOT NULL DEFAULT '',pipeline_id uuid,history jsonb NOT NULL DEFAULT '[]',created_at timestamptz NOT NULL DEFAULT clock_timestamp());
   CREATE TABLE sales_pipelines(id uuid PRIMARY KEY,name text,stages jsonb,archived boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now());
   CREATE TABLE b2b_companies(cnpj text PRIMARY KEY,lead_id uuid UNIQUE);
   CREATE TABLE b2b_email_suppressions(email text PRIMARY KEY,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
   CREATE FUNCTION public.crm_phone_key(p text) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
   DECLARE d text := regexp_replace(split_part(coalesce(p,''),'@',1),'[^0-9]','','g'); BEGIN
    IF length(d)>=12 AND left(d,2)='55' THEN d:=substr(d,3); END IF;
    IF length(d)<10 THEN RETURN right(d,8); END IF;
    RETURN left(d,2)||right(d,8);
   END $$;`);
  for (const f of ["0064_", "0065_", "0086_", "0094_", "0095_", "0096_", "0109_", "0110_", "0111_", "0112_crm_api_keys"]) await db.exec(await migration(f));
  if (diagnosis) {
    await db.exec(`CREATE TABLE portal_admin_channels(user_id uuid,company_key text,instance text,canonical_phone text);
      CREATE FUNCTION commercial_knowledge_access(uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
      CREATE FUNCTION first_contact_number(text) RETURNS text LANGUAGE sql AS $$ SELECT CASE WHEN $1 ~ '^55[1-9][0-9]9[6-9][0-9]{7}$' THEN left($1,4)||substring($1,6) ELSE $1 END $$;
      CREATE TABLE whatsapp_messages(message_id text PRIMARY KEY,instance text,phone text,remote_jid text,phone_key text,from_me boolean,body text,sent_at timestamptz,send_state text,accepted_at timestamptz);
      CREATE TABLE gravon_outbound_reservations(inbound_id text UNIQUE,instance text,remote_jid text,body text,state text DEFAULT 'sending',provider_id text);`);
    await db.exec(await migration("0116_"));
  }
  const stages = ["lead-novo", "tentando-contato", "contato-realizado", "qualificacao", "fechado"].map((id) => ({ id, title: id }));
  await db.query("INSERT INTO sales_pipelines(id,name,stages) VALUES($1,'Outbound',$2::jsonb),($3,'Principal',$2::jsonb)", [P, JSON.stringify(stages), Q]);
  await db.query("SELECT save_crm_campaign_email_settings(0,$1::jsonb)", [JSON.stringify({ senderEmail: "contato@gravon.com.br", senderName: "Gravon", replyTo: "", timezone: "America/Sao_Paulo" })]);
  const c = compileAutomation(defaultAutomationGraph(P));
  if (!c.ok) throw new Error(c.errors.join());
  let a = (await db.query<{ a: { id: string; revision: number } }>("SELECT save_crm_automation(NULL,0,'Outbound',$1::jsonb,$2::jsonb,true,$3,'https://gravoncompany.com/diagnostico','{}'::text[],'outbound') AS a",
    [JSON.stringify(defaultAutomationGraph(P)), JSON.stringify(c.compiled), P])).rows[0].a;
  a = (await db.query<{ a: { id: string; revision: number } }>("SELECT set_crm_automation_state($1,$2,'active',true) AS a", [a.id, a.revision])).rows[0].a;
  const key = newApiKey();
  await db.query("INSERT INTO crm_api_keys(name,prefix,key_hash) VALUES('Zapier',$1,$2)", [key.slice(0, 12), await hashApiKey(key)]);
  return { db, key };
}

const addLead = async (db: PGlite, email: string, pipeline: string = P, whatsapp = "") =>
  (await db.query<{ id: string }>("INSERT INTO leads(name,email,pipeline_id,whatsapp) VALUES('Contato',$1,$2,$3) RETURNING id", [email, pipeline, whatsapp])).rows[0].id;
type R = { ok?: boolean; error?: string; duplicate?: boolean; outcome?: string; lead_id?: string | null; paused?: number };
const receive = async (db: PGlite, key: string, f: { event: string; email?: string; whatsapp?: string; utm?: string; objective?: string }) =>
  (await db.query<{ r: R }>("SELECT receive_crm_diagnosis($1,$2,'Ana','Clínica',$3,$4,$5,$6) AS r",
    [await hashApiKey(key), f.event, f.email ?? "", f.whatsapp ?? "", f.objective ?? "Mais pacientes", f.utm ?? ""])).rows[0].r;
const enrollmentOf = async (db: PGlite, lead: string) => (await db.query<{ status: string; next_send_at: string | null }>("SELECT * FROM crm_email_flow_enrollments WHERE lead_id=$1", [lead])).rows[0];
const historyOf = async (db: PGlite, lead: string) => (await db.query<{ history: { id: string; text: string }[] }>("SELECT history FROM leads WHERE id=$1", [lead])).rows[0].history;

test("chave ausente na base ou revogada é recusada e nada é registrado", async () => {
  const { db, key } = await setup();
  try {
    assert.equal((await receive(db, newApiKey(), { event: "e1", email: "a@x.test" })).error, "unauthorized");
    await db.query("UPDATE crm_api_keys SET revoked_at=now()");
    assert.equal((await receive(db, key, { event: "e1", email: "a@x.test" })).error, "unauthorized");
    assert.equal((await db.query("SELECT 1 FROM crm_diagnosis_submissions")).rows.length, 0);
  } finally { await db.close(); }
});

test("contato único no Outbound: registra o diagnóstico, pausa a sequência; mesmo event_id não repete", async () => {
  const { db, key } = await setup();
  try {
    const l = await addLead(db, "ana@clinica.test");
    await db.query("SELECT process_crm_automation_entries(50)");
    assert.equal((await enrollmentOf(db, l)).status, "active");
    const r = await receive(db, key, { event: "zap-1", email: " ANA@clinica.test " });
    assert.deepEqual([r.outcome, r.lead_id, r.paused, r.duplicate], ["matched", l, 1, false]);
    const e = await enrollmentOf(db, l);
    assert.equal(e.status, "paused"); assert.equal(e.next_send_at, null);
    const h = await historyOf(db, l);
    assert.equal(h.filter((x) => x.id.startsWith("diagnosis:")).length, 1);
    assert.match(h.at(-1)?.text ?? "", /Objetivo comercial: Mais pacientes/);
    assert.equal((await db.query("SELECT 1 FROM crm_automation_events WHERE kind='form'")).rows.length, 1);
    const again = await receive(db, key, { event: "zap-1", email: "ana@clinica.test" });
    assert.deepEqual([again.duplicate, again.outcome, again.lead_id], [true, "matched", l]);
    assert.equal((await historyOf(db, l)).filter((x) => x.id.startsWith("diagnosis:")).length, 1, "sem duplicar histórico");
    assert.equal((await db.query("SELECT 1 FROM crm_diagnosis_submissions")).rows.length, 1);
  } finally { await db.close(); }
});

test("diagnóstico v2 preserva cadastro/histórico, etiqueta uma vez e pausa somente o contato", async () => {
  const { db, key } = await setup(true);
  try {
    const a = await addLead(db, "ana@x.test"), b = await addLead(db, "bia@x.test");
    await db.query("UPDATE leads SET name='Nome confirmado',history='[{\"id\":\"old\",\"text\":\"E-mail anterior\"}]' WHERE id=$1", [a]);
    await db.query("SELECT process_crm_automation_entries(50)");
    const call = () => db.query("SELECT receive_crm_diagnosis_v2($1,'diag-test','Ana','Empresa','ana@x.test','','Crescer','',NULL,'','')", [hash]);
    const hash = await hashApiKey(key);
    await call(); await call();
    const l = (await db.query<{ name: string; company: string; tags: string[]; history: { id: string }[] }>("SELECT * FROM leads WHERE id=$1", [a])).rows[0];
    assert.equal(l.name, "Nome confirmado"); assert.equal(l.company, "Empresa");
    assert.deepEqual(l.tags, ["Diagnóstico solicitado"]);
    assert.equal(l.history.filter((h) => h.id.startsWith("diagnosis:")).length, 1);
    assert.ok(l.history.some((h) => h.id === "old"));
    assert.equal((await enrollmentOf(db,a)).status,"paused"); assert.equal((await enrollmentOf(db,b)).status,"active");
    assert.equal((await db.query("SELECT * FROM crm_diagnosis_whatsapp")).rows.length,0,"sem consentimento não prepara envio");
  } finally { await db.close(); }
});

test("envio único por lead, canal exclusivo, autorização revogada e resultado incerto nunca reenviado", async () => {
  const { db, key } = await setup(true);
  try {
    const lead = await addLead(db,"ana@x.test",P,"62999876543");
    await db.query("INSERT INTO portal_admin_channels VALUES($1,'crm:1','gravon','556299887766')",[Q]);
    await db.query("SELECT save_diagnosis_automation($1,true,'gravon','556299887766',0)",[Q]);
    const p = prepareDiagnosisMessage({name:"Ana",whatsapp:"62999876543",whatsapp_consent:{granted:true,at:"2026-01-01T00:00:00Z",version:"v1"}});
    assert.ok(p);
    const receiveV2 = (id: string) => db.query("SELECT receive_crm_diagnosis_v2($1,$2,'Ana','Empresa','ana@x.test','62999876543','Crescer','',$3::jsonb,$4,$5)",[hash,id,JSON.stringify(p.consent),p.phone,p.body]);
    const hash = await hashApiKey(key);
    await receiveV2("d1"); await receiveV2("d2");
    const work = (await db.query<{id:string;state:string}>("SELECT * FROM crm_diagnosis_whatsapp WHERE lead_id=$1",[lead])).rows[0];
    assert.equal((await db.query("SELECT * FROM crm_diagnosis_whatsapp")).rows.length,1);
    const lease = crypto.randomUUID();
    assert.ok((await db.query<{r:unknown}>("SELECT claim_diagnosis_whatsapp($1,$2) r",[work.id,lease])).rows[0].r);
    assert.equal((await db.query<{r:unknown}>("SELECT claim_diagnosis_whatsapp($1,$2) r",[work.id,crypto.randomUUID()])).rows[0].r,null);
    await db.query("SELECT finish_diagnosis_whatsapp($1,$2,'unknown','','',NULL,'timeout')",[work.id,lease]);
    assert.equal((await db.query<{r:unknown}>("SELECT claim_diagnosis_whatsapp($1,$2) r",[work.id,crypto.randomUUID()])).rows[0].r,null);
    await db.query("INSERT INTO portal_admin_channels VALUES($1,'crm:2','gravon','556299887766')",[Q]);
    assert.equal((await db.query<{r:boolean}>("SELECT diagnosis_channel_allowed($1,'gravon','556299887766') r",[Q])).rows[0].r,false);
  } finally { await db.close(); }
});

test("consentimento WhatsApp não é inferido: inválido/futuro negado e mensagem preparada sem rede", () => {
  const base = { name:"Ana Silva",whatsapp:"62999876543" };
  assert.equal(prepareDiagnosisMessage(base),null);
  assert.equal(prepareDiagnosisMessage({...base,whatsapp_consent:{granted:false,at:"2026-01-01T00:00:00Z",version:"v1"}}),null);
  assert.equal(prepareDiagnosisMessage({...base,whatsapp_consent:{granted:true,at:"2099-01-01T00:00:00Z",version:"v1"}}),null);
  const normalized = normalizeDiagnosis({event_id:"e1",...base,whatsapp_consent:{granted:true,at:"2026-01-01T00:00:00Z",version:"v1"}});
  assert.ok(normalized.success);
  assert.equal(prepareDiagnosisMessage(normalized.data)?.phone,"5562999876543");
  assert.equal(normalizeDiagnosis({event_id:"e1",whatsapp_consent:"sim"}).success,false);
});

test("automação desligada não prepara envios e não envia retroativamente após ativação", async () => {
  const {db,key}=await setup(true);
  try {
    await addLead(db,"ana@x.test",P,"62999876543");
    const hash=await hashApiKey(key), consent=JSON.stringify({granted:true,at:"2026-01-01T00:00:00Z",version:"v1"});
    const call=()=>db.query("SELECT receive_crm_diagnosis_v2($1,'old','Ana','Empresa','ana@x.test','62999876543','Crescer','',$2::jsonb,'5562999876543','Olá Ana')",[hash,consent]);
    await call();
    assert.equal((await db.query("SELECT * FROM crm_diagnosis_whatsapp")).rows.length,0);
    await db.query("INSERT INTO portal_admin_channels VALUES($1,'crm:1','gravon','556299887766')",[Q]);
    await db.query("SELECT save_diagnosis_automation($1,true,'gravon','556299887766',0)",[Q]);
    await call();
    assert.equal((await db.query("SELECT * FROM crm_diagnosis_whatsapp")).rows.length,0);
  } finally {await db.close();}
});

test("aceite Evolution persiste em Conversas e histórico uma vez, sem marcar entrega", async () => {
  const {db,key}=await setup(true);
  try {
    const l=await addLead(db,"ana@x.test",P,"62999876543");
    await db.query("INSERT INTO portal_admin_channels VALUES($1,'crm:1','gravon','556299887766')",[Q]);
    await db.query("SELECT save_diagnosis_automation($1,true,'gravon','556299887766',0)",[Q]);
    await db.query("SELECT receive_crm_diagnosis_v2($1,'accepted','Ana','Empresa','ana@x.test','62999876543','Crescer','',$2::jsonb,'5562999876543','Olá Ana')",[await hashApiKey(key),JSON.stringify({granted:true,at:"2026-01-01T00:00:00Z",version:"v1"})]);
    const w=(await db.query<{id:string}>("SELECT id FROM crm_diagnosis_whatsapp")).rows[0];
    const lease=crypto.randomUUID();await db.query("SELECT claim_diagnosis_whatsapp($1,$2)",[w.id,lease]);
    const complete=()=>db.query("SELECT finish_diagnosis_whatsapp($1,$2,'accepted','provider-test','5562999876543@s.whatsapp.net','2026-11-05T03:00:00Z','')",[w.id,lease]);
    await complete();await complete();
    const msgs=(await db.query<{send_state:string}>("SELECT * FROM whatsapp_messages")).rows;
    assert.equal(msgs.length,1);assert.equal(msgs[0].send_state,"accepted");
    assert.equal((await historyOf(db,l)).filter(h=>h.id.startsWith("diagnosis-whatsapp:")).length,1);
  } finally {await db.close();}
});

test("identificação ambígua não pausa nem altera nenhum card", async () => {
  const { db, key } = await setup();
  try {
    const a = await addLead(db, "ana@clinica.test");
    const b = await addLead(db, "bia@clinica.test", P, "(62) 99999-1234");
    await db.query("SELECT process_crm_automation_entries(50)");
    // E-mail aponta para um card e WhatsApp para outro.
    const r = await receive(db, key, { event: "zap-2", email: "ana@clinica.test", whatsapp: "+55 62 9 9999-1234" });
    assert.equal(r.outcome, "ambiguous"); assert.equal(r.lead_id, null); assert.equal(r.paused, 0);
    assert.equal((await enrollmentOf(db, a)).status, "active");
    assert.equal((await enrollmentOf(db, b)).status, "active");
    assert.equal((await historyOf(db, a)).some((x) => x.id.startsWith("diagnosis:")), false);
  } finally { await db.close(); }
});

test("utm_content do link da automação identifica o card mesmo com e-mail repetido", async () => {
  const { db, key } = await setup();
  try {
    const a = await addLead(db, "socio@clinica.test");
    const b = await addLead(db, "socio@clinica.test");
    await db.query("SELECT process_crm_automation_entries(50)");
    const tokenB = (await db.query<{ token: string }>("SELECT token FROM crm_automation_runs WHERE lead_id=$1", [b])).rows[0]?.token;
    const target = tokenB ? b : a; // o índice de contato único só inscreve um dos dois
    const token = tokenB ?? (await db.query<{ token: string }>("SELECT token FROM crm_automation_runs WHERE lead_id=$1", [a])).rows[0].token;
    assert.equal((await receive(db, key, { event: "zap-3a", email: "socio@clinica.test" })).outcome, "ambiguous");
    const r = await receive(db, key, { event: "zap-3", email: "socio@clinica.test", utm: `pf-${token}` });
    assert.equal(r.outcome, "matched"); assert.equal(r.lead_id, target); assert.equal(r.paused, 1);
  } finally { await db.close(); }
});

test("contato só em outro funil fica como não encontrado; WhatsApp localiza no Outbound", async () => {
  const { db, key } = await setup();
  try {
    const fora = await addLead(db, "lia@x.test", Q);
    assert.equal((await receive(db, key, { event: "zap-4", email: "lia@x.test" })).outcome, "not_found");
    assert.equal((await historyOf(db, fora)).length, 0);
    const l = await addLead(db, "", P, "62 99876-5432");
    const r = await receive(db, key, { event: "zap-5", whatsapp: "+55 (62) 9876-5432" });
    assert.equal(r.outcome, "matched"); assert.equal(r.lead_id, l); assert.equal(r.paused, 0);
  } finally { await db.close(); }
});

test("payload do Zapier: aliases em português, objeto data e chave só no cabeçalho", () => {
  const p = normalizeDiagnosis({ data: { Nome: "Ana", Empresa: "Clínica", "E-mail": "ANA@X.TEST", WhatsApp: "62999", "Objetivo comercial": "Crescer", event_id: "1", utm_content: "pf-a" } });
  assert.ok(p.success);
  assert.deepEqual(p.data, { name: "Ana", company: "Clínica", email: "ana@x.test", whatsapp: "62999", objective: "Crescer", event_id: "1", utm_content: "pf-a" });
  assert.equal(normalizeDiagnosis({ email: "a@x.test" }).success, false, "event_id obrigatório");
  assert.equal(normalizeDiagnosis({ event_id: "1", email: "não-é-email" }).success, false);
  const k = newApiKey();
  assert.equal(apiKeyFromHeaders(new Headers({ Authorization: `Bearer ${k}` })), k);
  assert.equal(apiKeyFromHeaders(new Headers({ "X-API-Key": k })), k);
  assert.equal(apiKeyFromHeaders(new Headers({ Authorization: "Bearer abc" })), null);
});
