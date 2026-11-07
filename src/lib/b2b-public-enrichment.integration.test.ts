import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Banco descartável (PGlite): regras de gravação da Consulta Pública Gratuita, sem tocar em dados reais.
test("Consulta Pública: só preenche vazios, substitui com confirmação, bloqueia CNPJ de outro card e não duplica a fila", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'service_role') $$;
      CREATE TABLE leads (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL DEFAULT '', company text NOT NULL DEFAULT '', email text NOT NULL DEFAULT '', whatsapp text NOT NULL DEFAULT '', website text NOT NULL DEFAULT '', history jsonb NOT NULL DEFAULT '[]');
      CREATE TABLE b2b_companies (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cnpj text NOT NULL, lead_id uuid UNIQUE REFERENCES leads(id), place_id text NOT NULL DEFAULT '', profile jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
      CREATE UNIQUE INDEX b2b_companies_cnpj ON b2b_companies(cnpj) WHERE cnpj <> '';`);
    await db.exec(await readFile("drizzle/migrations/0091_b2b_public_enrichment.sql", "utf8"));
    await db.exec(await readFile("drizzle/migrations/0092_b2b_public_enrichment_apply_v2.sql", "utf8"));
    await db.exec(await readFile("drizzle/migrations/0093_b2b_public_enrichment_apply_fix.sql", "utf8"));
    const A = "00000000-0000-4000-8000-0000000000a1", B = "00000000-0000-4000-8000-0000000000a2";
    await db.exec(`INSERT INTO leads(id,name,whatsapp) VALUES ('${A}','Sorriso','5511999990000'),('${B}','Outro','');
      INSERT INTO b2b_companies(cnpj,lead_id,profile) VALUES ('11222333000181','${B}','{}');`);
    const apply = async (fields: object, replace: string[], cnpj = "", profile: object | null = null) =>
      (await db.query<{ r: { applied: string[]; skipped: string[]; cnpjConflict: boolean; entry: { text: string } | null } }>(
        "SELECT apply_b2b_public_enrichment($1,$2,$3,$4,$5,'Consulta Pública Gratuita') r", [A, JSON.stringify(fields), replace, cnpj, profile && JSON.stringify(profile)])).rows[0].r;

    // 1. Campo vazio é preenchido; campo já preenchido fica como estava.
    let r = await apply({ email: "Contato@Sorriso.com.br", whatsapp: "5511888880000" }, []);
    assert.deepEqual(r.applied, ["email"]); assert.deepEqual(r.skipped, ["whatsapp"]);
    let lead = (await db.query<{ email: string; whatsapp: string; history: { text: string }[] }>(`SELECT email,whatsapp,history FROM leads WHERE id='${A}'`)).rows[0];
    assert.equal(lead.email, "contato@sorriso.com.br"); assert.equal(lead.whatsapp, "5511999990000");
    assert.match(lead.history[0].text, /e-mail/); assert.equal(r.entry?.text, lead.history[0].text);

    // 2. Substitui só com confirmação explícita.
    r = await apply({ whatsapp: "5511888880000" }, ["whatsapp"]);
    assert.deepEqual(r.applied, ["whatsapp"]);

    // 3. CNPJ que já pertence a outro card: não associa nem copia razão social/perfil.
    r = await apply({ company: "OUTRA LTDA" }, [], "11222333000181", { legalName: "OUTRA LTDA" });
    assert.equal(r.cnpjConflict, true); assert.deepEqual(r.applied, []);
    assert.equal((await db.query(`SELECT 1 FROM b2b_companies WHERE lead_id='${A}'`)).rows.length, 0);
    assert.equal((await db.query<{ company: string }>(`SELECT company FROM leads WHERE id='${A}'`)).rows[0].company, "");

    // 4. Card cadastrado manualmente recebe o cadastro da empresa com o CNPJ confirmado.
    r = await apply({ company: "SORRISO LTDA" }, [], "11444777000161", { legalName: "SORRISO LTDA", cnpj: "11444777000161" });
    assert.deepEqual(r.applied, ["company", "cnpj"]);
    assert.equal((await db.query<{ cnpj: string }>(`SELECT cnpj FROM b2b_companies WHERE lead_id='${A}'`)).rows[0].cnpj, "11444777000161");

    // 5. Fila: um registro por card e uma única reserva por vez.
    await db.exec(`INSERT INTO b2b_public_enrichment_jobs(lead_id,origin) VALUES ('${A}','bulk') ON CONFLICT DO NOTHING; INSERT INTO b2b_public_enrichment_jobs(lead_id,origin) VALUES ('${A}','bulk') ON CONFLICT DO NOTHING;`);
    assert.equal((await db.query(`SELECT 1 FROM b2b_public_enrichment_jobs`)).rows.length, 1);
    assert.equal((await db.query(`SELECT claim_b2b_public_enrichment(3)`)).rows.length, 1);
    assert.equal((await db.query(`SELECT claim_b2b_public_enrichment(3)`)).rows.length, 0);

    // 6. Usuários comuns não executam.
    await db.exec(`SELECT set_config('request.jwt.claim.role','authenticated',false)`);
    await assert.rejects(apply({ email: "a@b.com" }, []), /access_denied/);
  } finally { await db.close(); }
});
