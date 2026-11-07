import { z } from "zod";
import { fetchWithoutRedirects } from "./no-redirect-fetch.server";
import { businessLinks, instagramProfile } from "./business-links";
import {
  normalizeCnpj,
  validCnpj,
  safeHttps,
  BRAZIL_STATES,
  type CompanyData,
  type Place,
  type SearchInput,
} from "./b2b-prospecting";

export const PLACES_FIELDS =
  "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.primaryTypeDisplayName,places.googleMapsUri,places.rating,places.userRatingCount,places.attributions,nextPageToken";
// Instagram is not a Places field; the only trusted no-cost hint is the place's own
// registered website pointing to an Instagram profile. Never guess handles.
export function instagramFromWebsite(website: string) {
  return instagramProfile(website);
}
export class B2bProviderError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function boundedJson(response: Response, maxBytes = 512_000): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new B2bProviderError("empty", "O provedor retornou uma resposta vazia.");
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes)
        throw new B2bProviderError(
          "oversized",
          "A resposta do provedor excedeu o limite permitido.",
        );
      parts.push(value);
    }
    const buffer = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      buffer.set(part, offset);
      offset += part.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(buffer));
  } catch (e) {
    await reader.cancel().catch(() => {});
    if (e instanceof B2bProviderError) throw e;
    throw new B2bProviderError("invalid_response", "Resposta inválida do provedor.");
  } finally {
    reader.releaseLock();
  }
}
export function deskErrorMessage(code: number) {
  switch (code) {
    case 4001:
      return "A DeskData recusou a autorização (4001). Confira o acesso cadastrado.";
    case 4002:
      return "A DeskData recusou os parâmetros da consulta (4002).";
    case 4003:
      return "Saldo de créditos insuficiente na DeskData (4003).";
    case 4004:
      return "Consulta bloqueada pela DeskData (4004).";
    case 4008:
      return "A DeskData ainda está processando a consulta (4008). Nenhuma nova consulta foi enviada.";
    case 4999:
      return "Erro interno da DeskData (4999). Nenhuma repetição automática foi feita.";
    default:
      return "A DeskData não concluiu a consulta. Nenhuma repetição automática foi feita.";
  }
}
async function request(url: string, init: RequestInit, transport: typeof fetch) {
  try {
    const response = await fetchWithoutRedirects(
      url,
      { ...init, signal: AbortSignal.timeout(url.startsWith("https://api.deskdata.com.br/queries") ? 35000 : 12000) },
      transport,
    );
    if (!response.ok) {
      if (url === "https://api.deskdata.com.br/queries") {
        // Preserve the HTTP diagnosis even when the provider sends HTML/empty error bodies.
        const raw = await boundedJson(response).catch(() => null);
        const status = z
          .object({ status: z.object({ code: z.number().int().min(4000).max(4999) }) })
          .safeParse(raw);
        const code = status.success ? status.data.status.code : null;
        console.warn("b2b_desk_query_failed", { httpStatus: response.status, providerCode: code });
        throw new B2bProviderError(
          code === null ? `http_${response.status}` : `desk_${code}`,
          code === null
            ? `A DeskData recusou a consulta (HTTP ${response.status}). Nenhuma repetição automática foi feita.`
            : deskErrorMessage(code),
        );
      }
      await response.body?.cancel();
      throw new B2bProviderError(
        `http_${response.status}`,
        response.status === 429
          ? "Limite do provedor atingido. Aguarde antes de consultar novamente."
          : [401, 403].includes(response.status)
            ? "Confira a credencial, os créditos e as permissões do provedor."
            : "O provedor não concluiu a consulta. Nenhuma repetição automática foi feita.",
      );
    }
    return await boundedJson(response);
  } catch (e) {
    if (e instanceof B2bProviderError) throw e;
    throw new B2bProviderError(
      "transport",
      "Não foi possível concluir a consulta ao provedor. O consumo pode ter ocorrido; confira antes de repetir.",
    );
  }
}
const short = z.string().max(2000).optional();
const placesResponse = z.object({
  places: z
    .array(
      z.object({
        id: z
          .string()
          .min(1)
          .max(300)
          .regex(/^[A-Za-z0-9_-]+$/),
        displayName: z.object({ text: short }).optional(),
        formattedAddress: short,
        nationalPhoneNumber: short,
        websiteUri: short,
        googleMapsUri: short,
        rating: z.number().min(0).max(5).optional(),
        userRatingCount: z.number().int().nonnegative().max(100_000_000).optional(),
        primaryTypeDisplayName: z.object({ text: short }).optional(),
        attributions: z
          .array(z.object({ provider: short, providerUri: short }))
          .max(30)
          .optional(),
      }),
    )
    .max(20)
    .optional(),
  nextPageToken: z.string().max(6000).optional(),
});
export async function searchPlaces(
  input: SearchInput,
  apiKey: string,
  pageToken?: string,
  transport: typeof fetch = fetch,
) {
  const raw = await request(
    "https://places.googleapis.com/v1/places:searchText",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": PLACES_FIELDS,
      },
      body: JSON.stringify({
        textQuery: `${input.segment} em ${input.city}, ${input.state}, Brasil`,
        languageCode: "pt-BR",
        regionCode: "BR",
        pageSize: 20,
        ...(pageToken ? { pageToken } : {}),
      }),
    },
    transport,
  );
  const parsed = placesResponse.safeParse(raw);
  if (!parsed.success)
    throw new B2bProviderError("schema", "Formato de resposta do Google Places não reconhecido.");
  const places: Place[] = (parsed.data.places ?? []).map((p) => ({
    id: p.id,
    name: p.displayName?.text ?? "Empresa sem nome informado",
    address: p.formattedAddress ?? "",
    phone: p.nationalPhoneNumber ?? "",
    website: businessLinks(safeHttps(p.websiteUri)).website,
    category: p.primaryTypeDisplayName?.text ?? "",
    mapsUrl: safeHttps(p.googleMapsUri),
    rating: p.rating ?? null,
    userRatingCount: p.userRatingCount ?? null,
    instagram: instagramFromWebsite(p.websiteUri ?? ""),
    attributions: (p.attributions ?? []).map((a) => ({
      name: a.provider ?? "",
      url: safeHttps(a.providerUri),
    })),
  }));
  return { places, nextPageToken: parsed.data.nextPageToken };
}

