import { z } from "zod";
import { literal, qualify, stageRole, type Msg, type Qualification, type QualificationCriteria } from "./pipeline-ai";
import type { Stage } from "./crm-types";

// Structured verdict reused from the Gravon Tech Commercial Agent (Pipeflow Multiempresas, lovable-sync).
export const agentVerdictSchema = z.object({
  humanRequired: z.boolean(), humanReason: z.string(), knowledgeTitles: z.array(z.string()), response: z.string(), situation: z.string(), interest: z.string(), nextAction: z.string(),
  atendimentoIniciado: z.boolean(), evidenciaAtendimento: z.string(), intencaoComercial: z.boolean(), evidenciaIntencao: z.string(), agendamento: z.boolean(), evidenciaAgendamento: z.string(), fechamento: z.boolean(), evidenciaFechamento: z.string(), confiancaFechamento: z.number(), perda: z.boolean(), evidenciaPerda: z.string(), confiancaPerda: z.number(), orcamentoEnviado: z.boolean(), evidenciaOrcamento: z.string(), motivo: z.string(), localizacao: z.string(), evidenciaLocalizacao: z.string(), servicoSolicitado: z.string(), servicoCompativel: z.boolean().nullable(), atendeRequisitos: z.boolean().nullable(),
}).strict();
export type AgentVerdict = z.infer<typeof agentVerdictSchema>;

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Situations that always go to a person, plus the funnel's own handoff keywords. */
export function humanRisk(text: string, keywords: string[] = []): string | null {
  const s = plain(text);
  if (/\b(desconto|negociar|parcelamento especial|condicao especial|condicoes especiais|mais barato|baixar o preco|melhorar o preco|faz por menos)\b/.test(s)) return "Desconto ou condição especial exige atendimento humano.";
  if (/\b(reclamacao|reclamar|insatisfeit|pessimo|procon|processo|advogad|juridic|cancel|estorno|reembolso|devolver o dinheiro|devolucao|nao gostei|nao funcionou|nao resolveu|nao cumpriu|dinheiro de volta)/.test(s)) return "Reclamação, cancelamento ou questão jurídica exige atendimento humano.";
  if (/\b(atendente|falar com (um|uma|alguem|o|a) (pessoa|humano|consultor|vendedor|atendente)|pessoa de verdade|humano)\b/.test(s)) return "O cliente pediu atendimento humano.";
  const hit = keywords.map((k) => k.trim()).filter((k) => k.length >= 2).find((k) => s.includes(plain(k)));
  return hit ? `Palavra de transferência configurada no funil: "${hit}".` : null;
}

const COMMERCIAL_TERMS = /\b(r\$|reais|preco|valor|custa|custo|mensalidade|desconto|prazo|garantia|parcel|condic|promoc|gratis|gratuito|plano)/;

/**
 * Grounding gate before any send (from the Gravon Tech agent): cited titles must exist, every number must
 * appear in the cited knowledge, and commercial statements require citations. Plain greetings or a
 * clarifying question without numbers or commercial terms may go without a citation.
 */
