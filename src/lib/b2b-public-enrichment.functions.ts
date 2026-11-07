import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { PublicEnrichResult, PublicJobStatus } from "./b2b-public-enrichment";

const leadId = z.string().uuid();
const keys = z.array(z.enum(["cnpj", "company", "email", "whatsapp", "website"])).max(5);

/** Coloca na fila os cards recém-criados pelo cadastro em massa. Um registro por lead: nunca consulta duas vezes. */
export const queuePublicEnrichment = createServerFn({ method: "POST" })
  .inputValidator(v => z.object({ leadIds: z.array(leadId).min(1).max(200) }).strict().parse(v))
  .handler(async ({ data }) => {
    const { requireB2bAccess, b2bDb } = await import("./b2b-prospecting.server");
    await requireB2bAccess();
    const db = await b2bDb();
    const ids = [...new Set(data.leadIds)];
    const existing = await db.from("leads").select("id").in("id", ids);
    if (existing.error) throw new Error("Não foi possível iniciar a consulta pública.");
    const rows = (existing.data ?? []).map(r => ({ lead_id: r.id as string, origin: "bulk", status: "queued" }));
    if (!rows.length) return { queued: 0 };
    const { error } = await db.from("b2b_public_enrichment_jobs").upsert(rows, { onConflict: "lead_id", ignoreDuplicates: true });
    if (error) throw new Error("Não foi possível iniciar a consulta pública.");
    return { queued: rows.length };
  });

/** Processa um lote pequeno (2) da fila; o navegador chama de novo enquanto houver itens. */
export const processPublicEnrichment = createServerFn({ method: "POST" }).handler(async () => {
  const { requireB2bAccess } = await import("./b2b-prospecting.server");
  await requireB2bAccess();
  const { processPublicQueue } = await import("./b2b-public-enrichment.server");
  return processPublicQueue(2);
});

export const getPublicEnrichmentStatus = createServerFn({ method: "POST" })
  .inputValidator(v => z.object({ leadIds: z.array(leadId).max(200) }).strict().parse(v))
  .handler(async ({ data }) => {
    const { requireB2bAccess, b2bDb } = await import("./b2b-prospecting.server");
    await requireB2bAccess();
    const db = await b2bDb();
    const pending = await db.from("b2b_public_enrichment_jobs").select("lead_id", { count: "exact", head: true }).in("status", ["queued", "running"]);
    const rows = data.leadIds.length ? await db.from("b2b_public_enrichment_jobs").select("lead_id,status,applied").in("lead_id", data.leadIds) : { data: [], error: null };
    if (rows.error || pending.error) throw new Error("Status da consulta pública indisponível.");
    return { remaining: pending.count ?? 0, jobs: (rows.data ?? []).map(r => ({ leadId: r.lead_id as string, status: r.status as PublicJobStatus, applied: (r.applied ?? []) as string[] })) };
  });

type JobView = { status: PublicJobStatus; result: PublicEnrichResult | null; applied: string[]; finishedAt: string | null; outcome: string | null; origin: string };
async function readJob(id: string): Promise<JobView | null> {
  const { b2bDb } = await import("./b2b-prospecting.server");
  const { data, error } = await (await b2bDb()).from("b2b_public_enrichment_jobs").select("status,result,applied,finished_at,outcome_code,origin,lease_until").eq("lead_id", id).maybeSingle();
  if (error) throw new Error("Consulta pública indisponível.");
  return data ? { status: data.status, result: data.result ?? null, applied: data.applied ?? [], finishedAt: data.finished_at, outcome: data.outcome_code, origin: data.origin } : null;
}

export const getLeadPublicLookup = createServerFn({ method: "POST" })
  .inputValidator(v => z.object({ leadId }).strict().parse(v))
  .handler(async ({ data }) => {
    const { deskLeadAccess } = await import("./lead-deskdata.server");
    const { level } = await deskLeadAccess(data.leadId, false);
    if (level !== "full") return { allowed: false as const, job: null };
    return { allowed: true as const, job: await readJob(data.leadId) };
  });

