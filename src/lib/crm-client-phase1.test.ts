import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { clientCampaignMetrics } from "./crm-client-metrics";
import { leadToClientDraft, withCompanyData } from "./lead-to-client";
import type { AdsRow } from "./portal-ads";

const row = (platform: "meta_ads" | "google_ads", account: string, date: string, spend: number | null): AdsRow =>
  ({ platform, account_id: account, campaign_id: "c1", campaign_name: "C", date, spend, currency: "BRL", timezone_name: "America/Sao_Paulo", synced_at: "2026-11-04T10:00:00Z" });

test("indicadores só somam as contas vinculadas ao cliente; outras empresas ficam de fora", () => {
  const m = clientCampaignMetrics({
    bound: [{ platform: "google_ads", account_id: "111" }],
    portalRows: [row("google_ads", "111", "2026-11-04", 50), row("google_ads", "111", "2026-10-20", 100), row("google_ads", "999", "2026-11-04", 700)],
    portalUpdatedAt: null, metaRows: [], metaAccounts: [], metaUpdatedAt: null, today: "2026-11-04", from: "2026-10-06",
  });
  const g = m.platforms.find((p) => p.platform === "google_ads")!;
  assert.equal(g.last30, 150);
  assert.equal(g.today, 50);
  assert.equal(m.investment30, 150);
});

test("Meta pela API não soma de novo o que o Portal mostra da mesma plataforma", () => {
  const m = clientCampaignMetrics({
    bound: [{ platform: "meta_ads", account_id: "act_222" }],
    portalRows: [row("meta_ads", "222", "2026-11-04", 300)],
    portalUpdatedAt: null, metaRows: [{ ad_account_id: "act_222", spend_date: "2026-11-04", spend_cents: 12345, currency: "BRL" }],
    metaAccounts: ["act_222"], metaUpdatedAt: "2026-11-04T09:00:00Z", today: "2026-11-04", from: "2026-10-06",
  });
  assert.equal(m.platforms.find((p) => p.platform === "meta_ads")!.last30, 123.45);
  assert.equal(m.investment30, 123.45);
});

test("sem leads por empresa, custo por lead fica sem dado (nunca estimado)", () => {
  const m = clientCampaignMetrics({ bound: [{ platform: "google_ads", account_id: "1" }], portalRows: [row("google_ads", "1", "2026-11-04", 10)], portalUpdatedAt: null, metaRows: [], metaAccounts: [], metaUpdatedAt: null, today: "2026-11-04", from: "2026-10-06" });
  assert.equal(m.leads30, null);
  assert.equal(m.costPerLead, null);
});

test("cadastro do cliente aproveita os dados da empresa sem trocar o que já veio do card", () => {
  const d = withCompanyData(leadToClientDraft({ id: "l1", name: "Ana", company: "Clínica Sol", whatsapp: "41999", email: "ana@sol.test", website: "", service: "" }),
    { legalName: "SOL SERVICOS LTDA", cnpj: "11222333000181", phone: "4133334444", address: "Rua A, 1", email: "contato@sol.test", website: "https://sol.test", tradeName: "Sol" }, "Willian");
  assert.equal(d.tradeName, "Clínica Sol");
  assert.equal(d.legalName, "SOL SERVICOS LTDA");
  assert.equal(d.cnpj, "11222333000181");
  assert.equal(d.email, "ana@sol.test");
  assert.equal(d.address, "Rua A, 1");
  assert.equal(d.internalResponsible, "Willian");
});

test("conversão de lead preenche razão social, CNPJ, telefone e endereço da Prospecção e não duplica CNPJ", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role' $$;
      CREATE TABLE leads(id uuid PRIMARY KEY, name text, company text, whatsapp text, email text, website text, history jsonb);
      CREATE TABLE b2b_companies(cnpj text, lead_id uuid, place_id text, profile jsonb);
      CREATE TABLE crm_profile(company_key text PRIMARY KEY, display_name text);
      CREATE TABLE crm_projects(id uuid PRIMARY KEY);
      INSERT INTO crm_profile VALUES('crm:1','Willian');
      INSERT INTO leads VALUES('00000000-0000-4000-8000-000000000001','Ana','Clínica Sol','41999','','', '[]'),('00000000-0000-4000-8000-000000000002','Bia','Sol Filial','41888','','', '[]');
      INSERT INTO b2b_companies VALUES('11222333000181','00000000-0000-4000-8000-000000000001','',' {"legalName":"SOL SERVICOS LTDA","phones":["4133334444"],"address":"Rua A, 1"}'),
        ('11222333000181','00000000-0000-4000-8000-000000000002','','{"legalName":"SOL SERVICOS LTDA"}');`);
    for (const f of ["0067_crm_clients_module", "0107_crm_client_projects_portal", "0108_crm_client_convert_cnpj_fix"]) await db.exec(await readFile(`drizzle/migrations/${f}.sql`, "utf8"));
    const id = (await db.query<{ id: string }>("SELECT convert_lead_to_client('Gestor','00000000-0000-4000-8000-000000000001','ativo','',ARRAY[]::text[],'') id")).rows[0].id;
    const c = (await db.query<Record<string, string>>("SELECT legal_name,cnpj,phone,address,internal_responsible FROM crm_clients WHERE id=$1", [id])).rows[0];
    assert.deepEqual(c, { legal_name: "SOL SERVICOS LTDA", cnpj: "11222333000181", phone: "4133334444", address: "Rua A, 1", internal_responsible: "Willian" });
    const id2 = (await db.query<{ id: string }>("SELECT convert_lead_to_client('Gestor','00000000-0000-4000-8000-000000000002','ativo','',ARRAY[]::text[],'') id")).rows[0].id;
    assert.equal((await db.query<{ cnpj: string }>("SELECT cnpj FROM crm_clients WHERE id=$1", [id2])).rows[0].cnpj, "");
    // Projetos e contas de anúncio: uma conta pertence a um único cliente.
    await db.query("INSERT INTO crm_client_ad_accounts(client_id,platform,account_id) VALUES($1,'google_ads','123')", [id]);
    await assert.rejects(db.query("INSERT INTO crm_client_ad_accounts(client_id,platform,account_id) VALUES($1,'google_ads','123')", [id2]));
    await db.query("INSERT INTO crm_client_projects(client_id,name) VALUES($1,'Tráfego'),($1,'Site')", [id]);
    assert.equal(Number((await db.query<{ n: number }>("SELECT count(*)::int n FROM crm_client_projects WHERE client_id=$1", [id])).rows[0].n), 2);
  } finally { await db.close(); }
});