const optionalText = z.string().max(2000).nullish();
const contactPriority = {
  is_main: z.boolean().nullish(),
  priority: z.number().int().nullish(),
};
function byPriority<T extends { is_main?: boolean | null; priority?: number | null }>(items: T[]) {
  return [...items].sort((a, b) => Number(Boolean(b.is_main)) - Number(Boolean(a.is_main)) ||
    (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER));
}
function phoneNumber(p: { country_code?: string | null; area_code?: string | null; number?: string | null }) {
  const number = [p.country_code, p.area_code, p.number].join("").replace(/\D/g, "");
  return /^\d{8,15}$/.test(number) ? number : "";
}
const deskResponse = z.object({
  status: z.object({ code: z.number().int() }),
  data: z
    .object({
      basic: z
        .object({
          name: z.object({ legal_name: optionalText, trade_name: optionalText }).optional(),
          tax_id: z.object({ number: optionalText, status: optionalText }).optional(),
          size: optionalText,
          capital_value: optionalText,
          founding_date: optionalText,
          activities: z
            .array(z.object({ is_main: z.boolean().optional(), code: optionalText, subclass: optionalText }))
            .max(200)
            .optional(),
        })
        .optional(),
      addresses: z
        .object({
          items: z
            .array(
              z.object({
                type: optionalText,
                street_type: optionalText,
                street_name: optionalText,
                number: optionalText,
                neighborhood: optionalText,
                city: optionalText,
                state: optionalText,
                zip_code: optionalText,
                ...contactPriority,
              }),
            )
            .max(200)
            .optional(),
        })
        .optional(),
      phones: z
        .object({
          items: z
            .array(
              z.object({
                type: optionalText,
                country_code: optionalText,
                area_code: optionalText,
                number: optionalText,
                ...contactPriority,
              }),
            )
            .max(200)
            .optional(),
        })
        .optional(),
      emails: z
        .object({
          items: z
            .array(z.object({ type: optionalText, email: optionalText, ...contactPriority }))
            .max(200)
            .optional(),
        })
        .optional(),
      relationships: z.object({ items: z.array(z.object({
        name: optionalText, class: optionalText, type: optionalText, level: optionalText,
        tax_id: z.object({ type: optionalText, number: optionalText, country: optionalText }).nullish(),
      })).max(200).optional() }).optional(),
      relationships_phones: z.array(z.object({
        country_code: optionalText, area_code: optionalText, number: optionalText,
        type: optionalText, ...contactPriority,
        relationship: z.object({ tax_id: optionalText, class: optionalText, type: optionalText }).nullish(),
      })).max(200).optional(),
    })
    .optional(),
});
export function parseDeskCompany(raw: unknown, expectedCnpj?: string, datasets = ["basic", "addresses", "phones", "emails"]): CompanyData | null {
  const parsed = deskResponse.safeParse(raw);
  if (!parsed.success)
    throw new B2bProviderError(
      "schema",
      "Formato da DeskData não reconhecido. Confirme o contrato da API antes de importar.",
    );
  if (parsed.data.status.code !== 4000)
    throw new B2bProviderError(
      `desk_${parsed.data.status.code}`,
      deskErrorMessage(parsed.data.status.code),
    );
  const data = parsed.data.data;
  const basic = data?.basic;
  if (!basic?.tax_id?.number) return null;
  const cnpj = normalizeCnpj(basic.tax_id.number);
  if (!validCnpj(cnpj) || (expectedCnpj && cnpj !== normalizeCnpj(expectedCnpj)))
    throw new B2bProviderError(
      "identity",
      "O CNPJ retornado não corresponde à consulta. Não importe esta empresa.",
    );
  const address = byPriority(datasets.includes("addresses") ? data?.addresses?.items ?? [] : []).find((a) => a.type === "WORK");
  const phones = byPriority(datasets.includes("phones") ? data?.phones?.items ?? [] : [])
    .filter((p) => p.type === "WORK")
    .map(phoneNumber).filter(Boolean);
  const emails = byPriority(datasets.includes("emails") ? data?.emails?.items ?? [] : [])
    .filter((e) => e.type === "CORPORATE")
    .map((e) => e.email?.trim().toLowerCase() ?? "")
    .filter((e) => z.string().email().safeParse(e).success);
  const owners = datasets.includes("relationships")
    ? (data?.relationships?.items ?? []).filter((r) => r.class === "QSA" && r.level === "DIRECT" && r.name?.trim())
    : [];
  const partners = owners.slice(0, 10).map((r) => {
    const id = r.tax_id?.number;
    // Exact fiscal identity used only transiently; never store CPF or match by name.
    const unique = id && /^\d{11,14}$/.test(id) && owners.filter((o) => o.tax_id?.number === id).length === 1;
    const linked = unique && datasets.includes("relationships_phones")
      ? byPriority(data?.relationships_phones ?? []).filter((p) =>
          p.relationship?.class === "QSA" && p.relationship.tax_id === id)
      : [];
    return {
      name: (r.name ?? "").trim().slice(0, 200), role: (r.type ?? "").slice(0, 200),
      phones: [...new Set(linked.map(phoneNumber).filter(Boolean))].slice(0, 5),
    };
  });
  return {
    placeId: "",
    cnpj,
    legalName: (basic.name?.legal_name ?? "").slice(0, 300),
    tradeName: (basic.name?.trade_name ?? "").slice(0, 300),
    registrationStatus: (basic.tax_id.status ?? "").slice(0, 300),
    segment: (basic.activities?.find((a) => a.is_main)?.subclass ?? "").slice(0, 300),
    city: (address?.city ?? "").slice(0, 300),
    state: BRAZIL_STATES.includes(address?.state as (typeof BRAZIL_STATES)[number])
      ? (address?.state as CompanyData["state"])
      : "",
    address: address
      ? [address.street_type, address.street_name, address.number, address.neighborhood, address.zip_code]
          .filter(Boolean)
          .join(" ")
          .slice(0, 700)
      : "",
    phones: [...new Set(phones)].slice(0, 10),
    // The official phone schema has no WhatsApp capability field. Never infer it.
    whatsappNumbers: [],
    partners,
    publicDetails: {
      openedOn: (basic.founding_date ?? "").slice(0, 30),
      cnae: (basic.activities?.find(a => a.is_main)?.code ?? "").slice(0, 30),
      postalCode: (address?.zip_code ?? "").slice(0, 20),
      capital: basic.capital_value && /^\d{1,15}(\.\d{1,2})?$/.test(basic.capital_value) && Number.isFinite(Number(basic.capital_value)) ? Number(basic.capital_value) : null,
      companySize: (basic.size ?? "").slice(0, 100),
      registrySource: "DeskData · dados cadastrais",
      // No revenue field or periodicity is established by the documented basic contract.
      revenueEstimate: null,
      revenueSource: "",
    },
    emails: [...new Set(emails)].slice(0, 10),
    website: "",
    source: "deskdata",
    sourceReference: "DeskData /queries · dados empresariais",
    evidence: [{ source: "DeskData", reference: "https://docs.deskdata.com.br/reference/queries-companies-basic", checkedAt: new Date().toISOString(), fields: datasets, kind: "reported" }],
  };
}
export async function lookupDeskCompany(
  keyType: "name" | "cnpj",
  key: string,
  token: string,
  datasets: string[],
  transport: typeof fetch = fetch,
) {
  const raw = await request(
    "https://api.deskdata.com.br/queries",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "companies",
        key_type: keyType,
        key_value: keyType === "cnpj" ? normalizeCnpj(key) : key,
        datasets: keyType === "name" ? ["basic"] : datasets,
      }),
    },
    transport,
  );
  return parseDeskCompany(raw, keyType === "cnpj" ? key : undefined, keyType === "name" ? ["basic"] : datasets);
}
export async function deskBalance(token: string, transport: typeof fetch = fetch) {
  const raw = await request(
    "https://api.deskdata.com.br/credits",
    { method: "GET", headers: { Authorization: `Bearer ${token}` } },
    transport,
  );
  const parsed = z
    .object({
      status: z.object({ code: z.literal(3000) }),
      data: z.object({ balance: z.number().int().nonnegative() }),
    })
    .safeParse(raw);
  if (!parsed.success)
    throw new B2bProviderError("schema", "Não foi possível confirmar o saldo da DeskData.");
  return parsed.data.data.balance;
}

