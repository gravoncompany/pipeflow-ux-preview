import { test } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { referenceDb, inbound, PIPELINES, CRM, OTHER } from "./crm-agent-test-db";

const save = (db: PGlite, o: Record<string, unknown> = {}) => {
  const p = { id: null, revision: 0, body: "Olá! Quero conhecer o CRM da Gravon", mode: "exact", source: "meta_ads", pipeline: CRM, stage: "crm-novo", active: true, ...o };
  return db.query<{ r: any }>("SELECT save_crm_reference_message(NULL,$1,$2,$3,$4,$5,$6,$7,$8) AS r", [p.id, p.revision, p.body, p.mode, p.source, p.pipeline, p.stage, p.active]).then((x) => x.rows[0]!.r);
};
const capture = (db: PGlite, id: string, instance = "gravon") => db.query<{ r: any }>("SELECT capture_crm_reference_message($1,$2) AS r", [instance, id]).then((x) => x.rows[0]!.r);

test("phone helpers mirror the TypeScript phone rules", async () => {
  const db = await referenceDb();
  try {
    const r = (await db.query<any>(`SELECT crm_phone_key('5551999986839@s.whatsapp.net') a, crm_phone_key('51 99998-6839') b,
      crm_same_whatsapp('555199986839','5551999986839') c, crm_same_whatsapp('5551999986839','5551999986830') d, crm_normalize_reference('  Olá,   QUERO  Ação ') e`)).rows[0];
    assert.deepEqual(r, { a: "5199986839", b: "5199986839", c: true, d: false, e: "ola, quero acao" });
  } finally { await db.close(); }
});

test("validates destination funnel, stage, mode, origin, limit and optimistic revision", async () => {
  const db = await referenceDb();
  try {
    const r = await save(db);
    assert.equal(r.normalized_body, "ola! quero conhecer o crm da gravon");
    await assert.rejects(save(db, { stage: "nao-existe" }), /unknown_stage/);
    await assert.rejects(save(db, { pipeline: PIPELINES.ARCHIVED, stage: "x" }), /unknown_pipeline/);
    await assert.rejects(save(db, { mode: "regex", body: "outra mensagem" }), /invalid_reference/);
    await assert.rejects(save(db, { source: "tiktok", body: "outra mensagem" }), /invalid_reference/);
    await assert.rejects(save(db, { body: "olá!  quero conhecer o CRM da gravon" }), /duplicate|unique/);
    const updated = await save(db, { id: r.id, revision: 1, active: false });
    assert.equal(updated.revision, 2);
    await assert.rejects(save(db, { id: r.id, revision: 1 }), /reference_changed/);
    await db.exec("SET test.role='authenticated'");
    await assert.rejects(save(db, { body: "sem permissão aqui" }), /forbidden/);
  } finally { await db.close(); }
});

test("exact reference creates one card in the configured funnel with origin and tag; replays are idempotent", async () => {
  const db = await referenceDb();
  try {
    await save(db);
    const id = await inbound(db, "5551999990001", "olá!   quero conhecer o CRM da Gravon");
    const first = await capture(db, id);
    assert.equal(first.status, "created");
    assert.equal(first.pipelineId, CRM);
    const lead = (await db.query<any>("SELECT * FROM leads WHERE id=$1", [first.leadId])).rows[0];
    assert.equal(lead.stage, "crm-novo");
    assert.equal(lead.source, "Meta Ads");
    assert.equal(lead.utm_source, "facebook");
    assert.deepEqual(lead.tags, ["meta-ads"]);
    assert.equal(lead.name, "Cliente Teste");
    assert.equal(lead.history[0].kind, "reference_capture");
    const replay = await capture(db, id);
    assert.equal(replay.replayed, true);
    assert.equal((await db.query<any>("SELECT count(*)::int n FROM leads")).rows[0].n, 1);
    // A later campaign message from the same contact reuses the card and preserves history.
    const second = await capture(db, await inbound(db, "555199990001", "Olá! Quero conhecer o CRM da Gravon"));
    assert.equal(second.status, "existing");
    assert.equal(second.leadId, first.leadId);
    const again = (await db.query<any>("SELECT tags,history FROM leads WHERE id=$1", [first.leadId])).rows[0];
    assert.deepEqual(again.tags, ["meta-ads"]);
    assert.equal(again.history.length, 2);
  } finally { await db.close(); }
});