/** Consulta sob demanda dentro do card: só mostra os dados; nada é gravado até o usuário escolher. */
export const runLeadPublicLookup = createServerFn({ method: "POST" })
  .inputValidator(v => z.object({ leadId }).strict().parse(v))
  .handler(async ({ data }) => {
    const { deskLeadAccess } = await import("./lead-deskdata.server");
    const { db } = await deskLeadAccess(data.leadId, true);
    const current = await readJob(data.leadId);
    if (current?.status === "running") throw new Error("A consulta deste card já está em andamento. Aguarde alguns segundos.");
    const { runPublicEnrichment, loadLeadContext } = await import("./b2b-public-enrichment.server");
    const now = new Date().toISOString();
    try {
      const result = await runPublicEnrichment(await loadLeadContext(data.leadId));
      const row = { lead_id: data.leadId, origin: "card", status: result.status, result, applied: [], outcome_code: null, lease_until: null, finished_at: now, updated_at: now, requested_at: now };
      const saved = await db.from("b2b_public_enrichment_jobs").upsert(row, { onConflict: "lead_id" });
      if (saved.error) throw new Error("Consulta feita, mas não foi possível guardar o resultado.");
      return result;
    } catch (e) {
      await db.from("b2b_public_enrichment_jobs").upsert({ lead_id: data.leadId, origin: "card", status: "error", outcome_code: "card_lookup_failed", finished_at: now, updated_at: now, requested_at: now }, { onConflict: "lead_id" });
      throw e instanceof Error ? e : new Error("Erro na consulta.");
    }
  });

/** Grava os dados escolhidos. Campos já preenchidos só mudam quando listados em `replace` (confirmação explícita). */
export const applyLeadPublicLookup = createServerFn({ method: "POST" })
  .inputValidator(v => z.object({ leadId, keys: keys.min(1), replace: keys, confirmed: z.literal(true) }).strict().parse(v))
  .handler(async ({ data }) => {
    const { deskLeadAccess } = await import("./lead-deskdata.server");
    const { db } = await deskLeadAccess(data.leadId, true);
    const job = await readJob(data.leadId);
    if (!job?.result) throw new Error("Faça a consulta novamente antes de adicionar os dados.");
    const { applyEnrichment } = await import("./b2b-public-enrichment.server");
    const replace = data.replace.filter(k => data.keys.includes(k));
    const out = await applyEnrichment(data.leadId, job.result, data.keys, replace, "Consulta Pública Gratuita (card)");
    await db.from("b2b_public_enrichment_jobs").update({ applied: [...new Set([...job.applied, ...out.applied])], updated_at: new Date().toISOString() }).eq("lead_id", data.leadId);
    return out;
  });

/** Escolhe um dos CNPJs candidatos (quando havia mais de um ou nenhum seguro). Não grava no card. */
export const chooseLeadPublicCandidate = createServerFn({ method: "POST" })
  .inputValidator(v => z.object({ leadId, cnpj: z.string().regex(/^[A-Z0-9]{12}[0-9]{2}$/) }).strict().parse(v))
  .handler(async ({ data }) => {
    const { deskLeadAccess } = await import("./lead-deskdata.server");
    const { db } = await deskLeadAccess(data.leadId, true);
    const job = await readJob(data.leadId);
    if (!job?.result) throw new Error("Faça a consulta novamente.");
    const { chooseCandidate } = await import("./b2b-public-enrichment.server");
    const result = await chooseCandidate(data.leadId, job.result, data.cnpj);
    const saved = await db.from("b2b_public_enrichment_jobs").update({ result, status: "found", updated_at: new Date().toISOString() }).eq("lead_id", data.leadId);
    if (saved.error) throw new Error("Não foi possível guardar a escolha.");
    return result;
  });

const placeInput = z.object({
  key: z.string().trim().min(1).max(350), name: z.string().trim().min(2).max(300), address: z.string().max(700),
  website: z.string().max(2000), city: z.string().max(100), state: z.string().max(2), phone: z.string().max(40),
}).strict();
/** Busca dados públicos de empresas do Maps antes de criar os cards (até 5 por chamada; nada é gravado). */
export const lookupPlacesPublic = createServerFn({ method: "POST" })
  .inputValidator(v => z.object({ places: z.array(placeInput).min(1).max(5) }).strict().parse(v))
  .handler(async ({ data }) => {
    const { requireEnabled } = await import("./b2b-prospecting.server");
    await requireEnabled();
    const { runPlaceLookup } = await import("./b2b-public-enrichment.server");
    const out: { key: string; result: PublicEnrichResult | null; error: string }[] = [];
    for (const p of data.places) {
      try { out.push({ key: p.key, result: await runPlaceLookup(p), error: "" }); }
      catch (e) { out.push({ key: p.key, result: null, error: e instanceof Error ? e.message.slice(0, 200) : "Falha na consulta." }); }
    }
    return out;
  });
