import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { publicLookupInput, publicNameInput, quoteInput, paidLookupInput } from "./b2b-hybrid";
import { B2B_TABLES, b2bTableStatus, b2bUncheckedTables } from "./b2b-readiness";
import {
  searchInput,
  importInput,
  draftInput,
  companyInput,
  type CompanyInput,
} from "./b2b-prospecting";

export const getB2bOverview = createServerFn({ method: "GET" }).handler(async () => {
  const { requireB2bAccess, b2bConfig, b2bDb } = await import("./b2b-prospecting.server");
  await requireB2bAccess();
  const config = b2bConfig();
  const empty = {
    ...config,
    databaseReady: false,
    databaseChecks: b2bUncheckedTables(),
    todayRequests: [] as {
      provider: string;
      outcome: string;
      credit_balance: number | null;
      created_at: string;
    }[],
    companies: [] as {
      cnpj: string;
      lead_id: string | null;
      profile: CompanyInput;
      created_at: string;
    }[],
    drafts: [] as {
      id: string;
      lead_id: string;
      recipient: string;
      subject: string;
      state: string;
      created_at: string;
    }[],
    suppressions: [] as { email: string; reason: string; created_at: string }[],
    /** Abordagens registradas manualmente no histórico dos leads cadastrados pela prospecção. */
    approaches: [] as { lead_id: string; date: string; channel: string }[],
  };
  if (!config.enabled) return empty;
  try {
    const db = await b2bDb();
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    const results = await Promise.all([
      db
        .from("b2b_requests")
        .select("provider,outcome,credit_balance,created_at")
        .gte("created_at", day.toISOString())
        .order("created_at", { ascending: false })
        .limit(1100),
      db
        .from("b2b_companies")
        .select("cnpj,lead_id,profile,created_at")
        .order("created_at", { ascending: false })
        .limit(100),
      db
        .from("b2b_email_drafts")
        .select("id,lead_id,recipient,subject,state,created_at")
        .order("created_at", { ascending: false })
        .limit(100),
      db
        .from("b2b_email_suppressions")
        .select("email,reason,created_at")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    const databaseChecks = B2B_TABLES.map((table, index) => ({
      table,
      status: b2bTableStatus(results[index].error),
    }));
    if (results.some((r) => r.error)) return { ...empty, databaseChecks };
    const { latestFirstContact } = await import("./b2b-flow");
    const leadIds = [...new Set((results[1].data ?? []).flatMap((r) => (r.lead_id ? [r.lead_id as string] : [])))];
    const leadRows = leadIds.length ? await db.from("leads").select("id,history").in("id", leadIds) : { data: [], error: null };
    // Falha ao ler o histórico não derruba a tela: só deixa de mostrar as abordagens.
    const approaches = (leadRows.error ? [] : (leadRows.data ?? [])).flatMap((row) => {
      const last = latestFirstContact((row as { history: unknown }).history);
      return last ? [{ lead_id: (row as { id: string }).id, ...last }] : [];
    });
    return {
      approaches,
      ...config,
      databaseReady: true,
      databaseChecks,
      todayRequests: results[0].data as typeof empty.todayRequests,
      companies: (results[1].data ?? []).flatMap((row) => {
        const parsed = companyInput.safeParse({
          ...row.profile,
          identityConfirmed: true,
          storageAuthorized: true,
        });
        return parsed.success
          ? [
              {
                cnpj: row.cnpj as string,
                lead_id: row.lead_id as string | null,
                created_at: row.created_at as string,
                profile: parsed.data,
              },
            ]
          : [];
      }),
      drafts: results[2].data as typeof empty.drafts,
      suppressions: results[3].data as typeof empty.suppressions,
    };
  } catch {
    return { ...empty, databaseChecks: b2bUncheckedTables("unavailable") };
  }
});
export const searchB2b = createServerFn({ method: "POST" })
  .inputValidator((v) => searchInput.parse(v))
  .handler(async ({ data }) => {
    const { requireEnabled, b2bConfig, metered, makeCursor, readCursor } =
      await import("./b2b-prospecting.server");
    await requireEnabled();
    if (!b2bConfig().googleReady)
      throw new Error(
        "Configure Google Places, termos de uso e privacidade no backend do preview.",
      );
    const pageToken = await readCursor(data, process.env.CRM_SESSION_SECRET!);
    const { searchPlaces } = await import("./b2b-providers.server");
    const result = await metered("google", () =>
      searchPlaces(data, process.env.B2B_GOOGLE_PLACES_API_KEY!, pageToken),
    );
    return {
      places: result.places,
      cursor: result.nextPageToken
        ? await makeCursor(data, result.nextPageToken, process.env.CRM_SESSION_SECRET!)
        : null,
    };
  });
export const lookupB2b = createServerFn({ method: "POST" })
  .inputValidator((v) => paidLookupInput.parse(v))
  .handler(async ({ data }) => {
    const { requireEnabled, b2bConfig, metered } = await import("./b2b-prospecting.server");
    await requireEnabled();
    const config = b2bConfig();
    if (!config.deskReady)
      throw new Error(
        "Configure o acesso da DeskData (usuário e senha) e os conjuntos contratados no backend do preview.",
      );
    const [{ submitB2bDesk }, { B2bProviderError }, { DeskDataAuthError }] = await Promise.all([
      import("./b2b-desk-operation.server"),
      import("./b2b-providers.server"),
      import("./deskdata-auth.server"),
    ]);
    try { return await submitB2bDesk(data); }
    catch (error) { return {ok:false as const,code:error instanceof B2bProviderError || error instanceof DeskDataAuthError ? error.code : "unconfirmed",message:error instanceof B2bProviderError || error instanceof DeskDataAuthError ? error.message : "Resultado não confirmado. Recupere a operação anterior; não repita a consulta paga."}; }
  });
export const recoverB2bDeskData = createServerFn({method:"POST"})
  .inputValidator(v => quoteInput.parse(v))
  .handler(async ({data}) => {
    const {requireEnabled} = await import("./b2b-prospecting.server");
    await requireEnabled();
    const {recoverB2bDesk} = await import("./b2b-desk-operation.server");
    const {B2bProviderError} = await import("./b2b-providers.server");
    try { return await recoverB2bDesk(data); }
    catch(error) { return {ok:false as const,code:error instanceof B2bProviderError ? error.code : "recovery_unavailable",message:error instanceof B2bProviderError ? error.message : "Não foi possível recuperar a operação. Nenhuma consulta paga foi repetida."}; }
  });
export const getB2bDeskQuote = createServerFn({method:"POST"})
  .inputValidator(v => quoteInput.parse(v))
  .handler(async ({data}) => {
    const {requireEnabled} = await import("./b2b-prospecting.server");
    await requireEnabled();
    const {buildDeskQuote} = await import("./b2b-hybrid.server");
    return buildDeskQuote(data);
  });
export const lookupB2bPublic = createServerFn({method:"POST"})
  .inputValidator(v => publicLookupInput.parse(v))
  .handler(async ({data}) => {
    const {requireEnabled,b2bDb} = await import("./b2b-prospecting.server");
    await requireEnabled();
    const {lookupKey,cachedLookup} = await import("./b2b-hybrid.server");
    const {b2bLookupResult} = await import("./b2b-lookup-result");
    const {lookupPublicCompany} = await import("./b2b-public.server");
    const {B2bProviderError} = await import("./b2b-providers.server");
    return b2bLookupResult(async () => {
      const key = await lookupKey("public","cnpj",data.cnpj,[]);
      const cached = await cachedLookup(key);
      if(cached.company) return cached.company;
      const company = await lookupPublicCompany(data.cnpj);
      const saved = await (await b2bDb()).from("b2b_lookup_cache").upsert({query_key:key,provider:"public",state:"success",profile:company,checked_at:new Date().toISOString(),valid_until:new Date(Date.now()+86400_000).toISOString()});
      if(saved.error) throw new Error("Dados consultados, mas armazenamento privado indisponível.");
      return company;
    },e => e instanceof B2bProviderError ? {code:e.code,message:e.message}:null);
  });
export const searchB2bPublicNames = createServerFn({method:"POST"})
  .inputValidator(v => publicNameInput.parse(v))
  .handler(async ({data}) => {
    const {requireEnabled, b2bDb} = await import("./b2b-prospecting.server");
    await requireEnabled();
    const {matchPublicCompanyNames} = await import("./b2b-hybrid");
    const db = await b2bDb();
    const result = await db.from("b2b_lookup_cache").select("profile")
      .eq("provider","public").eq("state","success").gt("valid_until",new Date().toISOString())
      .order("checked_at",{ascending:false}).limit(100);
    if (result.error) throw new Error("A pesquisa no histórico privado está indisponível; nenhuma consulta paga foi feita.");
    const profiles = (result.data ?? []).flatMap(row => {
      const parsed = companyInput.innerType().omit({identityConfirmed:true,storageAuthorized:true}).safeParse(row.profile);
      return parsed.success ? [parsed.data] : [];
    });
    return {companies:matchPublicCompanyNames(profiles,data.name)};
  });
export const getB2bCredits = createServerFn({ method: "POST" }).handler(async () => {
  const { requireEnabled, b2bConfig, metered } = await import("./b2b-prospecting.server");
  await requireEnabled();
  if (!b2bConfig().deskReady) throw new Error("DeskData ainda não configurada.");
  const [{ deskBalance }, { getDeskDataToken }] = await Promise.all([
    import("./b2b-providers.server"),
    import("./deskdata-auth.server"),
  ]);
  return metered("deskdata_balance", async () => deskBalance(await getDeskDataToken()));
});
export const testDeskDataConnection = createServerFn({ method: "POST" }).handler(async () => {
  const { requireEnabled, b2bConfig } = await import("./b2b-prospecting.server");
  await requireEnabled();
  if (!b2bConfig().deskReady)
    return {
      ok: false,
      code: "not_configured",
      message: "Configure o acesso da DeskData no backend do preview.",
      balance: null,
      tokenExpiresAt: null,
    };
  const [{ getDeskDataToken, deskDataTokenExpiresAt, resetDeskDataToken }, { deskBalance }] =
    await Promise.all([import("./deskdata-auth.server"), import("./b2b-providers.server")]);
  try {
    const token = await getDeskDataToken();
    const balance = await deskBalance(token);
    const expiresAt = deskDataTokenExpiresAt();
    return {
      ok: true,
      code: "connected",
      message: "Conexão com a DeskData confirmada: autenticação e leitura de saldo funcionaram.",
      balance,
      tokenExpiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    };
  } catch (e) {
    const code =
      typeof (e as { code?: unknown })?.code === "string"
        ? (e as { code: string }).code
        : "unexpected";
    const message = e instanceof Error ? e.message.slice(0, 300) : "Falha desconhecida na conexão.";
    if (code === "http_401" || code === "http_403") resetDeskDataToken();
    return { ok: false, code, message, balance: null, tokenExpiresAt: null };
  }
});
export const importB2b = createServerFn({ method: "POST" })
  .inputValidator((v) => importInput.parse(v))
  .handler(async ({ data }) => {
    const { requireEnabled, b2bDb } = await import("./b2b-prospecting.server");
    await requireEnabled();
    const db = await b2bDb();
    const { businessLinks } = await import("./business-links");
    const result = await db.rpc("import_b2b_companies", {
      p_pipeline: data.pipelineId,
      p_companies: data.companies.map(company => ({ ...company, ...businessLinks(company.website, company.instagram) })),
    });
    if (result.error)
      throw new Error(
        "A importação não foi confirmada. Confira o funil e o histórico antes de repetir; CNPJs já cadastrados não serão duplicados.",
      );
    return z
      .array(
        z.object({
          cnpj: z.string(),
          status: z.enum(["created", "duplicate"]),
          leadId: z.string().nullable(),
        }),
      )
      .parse(result.data);
  });
export const saveB2bDraft = createServerFn({ method: "POST" })
  .inputValidator((v) => draftInput.parse(v))
  .handler(async ({ data }) => {
    const { requireEnabled, b2bDb } = await import("./b2b-prospecting.server");
    await requireEnabled();
    const db = await b2bDb();
    const { data: company, error } = await db
      .from("b2b_companies")
      .select("profile")
      .eq("lead_id", data.leadId)
      .maybeSingle();
    const emails = z.object({ emails: z.array(z.string()) }).safeParse(company?.profile);
    if (error || !emails.success || !emails.data.emails.includes(data.recipient))
      throw new Error("Selecione um e-mail corporativo revisado deste lead.");
    const { data: suppression, error: blockError } = await db
      .from("b2b_email_suppressions")
      .select("email")
      .eq("email", data.recipient)
      .maybeSingle();
    if (blockError || suppression)
      throw new Error("Este destinatário está bloqueado para contato ou não pôde ser verificado.");
    const result = await db
      .from("b2b_email_drafts")
      .insert({
        lead_id: data.leadId,
        recipient: data.recipient,
        subject: data.subject,
        body: data.body,
        state: data.reviewed ? "reviewed" : "draft",
      })
      .select("id")
      .single();
    if (result.error) throw new Error("Não foi possível salvar o rascunho.");
    return { id: result.data.id as string, sent: false };
  });
export const suppressB2bEmail = createServerFn({ method: "POST" })
  .inputValidator((v) =>
    z
      .object({
        email: z
          .string()
          .email()
          .max(254)
          .transform((s) => s.trim().toLowerCase()),
        reason: z.string().trim().min(3).max(300),
        confirmed: z.literal(true),
      })
      .strict()
      .parse(v),
  )
  .handler(async ({ data }) => {
    const { requireEnabled, b2bDb } = await import("./b2b-prospecting.server");
    await requireEnabled();
    const result = await (
      await b2bDb()
    )
      .from("b2b_email_suppressions")
      .upsert(
        { email: data.email, reason: data.reason },
        { onConflict: "email", ignoreDuplicates: true },
      );
    if (result.error) throw new Error("Não foi possível registrar o descadastramento.");
    return { ok: true };
  });
