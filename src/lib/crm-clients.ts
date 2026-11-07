import { z } from "zod";

// Módulo Contatos/Clientes — tipos e validações compartilhadas (seguros para o navegador).

export const CLIENT_STATUS = {
  implantacao: "Em implantação",
  ativo: "Ativo",
  pausado: "Pausado",
  encerrado: "Encerrado",
} as const;
export type ClientStatus = keyof typeof CLIENT_STATUS;

export const CHARGE_STATUS = {
  pendente: "Pendente",
  pago: "Pago",
  vencido: "Vencido",
  cancelado: "Cancelado",
} as const;

export const TASK_STATUS = {
  pendente: "Pendente",
  em_andamento: "Em andamento",
  concluida: "Concluída",
} as const;

export const TASK_PRIORITY = { baixa: "Baixa", media: "Média", alta: "Alta", urgente: "Urgente" } as const;

export const RECORD_KIND = {
  reuniao: "Reunião",
  decisao: "Decisão",
  solicitacao: "Solicitação",
  campanha: "Alteração em campanha",
  observacao: "Observação comercial",
  compromisso: "Compromisso",
  pendencia: "Pendência",
} as const;

export const DOC_CATEGORY = {
  contrato: "Contrato",
  proposta: "Proposta",
  briefing: "Briefing",
  relatorio: "Relatório",
  apresentacao: "Apresentação",
  outro: "Outro",
} as const;

export const KNOWLEDGE_KIND = {
  cadastro: "Dados cadastrais",
  conversa: "Histórico de conversas",
  servico: "Serviços contratados",
  planejamento: "Planejamento aprovado",
  documento: "Documento autorizado",
  registro: "Registro ou decisão",
  tarefa: "Solicitação ou tarefa",
  campanha: "Dados de campanhas",
  preferencia: "Preferência de comunicação",
  manual: "Anotação manual",
  resumo: "Resumo inteligente",
} as const;
/** Rótulos de leitura (inclui o relatório da Gravon IA, que só o servidor grava). */
export const KNOWLEDGE_KIND_LABEL: Record<string, string> = { ...KNOWLEDGE_KIND, relatorio_ia: "Relatório da Gravon IA" };

export const RECURRENCE = {
  unica: "Única",
  semanal: "Semanal",
  quinzenal: "Quinzenal",
  mensal: "Mensal",
  personalizada: "Personalizada",
} as const;

const cnpj = z.string().regex(/^\d{14}$/, "CNPJ deve ter 14 dígitos numéricos.").or(z.literal(""));

export const clientInput = z
  .object({
    id: z.string().uuid().nullable(),
    leadId: z.string().uuid().nullable(),
    tradeName: z.string().trim().min(2, "Informe o nome da empresa.").max(200),
    legalName: z.string().trim().max(200),
    cnpj,
    contactName: z.string().trim().max(200),
    phone: z.string().trim().max(40),
    whatsapp: z.string().trim().max(40),
    email: z.string().trim().max(200),
    address: z.string().trim().max(500),
    website: z.string().trim().max(500),
    relationshipStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    services: z.array(z.string().trim().min(1).max(120)).max(30),
    status: z.enum(["implantacao", "ativo", "pausado", "encerrado"]),
    internalResponsible: z.string().trim().max(160),
    reminderDays: z.number().int().min(0).max(60),
    notes: z.string().max(5000),
    revision: z.number().int().min(0),
  })
  .strict();
export type ClientInput = z.infer<typeof clientInput>;

export const convertInput = z
  .object({
    leadId: z.string().uuid(),
    status: z.enum(["implantacao", "ativo", "pausado", "encerrado"]),
    internalResponsible: z.string().trim().max(160),
    services: z.array(z.string().trim().min(1).max(120)).max(30),
    notes: z.string().max(5000),
    confirmed: z.literal(true),
  })
  .strict();

export const knowledgeInput = z
  .object({
    clientId: z.string().uuid(),
    kind: z.enum(Object.keys(KNOWLEDGE_KIND) as [keyof typeof KNOWLEDGE_KIND, ...string[]]),
    title: z.string().trim().max(300),
    text: z.string().trim().min(1, "Escreva o conteúdo.").max(20000),
    source: z.string().trim().max(300),
  })
  .strict();

export const planSaveInput = z
  .object({
    clientId: z.string().uuid(),
    planId: z.string().uuid().nullable(),
    title: z.string().trim().min(2).max(300),
    content: z.string().min(1, "O planejamento está vazio.").max(100000),
    origin: z.enum(["manual", "ia"]),
    expectedVersion: z.number().int().min(0),
  })
  .strict();

export const recordInput = z
  .object({
    clientId: z.string().uuid(),
    kind: z.enum(Object.keys(RECORD_KIND) as [keyof typeof RECORD_KIND, ...string[]]),
    description: z.string().trim().min(1, "Descreva o registro.").max(10000),
  })
  .strict();

export const taskInput = z
  .object({
    id: z.string().uuid().nullable(),
    clientId: z.string().uuid(),
    title: z.string().trim().min(2, "Informe o título.").max(300),
    description: z.string().max(5000),
    responsible: z.string().trim().max(160),
    priority: z.enum(["baixa", "media", "alta", "urgente"]),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    status: z.enum(["pendente", "em_andamento", "concluida"]),
    revision: z.number().int().min(0),
  })
  .strict();

export const chargeInput = z
  .object({
    id: z.string().uuid().nullable(),
    clientId: z.string().uuid(),
    description: z.string().trim().min(2, "Descreva a cobrança.").max(300),
    amount: z.number().min(0).max(100000000),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe o vencimento."),
    recurrence: z.enum(["unica", "semanal", "quinzenal", "mensal", "personalizada"]),
    recurrenceInterval: z.number().int().min(0).max(365),
    paymentMethod: z.string().trim().max(120),
    revision: z.number().int().min(0),
  })
  .strict();

export const paymentInput = z
  .object({
    chargeId: z.string().uuid(),
    amount: z.number().positive("Informe o valor recebido.").max(100000000),
    method: z.string().trim().max(120),
    note: z.string().max(2000),
    confirmed: z.literal(true),
  })
  .strict();

/** Próximas ocorrências de uma recorrência (mesma regra da RPC: 12 meses à frente). */
export function recurrenceStepDays(recurrence: string, interval: number): number | "month" | null {
  if (recurrence === "semanal") return 7;
  if (recurrence === "quinzenal") return 14;
  if (recurrence === "mensal") return "month";
  if (recurrence === "personalizada" && interval >= 1 && interval <= 365) return interval;
  return null;
}
