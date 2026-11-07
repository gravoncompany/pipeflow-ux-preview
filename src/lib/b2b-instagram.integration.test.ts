import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { companyInput, importInput } from "./b2b-prospecting";

const igCompany = {
  placeId: "",
  cnpj: "",
  legalName: "",
  tradeName: "Facilities BR",
  registrationStatus: "",
  segment: "Facilities",
  city: "Curitiba",
  state: "PR",
  address: "",
  phones: ["41999991234"],
  whatsappNumbers: ["41999991234"],
  emails: ["comercial@facilities.test"],
  website: "https://facilities.test",
  instagram: "https://www.instagram.com/facilitiesbr/",
  source: "instagram",
  sourceReference: "Instagram - Apify · @facilitiesbr · #facilities",
  identityConfirmed: true,
  storageAuthorized: true,
};

test("schema aceita origem instagram somente com perfil público", () => {
  assert.equal(companyInput.safeParse(igCompany).success, true);
  assert.equal(companyInput.safeParse({ ...igCompany, instagram: "" }).success, false);
  assert.equal(companyInput.safeParse({ ...igCompany, source: "manual", placeId: "", cnpj: "" }).success, false);
  assert.equal(importInput.safeParse({ pipelineId: null, confirmed: true, companies: [igCompany] }).success, true);
  assert.equal(importInput.safeParse({ pipelineId: null, confirmed: true, companies: [igCompany, igCompany] }).success, false);
});

