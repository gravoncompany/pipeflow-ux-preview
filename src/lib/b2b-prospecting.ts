import { z } from "zod";

export const BRAZIL_STATES = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
] as const;
export const searchInput = z
  .object({
    segment: z.string().trim().min(2).max(100),
    city: z.string().trim().min(2).max(100),
    state: z.enum(BRAZIL_STATES),
    cursor: z.string().max(12000).optional(),
  })
  .strict();
export type SearchInput = z.infer<typeof searchInput>;
export type Place = {
  id: string;
  name: string;
  address: string;
  phone: string;
  website: string;
  category: string;
  mapsUrl: string;
  rating: number | null;
  userRatingCount: number | null;
  instagram: string;
  attributions: { name: string; url: string }[];
};

export function normalizeCnpj(value: string) {
  return value.toUpperCase().replace(/[./\s-]/g, "");
}
export function validCnpj(value: string) {
  const cnpj = normalizeCnpj(value);
  if (!/^[A-Z0-9]{12}\d{2}$/.test(cnpj) || /^(.)\1{13}$/.test(cnpj)) return false;
  const digit = (base: string) => {
    let weight = base.length - 7;
    const sum = [...base].reduce((total, c) => {
      const n = total + (c.charCodeAt(0) - 48) * weight;
      weight = weight === 2 ? 9 : weight - 1;
      return n;
    }, 0);
    const remainder = sum % 11;
    return String(remainder < 2 ? 0 : 11 - remainder);
  };
  const base = cnpj.slice(0, 12);
  return cnpj === base + digit(base) + digit(base + digit(base));
}
export const cnpjInput = z
  .string()
  .max(30)
  .transform(normalizeCnpj)
  .refine(validCnpj, "Informe um CNPJ válido.");
export function safeHttps(value: unknown) {
  if (typeof value !== "string" || value.length > 2000) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}
const text = z.string().trim().max(300);
export const companyFields = z
  .object({
    placeId: z
      .string()
      .max(300)
      .regex(/^[A-Za-z0-9_-]*$/),
    // Empty means "Pendente": allowed only with a Google placeId (enforced in importInput).
    cnpj: z.union([z.literal(""), cnpjInput]),
    legalName: text,
    tradeName: text,
    registrationStatus: text,
    segment: text,
    city: text,
    state: z.union([z.enum(BRAZIL_STATES), z.literal("")]),
    address: z.string().trim().max(700),
    phones: z.array(z.string().regex(/^\+?\d{8,15}$/)).max(10),
    whatsappNumbers: z.array(z.string().regex(/^\+?\d{8,15}$/)).max(10).optional(),
    partners: z.array(z.object({
      name: z.string().trim().min(1).max(200),
      role: z.string().trim().max(200),
      phones: z.array(z.string().regex(/^\+?\d{8,15}$/)).max(5),
    }).strict()).max(10).optional(),
    publicDetails: z.object({
      openedOn: z.string().max(30),
      cnae: z.string().max(30),
      postalCode: z.string().max(20),
      capital: z.number().finite().nonnegative().nullable(),
      revenueEstimate: z.number().finite().nonnegative().nullable(),
      revenueSource: z.string().max(500),
      companySize: z.string().max(100).optional(),
      registrySource: z.string().max(100).optional(),
    }).strict().optional(),
    evidence: z.array(z.object({
      source: z.string().max(100), reference: z.string().max(500),
      checkedAt: z.string().datetime(), fields: z.array(z.string().max(50)).max(30),
      kind: z.enum(["reported", "estimated"]),
    }).strict()).max(20).optional(),
    emails: z
      .array(
        z
          .string()
          .trim()
          .email()
          .max(254)
          .transform((s) => s.toLowerCase()),
      )
      .max(10),
    website: z.union([
      z.literal(""),
      z
        .string()
        .max(2000)
        .refine((value) => Boolean(safeHttps(value)), "Use um site HTTPS."),
    ]),
    instagram: z.union([z.literal(""), z.string().max(2000).refine(value => Boolean(safeHttps(value)), "Use um link Instagram HTTPS.")]).optional(),
    source: z.enum(["manual", "deskdata", "lista", "instagram"]),
    contactName: z.string().trim().max(200).optional(),
    contactRole: z.string().trim().max(200).optional(),
    notes: z.string().trim().max(1000).optional(),
    sourceReference: z.string().trim().min(3).max(500),
    identityConfirmed: z.literal(true),
    storageAuthorized: z.literal(true),
  })
  .strict();
