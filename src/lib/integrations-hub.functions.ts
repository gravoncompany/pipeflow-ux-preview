import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { customIntegrationInput } from "./custom-integrations";

const period = z.object({ since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
const needsAuth = (e: unknown) => e instanceof Error && /senha de acesso completo/.test(e.message);
async function guarded<T>(scope: string, fn: () => Promise<T>) {
  try { const { integrationsAdmin } = await import("./integrations-admin.server"); await integrationsAdmin(scope); return { needsAuth: false as const, error: null, data: await fn() }; }
  catch (e) { if (needsAuth(e)) return { needsAuth: true as const, error: null, data: null }; return { needsAuth: false as const, error: e instanceof Error ? e.message : "Falha.", data: null }; }
}

/** Status cards of the hub: only "conectado" after a real authenticated read. */
export const getIntegrationsHub = createServerFn({ method: "POST" }).handler(() => guarded("hub", async () => {
  const { metaStatus, googleStatus } = await import("./ads-platforms.server");
  const { integrationsDb } = await import("./integrations-admin.server");
  const db = await integrationsDb();
  const [meta, google, rows] = await Promise.all([metaStatus(), googleStatus(), db.from("crm_external_integrations").select("provider,status,last_check_status")]);
  const hc = (rows.data ?? []).find(r => r.provider === "hypercash");
  const custom = (rows.data ?? []).filter(r => r.provider === "custom");
  return {
    hypercash: hc ? (hc.status === "ativa" && hc.last_check_status === "ok" ? "conectado" : hc.status === "erro" ? "erro" : "configurado") : "nao_configurado",
    meta: { connected: meta.connected, state: meta.state, accounts: meta.accounts.length, error: meta.error },
    google: { connected: google.connected, accounts: google.accounts.length, error: google.error },
    custom: { total: custom.length, active: custom.filter(c => c.status === "ativa").length },
  };
}));
export const getMetaAdsIntegration = createServerFn({ method: "POST" }).inputValidator(i => z.object({ force: z.boolean().optional() }).strict().optional().parse(i)).handler(({ data }) => guarded("meta-ads", async () => (await import("./ads-platforms.server")).metaStatus(data?.force === true)));
export const getGoogleAdsIntegration = createServerFn({ method: "POST" }).handler(() => guarded("google-ads", async () => (await import("./ads-platforms.server")).googleStatus()));
export const queryAdsMetrics = createServerFn({ method: "POST" })
  .inputValidator(i => period.extend({ platform: z.enum(["meta_ads", "google_ads"]), accountId: z.string().min(3).max(40) }).strict().parse(i))
  .handler(({ data }) => guarded("ads-metrics", async () => {
    if (data.since > data.until) throw new Error("Período inválido.");
    const m = await import("./ads-platforms.server");
    return data.platform === "meta_ads" ? m.metaMetrics(data.accountId, data.since, data.until) : m.googleMetrics(data.accountId, data.since, data.until);
  }));
export const listCustomIntegrations = createServerFn({ method: "POST" }).handler(() => guarded("custom", async () => (await import("./custom-integrations.server")).listCustom()));
export const saveCustomIntegration = createServerFn({ method: "POST" }).inputValidator(i => customIntegrationInput.parse(i)).handler(async ({ data }) => (await import("./custom-integrations.server")).saveCustom(data));
export const testCustomIntegration = createServerFn({ method: "POST" }).inputValidator(i => z.object({ id: z.string().uuid() }).strict().parse(i)).handler(async ({ data }) => (await import("./custom-integrations.server")).testCustom(data.id));
export const setCustomIntegrationActive = createServerFn({ method: "POST" }).inputValidator(i => z.object({ id: z.string().uuid(), active: z.boolean() }).strict().parse(i)).handler(async ({ data }) => (await import("./custom-integrations.server")).setCustomActive(data.id, data.active));
export const deleteCustomIntegration = createServerFn({ method: "POST" }).inputValidator(i => z.object({ id: z.string().uuid(), confirmed: z.literal(true) }).strict().parse(i)).handler(async ({ data }) => (await import("./custom-integrations.server")).deleteCustom(data.id));
