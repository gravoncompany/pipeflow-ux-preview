import { z } from "zod";
import { companyFields } from "./b2b-prospecting";
import { assertPartnerEnrichment, estimateDeskCredits, requestedDatasets, quoteInput, type QuoteInput } from "./b2b-hybrid";
import { signCrmSession } from "./crm-session-token";
import { b2bConfig, b2bDb } from "./b2b-prospecting.server";

export function configuredDeskCosts(env: Record<string,string|undefined> = process.env): Record<string,number> {
  // Values must be the provider-confirmed all-in dataset costs, not inferred from balance or marketing prices.
  if (env.B2B_DESKDATA_COSTS_CONFIRMED !== "true") return {};
  try { return z.record(z.string(), z.number().int().positive().max(10000)).parse(JSON.parse(env.B2B_DESKDATA_CREDIT_COSTS ?? "{}")); } catch { return {}; }
}
export async function lookupKey(provider: string, keyType: string, key: string, datasets: string[]) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([provider,keyType,key.trim().toUpperCase().replace(keyType === "cnpj" ? /[./\s-]/g : /\s+/g,keyType === "cnpj" ? "" : " "),[...datasets].sort()])));
  return [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2,"0")).join("");
}
export async function cachedLookup(key: string) {
  const db = await b2bDb();
  const { data, error } = await db.from("b2b_lookup_cache").select("state,profile,valid_until").eq("query_key",key).maybeSingle();
  if (error) throw new Error("O controle de consultas está indisponível; nenhuma consulta foi enviada.");
  const profile = companyFields.omit({identityConfirmed:true,storageAuthorized:true}).safeParse(data?.profile);
  return { exists: Boolean(data), company: data?.state === "success" && Date.parse(data.valid_until) > Date.now() && profile.success ? profile.data : null };
}
export async function buildDeskQuote(input: QuoteInput) {
  assertPartnerEnrichment(input);
  const datasets = requestedDatasets(input);
  const config = b2bConfig();
  const key = await lookupKey("deskdata",input.keyType,input.key,datasets);
  const cached = await cachedLookup(key);
  const estimatedCredits = cached.company ? 0 : estimateDeskCredits(datasets,config.datasets,configuredDeskCosts());
  const blockedReason = cached.company ? "" : cached.exists ? "Esta consulta já foi enviada. Recupere a operação anterior, sem nova cobrança; se não houver identificador, confira com a DeskData." : !config.deskReady ? "Acesso DeskData pendente." : datasets.some(d => !config.datasets.includes(d)) ? "Conjuntos selecionados não estão confirmados na configuração contratada." : estimatedCredits === null ? "Custo total dos conjuntos ainda não foi confirmado pela DeskData." : "";
  const payload = JSON.stringify({ input, datasets, estimatedCredits, key, expires: Date.now()+5*60_000 });
  const secret = process.env.CRM_SESSION_SECRET;
  if (!secret) throw new Error("Sessão indisponível.");
  return { datasets, estimatedCredits, cached: Boolean(cached.company), previousOperation: cached.exists && !cached.company, blockedReason, quote: blockedReason ? "" : JSON.stringify({payload, signature: await signCrmSession(`b2b-quote:${payload}`,secret)}) };
}
export async function verifyDeskQuote(token: string, keyType: "name"|"cnpj", key: string) {
  const envelope = z.object({payload:z.string().max(8000),signature:z.string().length(64)}).parse(JSON.parse(token));
  const secret = process.env.CRM_SESSION_SECRET;
  if (!secret) throw new Error("Sessão indisponível.");
  const expected = await signCrmSession(`b2b-quote:${envelope.payload}`,secret);
  let difference = 0; for(let i=0;i<expected.length;i++) difference |= expected.charCodeAt(i)^envelope.signature.charCodeAt(i);
  if(difference) throw new Error("Confirmação inválida.");
  const p = z.object({input:quoteInput,datasets:z.array(z.string()),estimatedCredits:z.number().nonnegative(),key:z.string(),expires:z.number()}).parse(JSON.parse(envelope.payload));
  assertPartnerEnrichment(p.input);
  if(p.expires <= Date.now() || p.input.key !== key || p.input.keyType !== keyType || JSON.stringify(p.datasets)!==JSON.stringify(requestedDatasets(p.input))) throw new Error("A estimativa expirou ou pertence a outra consulta.");
  const cached = await cachedLookup(p.key);
  if(cached.company) return {...p,company:cached.company};
  const estimate = estimateDeskCredits(p.datasets,b2bConfig().datasets,configuredDeskCosts());
  if(cached.exists || estimate===null || estimate!==p.estimatedCredits) throw new Error("Consulta bloqueada: confira a configuração e o consumo antes de repetir.");
  return {...p,company:null};
}