import { z } from "zod";
import { normalizeCnpj, type CompanyData } from "./b2b-prospecting";
import { receitaCnaeDescription } from "./receita-cnae";
import { receitaMunicipioName } from "./receita-municipios";

export const RECEITA_STATUS = { "02": "Ativa", "03": "Suspensa", "04": "Inapta", "08": "Baixada", "01": "Nula" } as const;
const filterText = z.string().trim().max(150).default("");
export const receitaSearch = z.object({
  cnae: filterText, segment: filterText, municipality: filterText,
  cnaes: z.array(z.string().regex(/^\d{7}$/, "CNAE inválido.")).max(20, "Selecione no máximo 20 CNAEs.").default([]),
  uf: z.enum(["SC"]).default("SC"), status: z.enum(["", "01", "02", "03", "04", "08"]).default(""),
  tradeName: filterText, legalName: filterText,
  cnpj: z.string().max(30).transform(normalizeCnpj).refine(v => !v || /^\d{14}$/.test(v), "Informe os 14 dígitos do CNPJ." ).default(""),
  hasPhone: z.boolean().default(false), hasEmail: z.boolean().default(false),
  page: z.number().int().min(1).max(1000).default(1), pageSize: z.number().int().min(1).max(100).default(50),
}).strict();
export type ReceitaSearch = z.infer<typeof receitaSearch>;
const nullableText = z.string().max(700).nullable();
export const receitaRow = z.object({
  cnpj: z.string().regex(/^\d{14}$/), razao_social: nullableText, nome_fantasia: nullableText,
  cnae_principal: nullableText, cnae_descricao: nullableText.optional(), situacao_cadastral: nullableText,
  municipio_codigo: nullableText, municipio: nullableText, uf: z.literal("SC"), endereco: nullableText,
  cep: nullableText, telefone: nullableText, email: nullableText, porte: nullableText, data_abertura: nullableText,
}).strict();
export type ReceitaRow = z.infer<typeof receitaRow>;
export const receitaResponse = z.object({
  rows: z.array(receitaRow).max(100), total: z.number().int().nonnegative(),
  page: z.number().int().min(1).max(1000), pageSize: z.number().int().min(1).max(100),
  competence: z.string().regex(/^\d{4}-\d{2}$/).nullable(), updatedAt: z.string().datetime(),
}).strict();
/** E-mail válido para o filtro "Com e-mail": exclui vazio, espaços e texto sem formato de e-mail. */
export function receitaRowHasEmail(row: Pick<ReceitaRow, "email">): boolean {
  return Boolean(row.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email.trim()));
}
/** Telefone presente para o filtro "Com telefone": exclui vazio e sequências sem dígitos suficientes. */
export function receitaRowHasPhone(row: Pick<ReceitaRow, "telefone">): boolean {
  return Boolean(row.telefone && row.telefone.replace(/\D/g, "").length >= 8);
}
export function hasReceitaFilter(q: ReceitaSearch) {
  return Boolean(q.cnpj || q.cnae.replace(/\D/g, "") || q.cnaes.length || q.segment.replace(/\D/g, "").length >= 2 || q.municipality.trim() || q.tradeName.trim().length >= 3 || q.legalName.trim().length >= 3);
}
export function receitaCompany(row: ReceitaRow, competence: string | null): CompanyData {
  const phone = (row.telefone ?? "").replace(/\D/g, "");
  const email = z.string().email().safeParse(row.email?.trim().toLowerCase());
  return {
    placeId: "", cnpj: row.cnpj, legalName: row.razao_social ?? "", tradeName: row.nome_fantasia ?? "",
    registrationStatus: RECEITA_STATUS[row.situacao_cadastral as keyof typeof RECEITA_STATUS] ?? row.situacao_cadastral ?? "",
    segment: row.cnae_descricao ?? receitaCnaeDescription(row.cnae_principal) ?? row.cnae_principal ?? "", city: row.municipio ?? receitaMunicipioName(row.municipio_codigo) ?? "", state: row.uf,
    address: row.endereco ?? "", phones: /^\d{8,15}$/.test(phone) ? [phone] : [], whatsappNumbers: [],
    emails: email.success ? [email.data] : [], website: "", instagram: "", source: "manual",
    sourceReference: `Receita Federal — estabelecimentos SC${competence ? ` — competência ${competence}` : ""}`,
    publicDetails: { openedOn: row.data_abertura ?? "", cnae: row.cnae_principal ?? "", postalCode: row.cep ?? "", capital: null, revenueEstimate: null, revenueSource: "" },
  };
}
export function receitaApiUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.port && url.port !== "443" || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(url.hostname) || /(?:^|\.)(localhost|local|internal|test)$/.test(url.hostname) || /^\d+(?:\.\d+){3}$/.test(url.hostname)) throw new Error("Configure um endereço HTTPS público para a API da Receita.");
  return url;
}