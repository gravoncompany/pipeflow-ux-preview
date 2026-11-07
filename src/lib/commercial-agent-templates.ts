import type { Stage } from "./crm-types";

/**
 * Pre-filled starting point for the Pipeflow CRM campaign funnel. It only fills the form for review:
 * nothing is saved or enabled, and prices/promotions still come exclusively from Commercial Knowledge.
 */
export type AgentTemplate = {
  instructions: string; services: string[]; requirements: string; handoffKeywords: string[];
  allowedStages: string[]; stageMap: { novo?: string; atendimento?: string; qualificado?: string };
};

const norm = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

export function pipeflowCrmTemplate(stages: Pick<Stage, "id" | "title">[]): AgentTemplate {
  const find = (title: string) => stages.find((s) => norm(s.title) === norm(title))?.id;
  const allowed = ["Lead Novo", "Tentando Contato", "Contato Realizado", "Qualificação"].map(find).filter((x): x is string => Boolean(x));
  return {
    instructions: [
      "Você atende pessoas interessadas no Pipeflow CRM que chegaram pela campanha. Tom cordial, consultivo e direto, com mensagens curtas.",
      "Objetivo: entender a operação comercial do interessado e explicar como o Pipeflow CRM ajuda: CRM com IA, atendimento e histórico pelo WhatsApp, funil de vendas visual e prospecção B2B.",
      "Promoção de 75% OFF no primeiro mês: informe somente as condições cadastradas no Conhecimento Comercial. Se não estiverem cadastradas, diga que um consultor confirma as condições.",
      "Qualifique com uma pergunta natural por vez: segmento da empresa, quantas pessoas vendem, como controlam os leads hoje, volume de contatos pelo WhatsApp e interesse em prospecção B2B.",
      "Quando houver intenção de contratar, pedido de proposta, demonstração ou negociação, encaminhe para o atendimento humano.",
    ].join("\n"),
    services: ["CRM com IA", "Atendimento pelo WhatsApp", "Funil de vendas", "Prospecção B2B"],
    requirements: "Empresa com processo comercial ativo, interesse real em organizar leads e vendas com o Pipeflow CRM e disposição para conversar com um consultor ou receber uma proposta.",
    handoffKeywords: ["contratar", "proposta", "demonstração", "reunião", "contrato"],
    allowedStages: allowed,
    stageMap: { novo: find("Lead Novo"), atendimento: find("Contato Realizado"), qualificado: find("Qualificação") },
  };
}