export const companyInput = companyFields.superRefine((company, ctx) => {
    if (company.cnpj || company.legalName) {
      if (company.legalName.length < 2)
        ctx.addIssue({ code: "custom", path: ["legalName"], message: "Informe a razão social com pelo menos 2 caracteres para o CNPJ identificado." });
    } else {
      if (!company.placeId && !(company.source === "lista" && company.emails.length) && !(company.source === "instagram" && company.instagram))
        ctx.addIssue({ code: "custom", path: ["placeId"], message: "Empresa sem CNPJ precisa do identificador do Google Maps ou do perfil do Instagram." });
      if (company.tradeName.length < 2)
        ctx.addIssue({ code: "custom", path: ["tradeName"], message: "Informe o nome comercial com pelo menos 2 caracteres." });
    }
  });
export type CompanyInput = z.infer<typeof companyInput>;
export type CompanyData = Omit<CompanyInput, "identityConfirmed" | "storageAuthorized">;
export const lookupInput = z
  .object({
    keyType: z.enum(["name", "cnpj"]),
    key: z.string().trim().min(2).max(150),
    confirmed: z.literal(true),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.keyType === "cnpj" && !validCnpj(value.key))
      ctx.addIssue({ code: "custom", path: ["key"], message: "Informe um CNPJ válido." });
  });
export function canLookupB2b(input: {
  keyType: "name" | "cnpj";
  key: string;
  confirmed: boolean;
  deskReady: boolean;
  databaseReady: boolean;
  busy: boolean;
}) {
  return (
    !input.busy &&
    input.deskReady &&
    input.databaseReady &&
    lookupInput.safeParse({
      keyType: input.keyType,
      key: input.key,
      confirmed: input.confirmed,
    }).success
  );
}
export const importInput = z
  .object({
    pipelineId: z.string().uuid().nullable(),
    companies: z.array(companyInput).min(1).max(20),
    confirmed: z.literal(true),
  })
  .strict()
  .refine(
    (v) => v.companies.every((c) => c.cnpj || c.placeId || (c.source === "lista" && c.emails.length > 0) || (c.source === "instagram" && Boolean(c.instagram))),
    "Empresa sem CNPJ precisa do identificador do Google Maps ou do perfil do Instagram.",
  )
  .refine(
    (v) =>
      new Set(v.companies.map((c) => c.cnpj || (c.placeId ? `place:${c.placeId}` : c.source === "instagram" ? `ig:${c.instagram?.toLowerCase()}` : `email:${c.emails[0]}`))).size ===
      v.companies.length,
    "Há empresas repetidas na seleção.",
  );

export const EMAIL_TEMPLATES = [
  {
    id: "intro",
    name: "Apresentação",
    subject: "Uma conversa sobre {{segmento}}",
    body: "Olá, equipe da {{empresa}}.\n\nSou {{remetente}}, da Gravon Company. Gostaria de entender como vocês trabalham a captação de clientes no segmento de {{segmento}} e avaliar se podemos ajudar.\n\nFaz sentido conversarmos?\n\n{{remetente}}\nGravon Company\n\nSe não quiser receber novos contatos, responda solicitando o descadastramento.",
  },
  {
    id: "diagnosis",
    name: "Diagnóstico comercial",
    subject: "Captação de clientes — {{empresa}}",
    body: "Olá, equipe da {{empresa}}.\n\nSou {{remetente}}, da Gravon Company. Podemos conversar sobre os desafios de aquisição de clientes em {{segmento}}? A partir disso, avaliamos juntos se existe uma oportunidade de colaboração.\n\nObrigado,\n{{remetente}}\nGravon Company\n\nPara não receber novos contatos, basta responder solicitando o descadastramento.",
  },
];
export function renderEmail(text: string, company: string, segment: string, sender: string) {
  const values: Record<string, string> = {
    empresa: company,
    segmento: segment || "seu mercado",
    remetente: sender || "[seu nome]",
  };
  return text.replace(/\{\{(empresa|segmento|remetente)\}\}/g, (_, key: string) => values[key]);
}
export const draftInput = z
  .object({
    leadId: z.string().uuid(),
    recipient: z
      .string()
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    subject: z.string().trim().min(1).max(200),
    body: z.string().trim().min(10).max(6000),
    reviewed: z.boolean(),
  })
  .strict();