// Same-operation recovery follows the documented GET /queries/{query_code}.
// Never use a second POST to retrieve pending results.
export async function deskQueryOperation(cnpj: string, datasets: string[], token: string, queryCode?: string, transport: typeof fetch = fetch) {
  const { deskQueryCode } = await import("./lead-deskdata");
  if (queryCode && !deskQueryCode(queryCode)) throw new B2bProviderError("query_code", "Identificador da consulta inválido.");
  const raw = await request(queryCode ? `https://api.deskdata.com.br/queries/${queryCode}` : "https://api.deskdata.com.br/queries", {
    method: queryCode ? "GET" : "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(queryCode ? {} : { body: JSON.stringify({ type: "companies", key_type: "cnpj", key_value: normalizeCnpj(cnpj), datasets }) }),
  }, transport);
  const envelope = z.object({ query_code: z.unknown().optional(), query: z.object({ code: z.unknown().optional() }).optional(), status: z.object({ code: z.number().int() }) }).safeParse(raw);
  if (!envelope.success) throw new B2bProviderError("schema", "Resposta da consulta não reconhecida; não repita a operação paga.");
  const code = deskQueryCode(envelope.data.query_code) ?? deskQueryCode(envelope.data.query?.code) ?? queryCode ?? null;
  if (envelope.data.status.code === 4008) return { pending: true as const, queryCode: code, company: null };
  return { pending: false as const, queryCode: code, company: parseDeskCompany(raw, cnpj, datasets) };
}
