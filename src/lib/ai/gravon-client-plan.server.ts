// Somente servidor: geração de planejamento estratégico e resumo inteligente do cliente.
// Reutiliza o mesmo provedor/modelo do chat interno da Gravon IA (OPENAI_API_KEY + Responses).

import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import { GRAVON_MODEL } from "../gravon-ai";

const PLAN_SYSTEM = `Você é a Gravon AI, estrategista interna da Gravon Company (agência de tráfego pago e marketing). Escreva em português do Brasil, tom profissional e direto. Gere um planejamento estratégico em Markdown com as seções: Diagnóstico, Objetivos, Público-alvo, Estratégias de marketing, Estratégias de vendas, Canais de aquisição, Metas, Indicadores e Cronograma. Use SOMENTE as informações fornecidas no pedido; nunca invente números, resultados, verbas ou datas. Quando uma informação não estiver disponível, escreva "A definir" na seção correspondente. O resultado é um rascunho para revisão humana — não afirme que algo já foi aprovado ou executado.`;

const SUMMARY_SYSTEM = `Você é a Gravon AI, assistente interna da Gravon Company. Escreva em português do Brasil um resumo executivo curto (até 12 linhas) do relacionamento com o cliente, usando SOMENTE as fontes fornecidas. Identifique: contexto do relacionamento, compromissos assumidos, pendências e preferências de comunicação. Nunca invente dados; se algo não constar nas fontes, não mencione.`;

async function generate(system: string, prompt: string): Promise<string> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) throw new Error("A geração com IA não está configurada neste ambiente.");
  const provider = createOpenAI({ apiKey });
  const result = streamText({
    model: provider.responses(GRAVON_MODEL),
    system,
    messages: [{ role: "user", content: prompt }],
    maxRetries: 0,
    providerOptions: {
      openai: { forceReasoning: true, reasoningEffort: "low", store: false },
    },
  });
  const text = (await result.text).trim();
  if (!text) throw new Error("A IA não retornou conteúdo; tente novamente.");
  return text.slice(0, 90000);
}

export interface ClientContext {
  client: Record<string, unknown>;
  knowledge: { kind: string; title: string; text: string }[];
  records: { kind: string; description: string; created_at: string }[];
  tasks: { title: string; status: string; due_date: string | null }[];
  approvedPlan: string | null;
}

function contextBlock(ctx: ClientContext): string {
  const c = ctx.client as any;
  const lines = [
    `Cliente: ${c.trade_name}${c.legal_name ? ` (${c.legal_name})` : ""}${c.cnpj ? ` — CNPJ ${c.cnpj}` : ""}`,
    `Situação: ${c.status} | Início do relacionamento: ${c.relationship_start ?? "não informado"}`,
    `Serviços contratados: ${(c.services ?? []).join(", ") || "não informados"}`,
    `Responsável interno: ${c.internal_responsible || "não informado"}`,
    `Observações cadastrais: ${c.notes || "nenhuma"}`,
  ];
  if (ctx.approvedPlan) lines.push(`\nPlanejamento aprovado vigente (estratégia atual, não substituir sem nova aprovação):\n${ctx.approvedPlan.slice(0, 12000)}`);
  if (ctx.knowledge.length) {
    lines.push("\nBase de conhecimento do cliente:");
    for (const k of ctx.knowledge.slice(0, 40)) lines.push(`- [${k.kind}] ${k.title ? k.title + ": " : ""}${k.text.slice(0, 800)}`);
  }
  if (ctx.records.length) {
    lines.push("\nRegistros e decisões recentes:");
    for (const r of ctx.records.slice(0, 30)) lines.push(`- [${r.kind}] ${r.description.slice(0, 500)}`);
  }
  if (ctx.tasks.length) {
    lines.push("\nTarefas e solicitações:");
    for (const t of ctx.tasks.slice(0, 30)) lines.push(`- (${t.status}) ${t.title}${t.due_date ? ` — prazo ${t.due_date}` : ""}`);
  }
  return lines.join("\n").slice(0, 60000);
}

export async function generateClientPlan(ctx: ClientContext, briefing: string): Promise<string> {
  const prompt = `${contextBlock(ctx)}\n\nBriefing do gestor para este planejamento:\n${briefing.trim() || "Elaborar planejamento estratégico completo com base nas informações disponíveis."}\n\nGere o planejamento estratégico em Markdown.`;
  return generate(PLAN_SYSTEM, prompt);
}

export async function generateClientSummary(ctx: ClientContext): Promise<string> {
  return generate(SUMMARY_SYSTEM, `${contextBlock(ctx)}\n\nEscreva o Resumo Inteligente do Cliente.`);
}
