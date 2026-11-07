import { generateResponse, GatewayError } from "@lovable.dev/ai-gateway";
import { z } from "zod";
import * as bc from "../bank-classification";

const MODEL = "openai/gpt-6-astra";
const CREDIT_KINDS: bc.BankKind[] = ["receita_operacional", "entrada_pessoal", "resgate", "rendimento", "transferencia_interna", "emprestimo", "nao_classificado"];
const DEBIT_KINDS: bc.BankKind[] = ["despesa_operacional", "despesa_pessoal", "aplicacao", "transferencia_interna", "emprestimo", "nao_classificado"];

export type AiInput = { ref: string; direction: "CREDITO" | "DEBITO"; amountCents: number; day: string | null; description: string | null; counterparty: string | null; type: string | null; hint: string | null };
export type AiExample = { direction: string; description: string | null; counterparty: string | null; kind: string; category: string | null };
export type AiOutput = { ref: string; kind: bc.BankKind; category: bc.CostCategory | null; confidence: "alta" | "media" | "baixa"; reason: string };

const schema = {
  type: "object", additionalProperties: false, required: ["items"],
  properties: { items: { type: "array", items: { type: "object", additionalProperties: false, required: ["ref", "kind", "category", "confidence", "reason"], properties: {
    ref: { type: "string" },
    kind: { type: "string", enum: [...bc.BANK_KINDS] },
    category: { type: ["string", "null"], enum: [...bc.COST_CATEGORIES, null] },
    confidence: { type: "string", enum: ["alta", "media", "baixa"] },
    reason: { type: "string" },
  } } } },
} as const;
const parsed = z.object({ items: z.array(z.object({ ref: z.string(), kind: z.enum(bc.BANK_KINDS), category: z.enum(bc.COST_CATEGORIES).nullable(), confidence: z.enum(["alta", "media", "baixa"]), reason: z.string() })) });

/** Keeps only combinations the classification rules accept; anything else becomes a low-confidence "não classificado". */
export function sanitizeAiItem(input: AiInput, out: { kind: bc.BankKind; category: bc.CostCategory | null; confidence: "alta" | "media" | "baixa"; reason: string }): AiOutput {
  const allowed = input.direction === "CREDITO" ? CREDIT_KINDS : DEBIT_KINDS;
  const fallback: AiOutput = { ref: input.ref, kind: "nao_classificado", category: null, confidence: "baixa", reason: "Sem informação suficiente." };
  if (!allowed.includes(out.kind)) return fallback;
  const needsCategory = out.kind === "despesa_operacional" || out.kind === "despesa_pessoal";
  const category = needsCategory ? out.category : null;
  if (needsCategory && (!category || !bc.categoryAllowed(out.kind, category))) return fallback;
  let confidence = out.kind === "nao_classificado" ? "baixa" : out.confidence;
  // Business/personal-ambiguous items (energy, rent) are never high confidence.
  if (input.hint && confidence === "alta") confidence = "media";
  return { ref: input.ref, kind: out.kind, category, confidence, reason: out.reason.slice(0, 280) };
}

/** Suggests categories only; the caller stores them as suggestions and never confirms anything. */
export async function suggestBankCategories(items: AiInput[], examples: AiExample[]): Promise<AiOutput[]> {
  const cats = bc.COST_CATEGORIES.map((c) => `${c} = ${bc.CATEGORY_LABEL[c]}`).join("; ");
  try {
    const response = await generateResponse({
      model: MODEL,
      instructions: `Você classifica movimentações bancárias da conta PJ (Nubank) da Gravon Company, agência de tráfego pago.
Tipos (kind): receita_operacional (pagamento de cliente/serviço prestado), despesa_operacional (custo da agência), despesa_pessoal (gasto particular do sócio), entrada_pessoal, aplicacao, resgate, rendimento, transferencia_interna (entre contas próprias), emprestimo, nao_classificado.
Categorias (só para despesas; empresariais para despesa_operacional e pessoais para despesa_pessoal): ${cats}.
Regras: nunca presuma que toda entrada é faturamento nem que todo pagamento é despesa da operação. PIX para pessoa física sem contexto, nomes genéricos ou descrições vagas → nao_classificado com confiança baixa.
iFood, restaurantes, mercado e compras particulares → despesa_pessoal. Meta/Facebook/Google Ads, softwares, IA e hospedagem → despesa_operacional.
Use os exemplos confirmados pelo administrador como referência principal: mesmo pagador/descrição tende à mesma classificação.
Confiança "alta" só quando o nome/descrição deixa a natureza evidente ou há exemplo confirmado igual. Responda um item para cada ref recebida, motivo curto em português.`,
      input: [{ role: "user", content: JSON.stringify({ exemplosConfirmados: examples.slice(0, 60), movimentacoes: items }) }],
      text: { format: { type: "json_schema", name: "bank_classification", strict: true, schema } },
    });
    const text = (response as { output?: { type: string; content?: { type: string; text?: string }[] }[] }).output
      ?.flatMap((o) => (o.type === "message" ? o.content ?? [] : []))
      .filter((c) => c.type === "output_text").map((c) => c.text ?? "").join("") ?? "";
    const out = parsed.parse(JSON.parse(text)).items;
    const byRef = new Map(out.map((o) => [o.ref, o]));
    return items.map((i) => { const o = byRef.get(i.ref); return o ? sanitizeAiItem(i, o) : { ref: i.ref, kind: "nao_classificado" as const, category: null, confidence: "baixa" as const, reason: "Sem resposta da IA para esta movimentação." }; });
  } catch (error) {
    if (error instanceof GatewayError) {
      console.error("bank_ai_failed", { code: error.code, status: error.httpStatus });
      if (error.httpStatus === 402) throw new Error("Créditos de IA esgotados. Adicione créditos para continuar a classificação.");
      if (error.httpStatus === 429) throw new Error("Muitas análises seguidas. Aguarde um minuto e continue.");
    } else console.error("bank_ai_invalid");
    throw new Error("A Gravon IA não conseguiu sugerir agora. Nenhuma classificação foi alterada.");
  }
}
export const BANK_AI_MODEL = MODEL;
