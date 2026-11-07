import { companyFields } from "./b2b-prospecting";
import { b2bDb, metered, requireEnabled } from "./b2b-prospecting.server";
import { deskQueryOperation } from "./b2b-providers.server";
import { getDeskDataToken } from "./deskdata-auth.server";
import { lookupKey, verifyDeskQuote } from "./b2b-hybrid.server";
import { requestedDatasets, assertPartnerEnrichment, type QuoteInput } from "./b2b-hybrid";
import { deskQueryCode } from "./lead-deskdata";

async function saveOperation(key: string, operation: Awaited<ReturnType<typeof deskQueryOperation>>) {
  await requireEnabled();
  const db = await b2bDb();
  const result = await db.from("b2b_lookup_cache").update({
    state: operation.pending ? "reserved" : "success", profile: operation.company,
    desk_pending: operation.pending, desk_query_code: operation.queryCode,
    checked_at: new Date().toISOString(), valid_until: new Date(Date.now() + 30 * 86400000).toISOString(),
  }).eq("query_key", key);
  if (result.error) throw new Error("Consulta enviada; registro não confirmado. Não repita a consulta paga.");
  return operation.pending
    ? { ok: true as const, company: null, pending: true as const, recoverable: Boolean(operation.queryCode) }
    : { ok: true as const, company: operation.company, pending: false as const, recoverable: false };
}

export async function submitB2bDesk(data: { quote: string; keyType: "name" | "cnpj"; key: string }) {
  const quote = await verifyDeskQuote(data.quote, data.keyType, data.key);
  if (quote.company) return { ok: true as const, company: quote.company, pending: false as const, recoverable: false };
  const db = await b2bDb();
  const claim = await db.rpc("claim_b2b_lookup", { p_key: quote.key, p_provider: "deskdata" });
  if (claim.error || claim.data !== true) throw new Error("Consulta já reservada ou controle indisponível.");
  // Persist the provider handle inside the metered callback, before accounting settles.
  // No error path clears a saved handle or permits a second paid POST.
  return metered("deskdata", async () => {
    await requireEnabled();
    const operation = await deskQueryOperation(data.key, quote.datasets, await getDeskDataToken());
    return saveOperation(quote.key, operation);
  });
}

export async function recoverB2bDesk(input: QuoteInput) {
  assertPartnerEnrichment(input);
  const key = await lookupKey("deskdata", input.keyType, input.key, requestedDatasets(input));
  const db = await b2bDb();
  const row = await db.from("b2b_lookup_cache").select("state,profile,desk_pending,desk_query_code,checked_at").eq("query_key", key).eq("provider", "deskdata").maybeSingle();
  if (row.error || !row.data) throw new Error("Operação anterior não localizada; nenhuma consulta paga será enviada.");
  const profile = companyFields.omit({identityConfirmed:true,storageAuthorized:true}).safeParse(row.data.profile);
  if (row.data.state === "success") return { ok: true as const, company: profile.success ? profile.data : null, pending: false as const, recoverable: false };
  const code = deskQueryCode(row.data.desk_query_code);
  if (!row.data.desk_pending || !code) throw new Error("Identificador recuperável ausente. Confira a operação com a DeskData antes de repetir.");
  if (Date.now() - Date.parse(row.data.checked_at) < 20000) return {ok:true as const,company:null,pending:true as const,recoverable:true};
  // Reserve a recovery interval before GET so rapid clicks do not query excessively.
  const lease = await db.from("b2b_lookup_cache").update({checked_at:new Date().toISOString()}).eq("query_key",key).eq("checked_at",row.data.checked_at).select("query_key");
  if (lease.error || !lease.data?.length) return {ok:true as const,company:null,pending:true as const,recoverable:true};
  await requireEnabled();
  return saveOperation(key, await deskQueryOperation(input.key, requestedDatasets(input), await getDeskDataToken(), code));
}