test("contains mode, existing card in the same funnel gets the tag without losing data; other funnels stay isolated", async () => {
  const db = await referenceDb();
  try {
    await save(db, { body: "anúncio crm gravon", mode: "contains", source: "google_ads" });
    await db.query(`INSERT INTO leads(name,whatsapp,stage,pipeline_id,source,tags,history) VALUES('Já existe','(51) 99999-0002','crm-atendimento','${CRM}','Indicação','["quente"]','[{"id":"h1","text":"antigo"}]'),
      ('Outro funil','5551999990002','out-novo','${OTHER}','', '[]','[]')`);
    const r = await capture(db, await inbound(db, "5551999990002", "Oi, vi o ANUNCIO CRM Gravon no Instagram"));
    assert.equal(r.status, "existing");
    const lead = (await db.query<any>("SELECT * FROM leads WHERE id=$1", [r.leadId])).rows[0];
    assert.equal(lead.name, "Já existe");
    assert.equal(lead.stage, "crm-atendimento");
    assert.equal(lead.source, "Indicação");
    assert.equal(lead.utm_source, "google");
    assert.deepEqual(lead.tags, ["quente", "google-ads"]);
    assert.equal(lead.history[0].text, "antigo");
    const other = (await db.query<any>("SELECT tags FROM leads WHERE pipeline_id=$1", [OTHER])).rows[0];
    assert.deepEqual(other.tags, []);
  } finally { await db.close(); }
});

test("works for the main funnel and any funnel created later", async () => {
  const db = await referenceDb();
  try {
    await save(db, { body: "Quero o plano de tráfego", pipeline: null, stage: "lead-novo", source: "google_ads" });
    const created = await capture(db, await inbound(db, "5521988887777", "quero o plano de trafego"));
    assert.equal(created.status, "created");
    assert.equal(created.pipelineId, null);
    const NEW = "00000000-0000-4000-8000-0000000000c9";
    await db.exec(`INSERT INTO sales_pipelines(id,name,stages) VALUES('${NEW}','Funil novo','[{"id":"n1","title":"Entrada"}]')`);
    await save(db, { body: "Mensagem do funil novo", pipeline: NEW, stage: "n1" });
    const later = await capture(db, await inbound(db, "5521988887777", "Mensagem do funil novo"));
    assert.equal(later.status, "created");
    assert.equal(later.pipelineId, NEW);
    assert.equal((await db.query<any>("SELECT count(*)::int n FROM leads")).rows[0].n, 2);
  } finally { await db.close(); }
});

test("ignores inactive references, own messages, media, groups/LID and unmatched text", async () => {
  const db = await referenceDb();
  try {
    await save(db, { active: false });
    assert.equal((await capture(db, await inbound(db, "5551999990003", "Olá! Quero conhecer o CRM da Gravon"))).status, "ignored");
    await save(db, { body: "Outra referência ativa" });
    assert.equal((await capture(db, await inbound(db, "5551999990003", "Outra referência ativa", { from_me: true }))).status, "ignored");
    assert.equal((await capture(db, await inbound(db, "5551999990003", "Outra referência ativa", { media_type: "image" }))).status, "ignored");
    assert.equal((await capture(db, await inbound(db, "5551999990003", "texto qualquer"))).status, "ignored");
    assert.equal((await capture(db, "nao-existe")).status, "ignored");
    assert.equal((await db.query<any>("SELECT count(*)::int n FROM leads")).rows[0].n, 0);
  } finally { await db.close(); }
});

test("ambiguous references or duplicate cards never create another card", async () => {
  const db = await referenceDb();
  try {
    await save(db, { body: "promo crm", mode: "contains", pipeline: CRM, stage: "crm-novo" });
    await save(db, { body: "PROMO CRM", mode: "exact", pipeline: OTHER, stage: "out-novo", source: "google_ads" });
    // Exact wins over contains.
    assert.equal((await capture(db, await inbound(db, "5551999990004", "promo crm"))).pipelineId, OTHER);
    await save(db, { body: "crm promo", mode: "contains", pipeline: OTHER, stage: "out-novo" });
    const amb = await capture(db, await inbound(db, "5551999990005", "oferta promo crm promo agora"));
    assert.equal(amb.status, "ambiguous_reference");
    await db.query(`INSERT INTO leads(name,whatsapp,stage,pipeline_id) VALUES('A','5551999990006','crm-novo','${CRM}'),('B','51999990006','crm-novo','${CRM}')`);
    const dup = await capture(db, await inbound(db, "5551999990006", "quero a promo crm já"));
    assert.equal(dup.status, "ambiguous_lead");
    assert.equal((await db.query<any>("SELECT count(*)::int n FROM leads WHERE whatsapp LIKE '%990006'")).rows[0].n, 2);
  } finally { await db.close(); }
});

test("concurrent deliveries of the same campaign message create a single card", async () => {
  const db = await referenceDb();
  try {
    await save(db);
    const a = await inbound(db, "5551999990007", "Olá! Quero conhecer o CRM da Gravon");
    const b = await inbound(db, "5551999990007", "Olá! Quero conhecer o CRM da Gravon");
    const [x, y] = await Promise.all([capture(db, a), capture(db, b)]);
    assert.deepEqual([x.status, y.status].sort(), ["created", "existing"]);
    assert.equal((await db.query<any>("SELECT count(*)::int n FROM leads")).rows[0].n, 1);
  } finally { await db.close(); }
});
