import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const leadId = "00000000-0000-4000-8000-000000000001";

async function setup() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT coalesce(current_setting('test.role',true),'service_role') $$;
    CREATE TABLE leads(id uuid PRIMARY KEY, name text, company text, whatsapp text, email text, website text, history jsonb);
    INSERT INTO leads VALUES('${leadId}','Maria Souza','Ótica Mello','5541999990000','maria@example.test','https://otica.example.test','[]');`);
  await db.exec(await readFile("drizzle/migrations/0067_crm_clients_module.sql", "utf8"));
  return db;
}

const saveClient = (db: PGlite, over: Record<string, unknown> = {}) => {
  const p = { id: null, lead: null, trade: "Ótica Mello", legal: "", cnpj: "", contact: "Maria", phone: "", whatsapp: "5541999990000", email: "maria@example.test", address: "", website: "", start: "2026-01-10", services: ["Tráfego pago"], status: "ativo", responsible: "Wilian", reminderDays: 5, notes: "", revision: 0, ...over };
  return db.query<any>("SELECT save_crm_client($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) AS id",
    ["Gestor", p.id, p.lead, p.trade, p.legal, p.cnpj, p.contact, p.phone, p.whatsapp, p.email, p.address, p.website, p.start, p.services, p.status, p.responsible, p.reminderDays, p.notes, p.revision]);
};

test("cadastro, edição com revisão e prevenção de duplicidade por CNPJ e por lead", async () => {
  const db = await setup();
  try {
    const id = (await saveClient(db, { cnpj: "50621449000145" })).rows[0].id;
    assert.ok(id);
    await saveClient(db, { id, revision: 0, trade: "Ótica Mello Centro", cnpj: "50621449000145" });
    assert.equal((await db.query<any>("SELECT trade_name,revision FROM crm_clients WHERE id=$1", [id])).rows[0].trade_name, "Ótica Mello Centro");
    await assert.rejects(saveClient(db, { id, revision: 0 }), /client_changed/); // revisão agora é 1
    await assert.rejects(saveClient(db, { cnpj: "50621449000145" }), /duplicate_cnpj/);
    await assert.rejects(saveClient(db, { cnpj: "123" }), /invalid_cnpj/);
    const withLead = (await saveClient(db, { lead: leadId, cnpj: "" })).rows[0].id;
    assert.ok(withLead);
    await assert.rejects(saveClient(db, { lead: leadId }), /already_client/);
  } finally { await db.close(); }
});

test("conversão de contato em cliente preserva o lead e registra no histórico, sem duplicar", async () => {
  const db = await setup();
  try {
    const id = (await db.query<any>("SELECT convert_lead_to_client($1,$2,$3,$4,$5,$6) AS id", ["Gestor", leadId, "ativo", "Wilian", ["Tráfego pago"], "Conversão de teste"])).rows[0].id;
    const client = (await db.query<any>("SELECT * FROM crm_clients WHERE id=$1", [id])).rows[0];
    assert.equal(client.trade_name, "Ótica Mello");
    assert.equal(client.contact_name, "Maria Souza");
    assert.equal(client.whatsapp, "5541999990000");
    assert.equal(client.lead_id, leadId);
    const lead = (await db.query<any>("SELECT history FROM leads WHERE id=$1", [leadId])).rows[0];
    assert.equal(lead.history[0].kind, "client_converted");
    assert.equal(lead.history[0].client, id);
    await assert.rejects(db.query("SELECT convert_lead_to_client($1,$2,$3,$4,$5,$6)", ["Gestor", leadId, "ativo", "", [], ""]), /already_client/);
    await assert.rejects(db.query("SELECT convert_lead_to_client($1,$2,$3,$4,$5,$6)", ["Gestor", "00000000-0000-4000-8000-000000000099", "ativo", "", [], ""]), /lead_unavailable/);
  } finally { await db.close(); }
});

test("conhecimento é append-only e isolado por cliente", async () => {
  const db = await setup();
  try {
    const a = (await saveClient(db)).rows[0].id;
    const b = (await saveClient(db, { trade: "Outra Empresa" })).rows[0].id;
    await db.query("SELECT add_crm_client_knowledge($1,$2,$3,$4,$5,$6)", ["Gestor", a, "preferencia", "Contato", "Prefere WhatsApp à tarde", "Reunião"]);
    await db.query("SELECT add_crm_client_knowledge($1,$2,$3,$4,$5,$6)", ["Gestor", b, "manual", "", "Dados da outra empresa", ""]);
    const ka = await db.query<any>("SELECT kind,title FROM crm_client_knowledge WHERE client_id=$1", [a]);
    assert.equal(ka.rows.length, 1);
    assert.equal(ka.rows[0].kind, "preferencia");
    assert.equal((await db.query<any>("SELECT id FROM crm_client_knowledge WHERE client_id=$1", [b])).rows.length, 1);
    await assert.rejects(db.query("SELECT add_crm_client_knowledge($1,$2,$3,$4,$5,$6)", ["Gestor", a, "inventado", "", "x", ""]), /invalid_knowledge/);
  } finally { await db.close(); }
});

test("planejamento: versões, revisão e aprovação; rascunho novo não apaga a versão aprovada", async () => {
  const db = await setup();
  try {
    const clientId = (await saveClient(db)).rows[0].id;
    const planId = (await db.query<any>("SELECT save_crm_client_plan($1,$2,$3,$4,$5,$6,$7) AS id", ["Gestor", clientId, null, "Plano 2026", "# Diagnóstico\nConteúdo v1", "manual", 0])).rows[0].id;
    await db.query("SELECT approve_crm_client_plan($1,$2,$3,$4)", ["Gestor", planId, 1, 0]);
    let plan = (await db.query<any>("SELECT * FROM crm_client_plans WHERE id=$1", [planId])).rows[0];
    assert.equal(plan.status, "aprovado");
    assert.equal(plan.approved_version, 1);
    // Nova versão (IA) vira rascunho; aprovada continua sendo a v1.
    await db.query("SELECT save_crm_client_plan($1,$2,$3,$4,$5,$6,$7)", ["Gravon IA", clientId, planId, "Plano 2026", "# Diagnóstico\nConteúdo v2 pela IA", "ia", 1]);
    plan = (await db.query<any>("SELECT * FROM crm_client_plans WHERE id=$1", [planId])).rows[0];
    assert.equal(plan.current_version, 2);
    assert.equal(plan.status, "rascunho");
    assert.equal(plan.approved_version, 1);
    assert.equal((await db.query<any>("SELECT content FROM crm_client_plan_versions WHERE plan_id=$1 AND version=1", [planId])).rows[0].content.includes("v1"), true);
    await assert.rejects(db.query("SELECT save_crm_client_plan($1,$2,$3,$4,$5,$6,$7)", ["Gestor", clientId, planId, "t", "x", "manual", 1]), /plan_changed/);
    await assert.rejects(db.query("SELECT approve_crm_client_plan($1,$2,$3,$4)", ["Gestor", planId, 99, 2]), /version_unavailable/);
  } finally { await db.close(); }
});

test("registros e tarefas com autoria, revisão e status controlados", async () => {
  const db = await setup();
  try {
    const clientId = (await saveClient(db)).rows[0].id;
    await db.query("SELECT add_crm_client_record($1,$2,$3,$4)", ["Gestor", clientId, "decisao", "Cliente aprovou aumento de verba."]);
    const rec = (await db.query<any>("SELECT * FROM crm_client_records WHERE client_id=$1", [clientId])).rows[0];
    assert.equal(rec.author, "Gestor");
    await assert.rejects(db.query("SELECT add_crm_client_record($1,$2,$3,$4)", ["Gestor", clientId, "outro", "x"]), /invalid_record/);
    const taskId = (await db.query<any>("SELECT save_crm_client_task($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS id", ["Gestor", null, clientId, "Enviar relatório", "", "Wilian", "alta", "2026-11-10", "pendente", "manual", 0])).rows[0].id;
    await db.query("SELECT save_crm_client_task($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", ["Gestor", taskId, clientId, "Enviar relatório", "", "Wilian", "alta", "2026-11-10", "concluida", "manual", 0]);
    assert.equal((await db.query<any>("SELECT status FROM crm_client_tasks WHERE id=$1", [taskId])).rows[0].status, "concluida");
    await assert.rejects(db.query("SELECT save_crm_client_task($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", ["Gestor", taskId, clientId, "X", "", "", "media", null, "pendente", "manual", 0]), /task_changed|invalid_task/);
  } finally { await db.close(); }
});

test("cobrança mensal gera vencimentos de 12 meses; pagamento exige confirmação e bloqueia edição", async () => {
  const db = await setup();
  try {
    const clientId = (await saveClient(db)).rows[0].id;
    const id = (await db.query<any>("SELECT save_crm_client_charge($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS id", ["Gestor", null, clientId, "Mensalidade tráfego", 1500, "2026-11-10", "mensal", 0, "Pix", 0])).rows[0].id;
    const all = await db.query<any>("SELECT due_date,status,parent_charge_id FROM crm_client_charges WHERE client_id=$1 ORDER BY due_date", [clientId]);
    assert.ok(all.rows.length >= 12, `esperava >=12 ocorrências, veio ${all.rows.length}`);
    assert.equal(all.rows.filter(r => r.parent_charge_id === id).length, all.rows.length - 1);
    await assert.rejects(db.query("SELECT register_crm_client_payment($1,$2,$3,$4,$5,$6)", ["Gestor", id, 1500, "Pix", "", false]), /payment_not_confirmed/);
    await db.query("SELECT register_crm_client_payment($1,$2,$3,$4,$5,$6)", ["Gestor", id, 1500, "Pix", "Recebido via Pix", true]);
    assert.equal((await db.query<any>("SELECT status FROM crm_client_charges WHERE id=$1", [id])).rows[0].status, "pago");
    await assert.rejects(db.query("SELECT register_crm_client_payment($1,$2,$3,$4,$5,$6)", ["Gestor", id, 1500, "Pix", "", true]), /charge_paid/);
    await assert.rejects(db.query("SELECT save_crm_client_charge($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", ["Gestor", id, clientId, "Mensalidade editada", 1, "2026-11-10", "mensal", 0, "", 1]), /charge_paid/);
    await assert.rejects(db.query("SELECT cancel_crm_client_charge($1,$2,$3)", ["Gestor", id, 1]), /charge_paid/);
  } finally { await db.close(); }
});

test("status vencido é atualizado e lembretes viram apenas tarefas internas, sem duplicar", async () => {
  const db = await setup();
  try {
    const clientId = (await saveClient(db, { reminderDays: 5 })).rows[0].id;
    const past = new Date(Date.now() - 2 * 24 * 3_600_000).toISOString().slice(0, 10);
    const soon = new Date(Date.now() + 3 * 24 * 3_600_000).toISOString().slice(0, 10);
    await db.query("SELECT save_crm_client_charge($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", ["Gestor", null, clientId, "Vencida", 500, past, "unica", 0, "", 0]);
    await db.query("SELECT save_crm_client_charge($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", ["Gestor", null, clientId, "A vencer", 700, soon, "unica", 0, "", 0]);
    const n = (await db.query<any>("SELECT create_due_charge_reminders($1) AS n", ["Gestor"])).rows[0].n;
    assert.equal(n, 2);
    const tasks = await db.query<any>("SELECT title,origin,priority,status FROM crm_client_tasks WHERE client_id=$1 ORDER BY title", [clientId]);
    assert.equal(tasks.rows.length, 2);
    assert.ok(tasks.rows.every(t => t.origin === "lembrete" && t.status === "pendente"));
    assert.ok(tasks.rows.some(t => t.priority === "alta")); // a vencida
    assert.equal((await db.query<any>("SELECT status FROM crm_client_charges WHERE description='Vencida'")).rows[0].status, "vencido");
    // Rodar de novo não duplica lembretes.
    assert.equal((await db.query<any>("SELECT create_due_charge_reminders($1) AS n", ["Gestor"])).rows[0].n, 0);
    // Cliente encerrado não gera lembrete.
    await db.query("UPDATE crm_clients SET status='encerrado' WHERE id=$1", [clientId]);
    await db.query("DELETE FROM crm_client_tasks WHERE client_id=$1", [clientId]);
    assert.equal((await db.query<any>("SELECT create_due_charge_reminders($1) AS n", ["Gestor"])).rows[0].n, 0);
  } finally { await db.close(); }
});

test("nenhuma tabela ou função do módulo é acessível ao navegador", async () => {
  const db = await setup();
  try {
    for (const t of ["crm_clients", "crm_client_knowledge", "crm_client_plans", "crm_client_plan_versions", "crm_client_documents", "crm_client_records", "crm_client_tasks", "crm_client_charges", "crm_client_payments"]) {
      assert.equal((await db.query<any>(`SELECT has_table_privilege('authenticated','${t}','SELECT') AS allowed`)).rows[0].allowed, false);
    }
    await db.exec("SET test.role='authenticated'");
    await assert.rejects(saveClient(db), /forbidden/);
    await assert.rejects(db.query("SELECT create_due_charge_reminders($1)", ["Gestor"]), /forbidden/);
  } finally { await db.close(); }
});