export function safeAgentResponse(v: AgentVerdict, knowledge: { title: string; text: string }[], inbound: string, maxChars = 800, keywords: string[] = []) {
  const risk = humanRisk(inbound, keywords);
  if (risk || v.humanRequired) return { text: null, reason: risk ?? (v.humanReason.trim() || "Situação ambígua; atendimento humano necessário.") };
  const text = v.response.trim();
  if (!text || text.length > maxChars) return { text: null, reason: "Resposta ausente ou fora do limite de segurança." };
  if (/[*_`#]|\]\(|https?:\/\//.test(text)) return { text: null, reason: "Resposta com formatação ou link não permitido." };
  if (v.knowledgeTitles.some((t) => !knowledge.some((k) => k.title === t))) return { text: null, reason: "Resposta cita registro inexistente no Conhecimento Comercial." };
  const cited = knowledge.filter((k) => v.knowledgeTitles.includes(k.title));
  const numbers = text.match(/\d+(?:[.,:]\d+)*/g) ?? [];
  if (!cited.length && (numbers.length || COMMERCIAL_TERMS.test(plain(text)))) return { text: null, reason: "Resposta sem base comercial verificável." };
  const known = cited.map((k) => plain(k.text)).join("\n");
  if (numbers.some((n) => !known.includes(n))) return { text: null, reason: "Preço, prazo ou informação numérica não cadastrado na base citada." };
  return { text, reason: null };
}

export type StageMap = Partial<Record<"novo" | "atendimento" | "qualificado", string>>;
const ORDER = ["novo", "atendimento", "qualificado"] as const;

/** Explicit funnel mapping wins; otherwise unique stage titles are recognised (never on the main funnel). */
export function resolveStageRoles(stages: Stage[], map: StageMap, mainFunnel: boolean): StageMap {
  const out: StageMap = {};
  for (const role of ORDER) {
    const explicit = map[role];
    if (explicit && stages.some((s) => s.id === explicit)) { out[role] = explicit; continue; }
    if (mainFunnel || explicit) continue;
    const matches = stages.filter((s) => stageRole(s) === role);
    if (matches.length === 1) out[role] = matches[0]!.id;
  }
  return out;
}

export type AgentDecision = { kind: "move" | "suggest" | "none"; target?: string; evidence?: string; side?: "cliente" | "empresa"; reason: string; qualification: Qualification };

/**
 * Forward-only moves inside the configured flow: Novo → Em atendimento after the agent's reply and
 * → Qualificado with literal client intent plus the funnel's criteria. Scheduling, quotes, wins and
 * losses are recorded as suggestions only.
 */
export function decideAgentMove(input: { current: string; stages: Stage[]; stageMap: StageMap; mainFunnel: boolean; verdict: AgentVerdict; messages: Msg[]; criteria: QualificationCriteria; reply: string | null; moveStages?: string[] | null }): AgentDecision {
  const decision = decideAgentMoveTarget(input);
  // "Regras do Pipeline": moving is a separate permission from replying; null keeps the legacy stage mapping.
  if (decision.kind === "move" && input.moveStages && !input.moveStages.includes(decision.target ?? ""))
    return { kind: "suggest", reason: "Sem permissão para mover o card para esta etapa: revisão humana.", qualification: decision.qualification };
  return decision;
}

function decideAgentMoveTarget(input: { current: string; stages: Stage[]; stageMap: StageMap; mainFunnel: boolean; verdict: AgentVerdict; messages: Msg[]; criteria: QualificationCriteria; reply: string | null }): AgentDecision {
  const { verdict: v, messages } = input;
  const qualification = qualify(v, messages, input.criteria);
  const roles = resolveStageRoles(input.stages, input.stageMap, input.mainFunnel);
  const rank = ORDER.findIndex((r) => roles[r] === input.current);
  const suggestion = v.fechamento ? "Possível fechamento" : v.perda ? "Possível perda" : v.agendamento ? "Possível agendamento" : v.orcamentoEnviado ? "Possível orçamento" : null;
  if (rank < 0) return { kind: suggestion ? "suggest" : "none", reason: suggestion ? `${suggestion}: revisão humana.` : "Etapa atual fora do fluxo automático do agente.", qualification };
  const intent = v.intencaoComercial && literal(v.evidenciaIntencao, messages, "cliente");
  if (roles.qualificado && rank < 2 && intent && qualification.status === "qualificado")
    return { kind: "move", target: roles.qualificado, evidence: v.evidenciaIntencao.trim(), side: "cliente", reason: `Lead qualificado: ${qualification.reason}`, qualification };
  const reply = input.reply?.trim() ?? "";
  if (roles.atendimento && rank < 1 && reply.length >= 3)
    return { kind: "move", target: roles.atendimento, evidence: reply.slice(0, 60).trim(), side: "empresa", reason: "Atendimento iniciado pela Gravon IA.", qualification };
  if (suggestion) return { kind: "suggest", reason: `${suggestion}: revisão humana.`, qualification };
  return { kind: "none", reason: qualification.reason, qualification };
}

export function criteriaFrom(settings: { served_regions: string[]; excluded_regions: string[]; services: string[]; qualification_requirements: string }, adMessages: string[]): QualificationCriteria {
  return { servedRegions: settings.served_regions, excludedRegions: settings.excluded_regions, services: settings.services, requirements: settings.qualification_requirements, adMessages };
}

/** Same rule as the claim RPC (America/Sao_Paulo); used for status display. */
export function withinBusinessHours(at: Date, days: number[], start: string, end: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const time = `${get("hour").replace("24", "00")}:${get("minute")}:${get("second")}`;
  const norm = (t: string) => (t.length === 5 ? `${t}:00` : t.slice(0, 8));
  return days.includes(dow) && time >= norm(start) && time < norm(end);
}

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/);
const list = (max: number, len: number) => z.array(z.string().trim().min(1).max(len)).max(max);
export const agentSettingsInput = z.object({
  pipelineId: z.string().uuid().nullable(),
  revision: z.number().int().nonnegative(),
  enabled: z.boolean(),
  audience: z.enum(["test", "all"]),
  confirmAllAudience: z.boolean().default(false),
  instance: z.string().max(160),
  recipients: list(20, 40),
  allowedStages: list(100, 80),
  instructions: z.string().max(4000),
  servedRegions: list(50, 120), excludedRegions: list(50, 120), services: list(50, 160),
  requirements: z.string().max(2000),
  stageMap: z.object({ novo: z.string().max(80).optional(), atendimento: z.string().max(80).optional(), qualificado: z.string().max(80).optional() }).strict(),
  autoMove: z.boolean(),
  moveStages: list(100, 80).nullable().optional(),
  handoffKeywords: list(50, 80),
  pauseOnHumanReply: z.boolean(),
  humanPauseHours: z.number().int().min(1).max(720),
  businessDays: z.array(z.number().int().min(0).max(6)).max(7),
  dayStart: time, dayEnd: time,
  maxRepliesPerContactDay: z.number().int().min(1).max(50),
  maxRepliesPerDay: z.number().int().min(1).max(1000),
  maxReplyChars: z.number().int().min(100).max(800),
  maxMessageAgeMinutes: z.number().int().min(1).max(60),
}).strict().refine((v) => v.dayStart < v.dayEnd, "O horário final precisa ser depois do inicial.");
export type AgentSettingsInput = z.infer<typeof agentSettingsInput>;

export const AGENT_ERRORS: Record<string, string> = {
  test_numbers_required: "Informe de 1 a 20 números de teste autorizados, diferentes do número do WhatsApp conectado.",
  incomplete_settings: "Para ativar, escolha o WhatsApp conectado e pelo menos uma etapa em que a IA pode responder.",
  audience_confirmation_required: "Atender todos os contatos exige confirmação explícita.",
  unknown_stage: "Há etapas que não existem neste funil.",
  unknown_pipeline: "O funil não existe ou foi arquivado.",
  settings_changed: "A configuração foi alterada em outra tela. Atualize antes de salvar.",
  invalid_number: "Confira os números informados (DDI + DDD + número).",
  invalid_settings: "Confira os campos da configuração.",
  unresolved_send: "Há um envio em verificação para este contato; aguarde antes de liberar.",
};
export function agentError(error: { message?: string } | null | undefined, fallback = "Não foi possível salvar a configuração do agente.") {
  const key = Object.keys(AGENT_ERRORS).find((k) => error?.message?.includes(k));
  return key ? AGENT_ERRORS[key]! : fallback;
}

export const RUN_STATUS: Record<string, string> = {
  pending: "Na fila", analyzing: "Analisando", sending: "Enviando — não repetir", accepted: "Aceita pelo WhatsApp", completed: "Respondida",
  human: "Transferida para humano", skipped: "Não respondida", unknown: "Envio incerto — revisar", failed: "Encerrada",
};
