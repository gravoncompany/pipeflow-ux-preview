import { z } from "zod";
import { signCrmSession } from "./crm-session-token";
import { assertCrmAdmin } from "./crm-leads-access";
import { requireCrmLeadSession } from "./crm-leads.server";
import { safeHttps, type SearchInput } from "./b2b-prospecting";

export async function requireB2bAccess() {
  assertCrmAdmin(await requireCrmLeadSession(process.env.CRM_SESSION_SECRET));
}
export function b2bConfig(env: Record<string, string | undefined> = process.env) {
  const datasets = (env.B2B_DESKDATA_DATASETS ?? "basic").split(",").map((s) => s.trim());
  const validDatasets =
    datasets.includes("basic") &&
    datasets.every((s) => ["basic", "addresses", "phones", "emails", "relationships", "relationships_phones"].includes(s)) &&
    (!datasets.includes("relationships_phones") || datasets.includes("relationships"));
  const enabled = env.B2B_ENABLED === "true";
  const googleKeyConfigured = Boolean(env.B2B_GOOGLE_PLACES_API_KEY?.trim());
  const termsUrl = safeHttps(env.B2B_TERMS_URL);
  const privacyUrl = safeHttps(env.B2B_PRIVACY_URL);
  const limit = (value: string | undefined, fallback: number) => {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 && n <= 500 ? n : fallback;
  };
  return {
    enabled,
    googleKeyConfigured,
    googleReady: enabled && googleKeyConfigured && Boolean(termsUrl && privacyUrl),
    deskReady:
      enabled &&
      validDatasets &&
      (Boolean(env.B2B_DESKDATA_TOKEN) ||
        Boolean(env.DESKDATA_USERNAME?.trim() && env.DESKDATA_PASSWORD)),
    datasets: validDatasets ? datasets : [],
    googleDailyLimit: limit(env.B2B_GOOGLE_DAILY_LIMIT, 50),
    deskDailyLimit: limit(env.B2B_DESKDATA_DAILY_LIMIT, 20),
    termsUrl,
    privacyUrl,
  };
}
export async function b2bDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // New service-only tables are intentionally kept out of the generated client file.
  return supabaseAdmin as unknown as import("@supabase/supabase-js").SupabaseClient;
}
export async function requireEnabled() {
  await requireB2bAccess();
  if (!b2bConfig().enabled)
    throw new Error("Prospecção B2B aguarda ativação no ambiente de preview.");
}
export async function metered<T>(
  provider: "google" | "deskdata" | "deskdata_balance" | "apify",
  work: () => Promise<T>,
): Promise<T> {
  const db = await b2bDb();
  const config = b2bConfig();
  const { data: id, error } = await db.rpc("reserve_b2b_request", {
    p_provider: provider,
    p_daily_limit:
      provider === "google"
        ? config.googleDailyLimit
        : provider === "deskdata"
          ? config.deskDailyLimit
          : 10,
  });
  if (error || !id)
    throw new Error(
      error?.message.includes("b2b_cooldown")
        ? "Aguarde cinco segundos entre consultas."
        : error?.message.includes("b2b_daily_limit")
          ? "Limite diário de consultas atingido."
          : "O controle de consumo ainda não está disponível. Prepare o banco de preview antes de consultar.",
    );
  try {
    const result = await work();
    const { error: saveError } = await db
      .from("b2b_requests")
      .update({
        outcome: "success",
        ...(provider === "deskdata_balance" && typeof result === "number"
          ? { credit_balance: result }
          : {}),
      })
      .eq("id", id);
    if (saveError)
      throw new Error(
        "A consulta ocorreu, mas o registro do resultado falhou. Confira o consumo antes de repetir.",
      );
    return result;
  } catch (e) {
    await db.from("b2b_requests").update({ outcome: "failed" }).eq("id", id);
    throw e;
  }
}
export async function makeCursor(
  input: SearchInput,
  pageToken: string,
  secret: string,
  now = Date.now(),
) {
  const payload = JSON.stringify({
    segment: input.segment,
    city: input.city,
    state: input.state,
    pageToken,
    expires: now + 15 * 60_000,
  });
  return JSON.stringify({
    payload,
    signature: await signCrmSession(`b2b-page:${payload}`, secret),
  });
}
export async function readCursor(input: SearchInput, secret: string, now = Date.now()) {
  if (!input.cursor) return undefined;
  try {
    const envelope = z
      .object({ payload: z.string().max(10000), signature: z.string().length(64) })
      .parse(JSON.parse(input.cursor));
    const expected = await signCrmSession(`b2b-page:${envelope.payload}`, secret);
    let difference = 0;
    for (let i = 0; i < expected.length; i++)
      difference |= expected.charCodeAt(i) ^ envelope.signature.charCodeAt(i);
    if (difference) throw new Error();
    const page = z
      .object({
        segment: z.string(),
        city: z.string(),
        state: z.string(),
        pageToken: z.string().max(6000),
        expires: z.number(),
      })
      .parse(JSON.parse(envelope.payload));
    if (
      page.expires <= now ||
      page.segment !== input.segment ||
      page.city !== input.city ||
      page.state !== input.state
    )
      throw new Error();
    return page.pageToken;
  } catch {
    throw new Error("A paginação expirou ou pertence a outra pesquisa. Faça uma nova busca.");
  }
}
