import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { importInput } from "./b2b-prospecting";

test("isolated B2B migration: atomic imports, pipeline validation, dedup, permissions and durable quotas", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'service_role') $$;`);
    await db.exec(
      await readFile(
        "supabase/migrations/20260507192341_efa3ef40-c7c3-4e7d-9b4c-8eb8cade0be7.sql",
        "utf8",
      ),
    );
    await db.exec(`ALTER TABLE leads ADD COLUMN website text NOT NULL DEFAULT ''; ALTER TABLE leads ADD COLUMN instagram text NOT NULL DEFAULT '';`);
    await db.exec(await readFile("drizzle/migrations/0012_sales_pipelines.sql", "utf8"));
    await db.exec(await readFile("drizzle/migrations/0058_b2b_prospecting.sql", "utf8"));
    const company = {
      placeId: "place_test",
      cnpj: "50621449000145",
      legalName: "Teste isolado",
      tradeName: "",
      registrationStatus: "ATIVA",
      segment: "Facilities",
      city: "Curitiba",
      state: "PR",
      address: "Teste",
      phones: ["554130001234"],
      whatsappNumbers: [],
      partners: [{ name: "Sócia sintética", role: "SOCIO", phones: ["5541999990001"] }],
      emails: ["comercial@example.test"],
      website: "https://example.test",
      source: "manual",
      sourceReference: "Fixture isolada",
      identityConfirmed: true,
      storageAuthorized: true,
    };
    type ImportResult = { status: string; leadId: string; cnpj: string };
    const run = async (companies: unknown[], pipeline: string | null = null) =>
      (
        await db.query<{ value: ImportResult[] }>(
          `SELECT import_b2b_companies($1,$2::jsonb) AS value`,
          [pipeline, JSON.stringify(companies)],
        )
      ).rows[0].value;
    const first = await run([company]);
    assert.equal(first[0].status, "created");
    const lead = (
      await db.query<{
        source: string;
        status: string;
        stage: string;
        pipeline_id: string | null;
        history: unknown[];
      }>("SELECT * FROM leads WHERE id=$1", [first[0].leadId])
    ).rows[0];
    assert.equal(lead.source, "Prospecção B2B");
    assert.equal(lead.status, "Aguardando primeiro contato");
    assert.equal(lead.stage, "lead-novo");
    assert.equal(lead.pipeline_id, null);
    assert.equal(lead.history.length, 1);
    const savedProfile = (await db.query<{ profile: typeof company }>("SELECT profile FROM b2b_companies WHERE lead_id=$1", [first[0].leadId])).rows[0].profile;
    assert.deepEqual(savedProfile.partners, company.partners);
    assert.deepEqual(savedProfile.whatsappNumbers, []);
    assert.equal((await run([company]))[0].status, "duplicate");
    assert.equal(
      (await run([{ ...company, cnpj: "11222333000181", placeId: "another" }]))[0].status,
      "duplicate",
    );
    assert.equal((await db.query("SELECT * FROM leads")).rows.length, 1);
    const pipeline = "00000000-0000-4000-8000-000000000001";
    await db.query("INSERT INTO sales_pipelines(id,name,stages) VALUES($1,'Teste',$2)", [
      pipeline,
      JSON.stringify([{ id: "inbox", title: "Entrada" }]),
    ]);
    const other = { ...company, placeId: "", cnpj: "11222333000181", phones: [], emails: [] };
    const second = await run([other], pipeline);
    assert.equal(second[0].status, "created");
    assert.equal(
      (await db.query<{ stage: string }>("SELECT stage FROM leads WHERE id=$1", [second[0].leadId]))
        .rows[0].stage,
      "inbox",
    );
    await db.query("UPDATE sales_pipelines SET archived=true WHERE id=$1", [pipeline]);
    await assert.rejects(run([other], pipeline), /invalid_pipeline/);
    await assert.rejects(
      run([
        { ...other, cnpj: "04252011000110" },
        { ...other, cnpj: "00000000000001", identityConfirmed: false },
      ]),
      /unreviewed_company/,
    );
    assert.equal(
      (await db.query("SELECT * FROM b2b_companies WHERE cnpj='04252011000110'")).rows.length,
      0,
    );
    await db.exec("SET request.jwt.claim.role='authenticated'");
    await assert.rejects(run([company]), /access_denied/);
    await db.exec("RESET request.jwt.claim.role");
    for (const role of ["anon", "authenticated"]) {
      for (const table of [
        "b2b_requests",
        "b2b_companies",
        "b2b_email_drafts",
        "b2b_email_suppressions",
      ]) {
        const privilege = (
          await db.query<{ allowed: boolean }>(
            "SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') AS allowed",
            [role, table],
          )
        ).rows[0];
        assert.equal(privilege.allowed, false);
      }
      assert.equal(
        (
          await db.query<{ allowed: boolean }>(
            "SELECT has_function_privilege($1,'import_b2b_companies(uuid,jsonb)','EXECUTE') AS allowed",
            [role],
          )
        ).rows[0].allowed,
        false,
      );
    }
    await db.query("SELECT reserve_b2b_request('google',1)");
    await assert.rejects(db.query("SELECT reserve_b2b_request('google',1)"), /b2b_cooldown/);
    await db.exec("UPDATE b2b_requests SET created_at=now()-interval '6 seconds'");
    await assert.rejects(db.query("SELECT reserve_b2b_request('google',1)"), /b2b_daily_limit/);
    assert.equal((await db.query("SELECT * FROM b2b_requests")).rows.length, 1);
    assert.equal(
      (await db.query<{ credit_balance: number | null }>("SELECT credit_balance FROM b2b_requests"))
        .rows[0].credit_balance,
      null,
    );
    await db.query("SELECT reserve_b2b_request('deskdata',2)");
    await assert.rejects(db.query("SELECT reserve_b2b_request('google',501)"), /invalid_budget/);
    // Original lead content stays byte-for-byte intact after duplicate imports.
    assert.deepEqual(
      (await db.query("SELECT * FROM leads WHERE id=$1", [first[0].leadId])).rows[0],
      lead,
    );
  } finally {
    await db.close();
  }
});

test("pending CNPJ: place_id identifies the company, dedupes and never matches other pending rows", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'service_role') $$;`);
    await db.exec(
      await readFile(
        "supabase/migrations/20260507192341_efa3ef40-c7c3-4e7d-9b4c-8eb8cade0be7.sql",
        "utf8",
      ),
    );
    await db.exec(`ALTER TABLE leads ADD COLUMN website text NOT NULL DEFAULT ''; ALTER TABLE leads ADD COLUMN instagram text NOT NULL DEFAULT '';`);
    await db.exec(await readFile("drizzle/migrations/0012_sales_pipelines.sql", "utf8"));
    await db.exec(await readFile("drizzle/migrations/0058_b2b_prospecting.sql", "utf8"));
    const pendingSchema = await readFile("drizzle/migrations/0060_b2b_pending_cnpj.sql", "utf8");
    // The live schema predates its migration journal entry; retain original SQL for this disposable DB.
    await db.exec(pendingSchema.includes("/*\n") ? pendingSchema.split("/*\n")[1].split("\n*/")[0] : pendingSchema);
    await db.exec(await readFile("drizzle/migrations/0061_b2b_pending_legal_name.sql", "utf8"));
    await db.exec(await readFile("drizzle/migrations/0063_b2b_instagram_import.sql", "utf8"));
    const outbound = "00000000-0000-4000-8000-000000000002";
    await db.query("INSERT INTO sales_pipelines(id,name,stages) VALUES($1,'Outbound',$2)", [outbound, JSON.stringify([{id:"outbound-novo",title:"Primeiro contato"}])]);
    const pending = {
      placeId: "place_pending",
      cnpj: "",
      legalName: "",
      tradeName: "Loja Exemplo",
      registrationStatus: "",
      segment: "Facilities",
      city: "Curitiba",
      state: "PR",
      address: "Rua de teste, 100",
      phones: ["554130001234"],
      whatsappNumbers: [],
      partners: [],
      emails: [],
      website: "https://example.test",
      instagram: "https://www.instagram.com/loja.exemplo/",
      source: "manual",
      sourceReference: "Pesquisa Google Maps revisada pelo usuário",
      identityConfirmed: true,
      storageAuthorized: true,
    };
    type ImportResult = { status: string; leadId: string; cnpj: string };
    const run = async (companies: unknown[]) =>
      (
        await db.query<{ value: ImportResult[] }>(
          `SELECT import_b2b_companies($1,$2::jsonb) AS value`,
          [outbound, JSON.stringify(companies)],
        )
      ).rows[0].value;
    const validated = importInput.parse({ pipelineId: outbound, companies: [pending], confirmed: true });
    const first = await run(validated.companies);
    assert.equal(first[0].status, "created");
    const lead = (
      await db.query<{ notes: string; name: string; company: string; pipeline_id: string; stage: string; website: string; instagram: string }>("SELECT * FROM leads WHERE id=$1", [
        first[0].leadId,
      ])
    ).rows[0];
    assert.match(lead.notes, /CNPJ: Pendente/);
    assert.equal(lead.name, "Loja Exemplo");
    assert.equal(lead.company, "");
    assert.equal(lead.pipeline_id, outbound);
    assert.equal(lead.stage, "outbound-novo");
    assert.equal(lead.website, "https://example.test");
    assert.equal(lead.instagram, "https://www.instagram.com/loja.exemplo/");
    const stored = (await db.query<{profile: typeof pending; cnpj: string; place_id: string}>("SELECT profile,cnpj,place_id FROM b2b_companies WHERE lead_id=$1", [first[0].leadId])).rows[0];
    assert.equal(stored.profile.legalName, "");
    assert.equal(stored.profile.tradeName, "Loja Exemplo");
    assert.equal(stored.cnpj, "");
    assert.equal(stored.place_id, "place_pending");
    await assert.rejects(run([{ ...pending, tradeName: "" }]), /unreviewed_company/);
    await assert.rejects(run([{ ...pending, identityConfirmed: false }]), /unreviewed_company/);
    await assert.rejects(run([{ ...pending, storageAuthorized: false }]), /unreviewed_company/);
    await assert.rejects(run([{ ...pending, cnpj: "50621449000145" }]), /unreviewed_company/);
    // Same place_id is a duplicate even with a different trade name.
    assert.equal(
      (await run([{ ...pending, tradeName: "Outra fachada" }]))[0].status,
      "duplicate",
    );
    // A second pending company with a different place_id is created separately.
    const other = await run([{ ...pending, placeId: "place_pending_2", phones: [] }]);
    assert.equal(other[0].status, "created");
    const instagramOnly = await run([{ ...pending, placeId: "instagram_only", phones: [], website: "", instagram: "https://www.instagram.com/empresa.maps/" }]);
    const importedLinks = (await db.query<{website:string;instagram:string}>("SELECT website,instagram FROM leads WHERE id=$1", [instagramOnly[0].leadId])).rows[0];
    assert.equal(importedLinks.website, "");
    assert.equal(importedLinks.instagram, "https://www.instagram.com/empresa.maps/");
    // Empty CNPJ without place_id is rejected.
    await assert.rejects(run([{ ...pending, placeId: "" }]), /unreviewed_company/);
    // Once the CNPJ is known, a reviewed update with the same place_id still dedupes.
    assert.equal(
      (await run([{ ...pending, cnpj: "50621449000145", legalName: "Empresa identificada" }]))[0].status,
      "duplicate",
    );
    assert.equal((await db.query("SELECT * FROM leads")).rows.length, 3);
  } finally {
    await db.close();
  }
});
