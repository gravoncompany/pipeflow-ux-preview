import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { receitaSearch, hasReceitaFilter } from "./receita-federal";

export const getReceitaStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { requireB2bAccess } = await import("./b2b-prospecting.server");
  await requireB2bAccess();
  const { receitaPing } = await import("./receita-federal.server");
  try { return await receitaPing(); }
  catch (e) { return { connected: false as const, error: e instanceof Error ? e.message : "Falha na conexão." }; }
});
export const searchReceita = createServerFn({ method: "POST" })
  .inputValidator(input => receitaSearch.parse(input))
  .handler(async ({ data }) => {
    const { requireB2bAccess } = await import("./b2b-prospecting.server");
    await requireB2bAccess();
    if (!hasReceitaFilter(data)) throw new Error("Informe ao menos um filtro (CNPJ, CNAE, segmento, município ou nome).");
    const { receitaQuery } = await import("./receita-federal.server");
    const result = await receitaQuery(data);
    await requireB2bAccess();
    return result;
  });

/**
 * Completa razões sociais ausentes na base da VPS usando somente a consulta pública
 * gratuita de CNPJ (cache privado de 24 h, Minha Receita com BrasilAPI como transporte).
 * Nunca consome créditos DeskData; falhas deixam o campo como "Não informado".
 */
export const completeReceitaLegalNames = createServerFn({ method: "POST" })
  .inputValidator(input => z.object({ cnpjs: z.array(z.string().regex(/^\d{14}$/)).min(1).max(20) }).strict().parse(input))
  .handler(async ({ data }) => {
    const { requireB2bAccess } = await import("./b2b-prospecting.server");
    await requireB2bAccess();
    const { cachedPublicCompany } = await import("./b2b-public-enrichment.server");
    const names: Record<string, string> = {}, failed: string[] = [];
    for (const cnpj of [...new Set(data.cnpjs)]) {
      try {
        const company = await cachedPublicCompany(cnpj);
        if (company.legalName.trim()) names[cnpj] = company.legalName.trim();
      } catch { failed.push(cnpj); }
    }
    await requireB2bAccess();
    return { names, failed };
  });