test("migração 0143 isolada: importa Instagram sem CNPJ, deduplica pelo perfil e protege permissões", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'service_role') $$;`);
    await db.exec(
      await readFile("supabase/migrations/20260507192341_efa3ef40-c7c3-4e7d-9b4c-8eb8cade0be7.sql", "utf8"),
    );
    await db.exec(`ALTER TABLE leads ADD COLUMN website text NOT NULL DEFAULT ''; ALTER TABLE leads ADD COLUMN instagram text NOT NULL DEFAULT '';`);
    await db.exec(await readFile("drizzle/migrations/0012_sales_pipelines.sql", "utf8"));
    await db.exec(await readFile("drizzle/migrations/0058_b2b_prospecting.sql", "utf8"));
    // Evolução já aplicada no banco real (0060): CNPJ pendente permitido, PK em id.
    await db.exec(`ALTER TABLE b2b_companies DROP CONSTRAINT b2b_companies_pkey;
      ALTER TABLE b2b_companies DROP CONSTRAINT b2b_companies_cnpj_check;
      ALTER TABLE b2b_companies ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
      ALTER TABLE b2b_companies ADD CONSTRAINT b2b_companies_pkey PRIMARY KEY (id);
      ALTER TABLE b2b_companies ADD CONSTRAINT b2b_companies_cnpj_check CHECK(cnpj ~ '^[A-Z0-9]{12}[0-9]{2}$' OR cnpj = '');`);
    await db.exec(await readFile("drizzle/migrations/0143_b2b_instagram_prospecting.sql", "utf8"));
    await db.exec(await readFile("drizzle/migrations/0144_b2b_instagram_force_rls.sql", "utf8"));
    await db.exec(await readFile("drizzle/migrations/0147_b2b_instagram_enrichment.sql", "utf8"));
    await db.exec(await readFile("drizzle/migrations/0148_instagram_public_contact_evidence.sql", "utf8"));

    type ImportResult = { status: string; leadId: string; cnpj: string };
    const run = async (companies: unknown[]) =>
      (await db.query<{ value: ImportResult[] }>(`SELECT import_b2b_companies(NULL,$1::jsonb) AS value`, [JSON.stringify(companies)])).rows[0].value;

    const first = await run([igCompany]);
    assert.equal(first[0].status, "created");
    const lead = (await db.query<{ source: string; instagram: string; history: { text: string }[] }>("SELECT * FROM leads WHERE id=$1", [first[0].leadId])).rows[0];
    assert.equal(lead.source, "Instagram - Apify");
    assert.equal(lead.instagram, "https://www.instagram.com/facilitiesbr/");
    assert.match(lead.history[0].text, /Instagram \(Apify\)/);

    // Mesma empresa pelo mesmo perfil: duplicada, sem novo card.
    const again = await run([igCompany]);
    assert.equal(again[0].status, "duplicate");
    assert.equal(again[0].leadId, first[0].leadId);
    assert.equal((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM leads")).rows[0].n, 1);

    // Lead legado com o mesmo Instagram também bloqueia duplicidade.
    await db.query(`INSERT INTO leads(name,instagram,stage) VALUES('Legado','https://www.instagram.com/legado/','lead-novo')`);
    const legacy = await run([{ ...igCompany, tradeName: "Outro Nome", emails: [], phones: [], whatsappNumbers: [], instagram: "https://www.instagram.com/legado/", sourceReference: "Instagram - Apify · @legado · #x" }]);
    assert.equal(legacy[0].status, "duplicate");

    // Perfil inválido ou sem revisão é recusado.
    await assert.rejects(() => run([{ ...igCompany, instagram: "https://outro-site.test/perfil", sourceReference: "Instagram - Apify · @x" }]), /unreviewed_company/);
    await assert.rejects(() => run([{ ...igCompany, identityConfirmed: false }]), /unreviewed_company/);

    // Tabelas da pesquisa: service-only (sem GRANT para anon; RPC exige papel service_role).
    await db.exec(`SET ROLE anon`);
    await assert.rejects(() => db.query(`SELECT * FROM b2b_instagram_public_cache`), /permission denied/);
    await assert.rejects(() => db.query(`SELECT * FROM b2b_instagram_searches`), /permission denied/);
    await assert.rejects(
      () => db.query(`INSERT INTO b2b_instagram_searches(hashtags,results_limit) VALUES('{x}',20)`),
      /permission denied/,
    );
    await db.exec(`RESET ROLE`);
    await db.exec(`SET request.jwt.claim.role='anon'`);
    await assert.rejects(() => run([igCompany]), /access_denied/);
    await db.exec(`RESET request.jwt.claim.role`);

    // Reserva de consumo aceita apify e mantém o intervalo mínimo.
    const reserved = await db.query<{ reserve_b2b_request: string }>(`SELECT reserve_b2b_request('apify',10)`);
    assert.ok(reserved.rows[0].reserve_b2b_request);
    await assert.rejects(() => db.query(`SELECT reserve_b2b_request('apify',10)`), /b2b_cooldown/);

    // 0147: Instagram com CNPJ válido encontrado no site cadastra e deduplica pelo CNPJ.
    const outra = { ...igCompany, emails: ["contato@outra.test"], phones: ["41988887777"], whatsappNumbers: ["41988887777"] };
    const withCnpj = await run([{ ...outra, cnpj: "11222333000181", instagram: "https://www.instagram.com/outra/", sourceReference: "Instagram - Apify · @outra · #x" }]);
    assert.equal(withCnpj[0].status, "created");
    const dupCnpj = await run([{ ...outra, cnpj: "11222333000181", tradeName: "Terceira", emails: ["contato@terceira.test"], phones: ["41977776666"], whatsappNumbers: ["41977776666"], instagram: "https://www.instagram.com/terceira/", sourceReference: "Instagram - Apify · @terceira · #x" }]);
    assert.equal(dupCnpj[0].status, "duplicate");
    assert.equal(dupCnpj[0].leadId, withCnpj[0].leadId);
    // CNPJ fora do formato continua recusado mesmo com perfil válido (dígitos verificadores são validados na aplicação).
    await assert.rejects(
      () => run([{ ...outra, cnpj: "123", instagram: "https://www.instagram.com/quarta/", sourceReference: "Instagram - Apify · @quarta · #x" }]),
      /unreviewed_company/,
    );
  } finally {
    await db.close();
  }
});
