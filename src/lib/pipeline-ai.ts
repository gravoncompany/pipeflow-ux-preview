// Reused verbatim (except the company-only role helpers) from Pipeflow Multiempresas lovable-sync src/lib/pipeline-ai.ts.
/** Pure rules for Gravon IA pipeline qualification and stage decisions. */
export type StageRole = "novo" | "atendimento" | "qualificado" | "orcamento" | "agendado" | "fechado" | "perdido" | "other";
export type PipelineSource = "google_ads" | "meta_ads";
export const SOURCE_LABEL: Record<PipelineSource, string> = { google_ads: "Google Ads", meta_ads: "Meta Ads" };

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export function stageRole(stage: { id: string; title: string }): StageRole {
  const t = norm(stage.title), id = norm(stage.id);
  if (id === "novo" || t === "novo" || t === "novo contato" || t === "novo lead") return "novo";
  if (t.includes("atendimento")) return "atendimento";
  if (t.includes("qualificad")) return "qualificado";
  if (t.includes("orcamento") && (t.includes("enviad") || t.includes("apresentad"))) return "orcamento";
  if (t.includes("perdid") || t === "perda") return "perdido";
  if (t.includes("agendad")) return "agendado";
  if (t.includes("fechad") || t.includes("vendid") || t.includes("ganho")) return "fechado";
  return "other";
}

/** Origin of a card as captured by reference messages; never inferred from anything else. */
export function leadSource(lead: { tags?: unknown; source?: string | null }): PipelineSource | null {
  const tags = Array.isArray(lead.tags) ? lead.tags.map((t) => norm(String(t))) : [];
  const src = norm(lead.source ?? "");
  if (tags.includes("google-ads") || src === "google ads") return "google_ads";
  if (tags.includes("meta-ads") || src === "meta ads") return "meta_ads";
  return null;
}

export type AiVerdict = {
  atendimentoIniciado: boolean; evidenciaAtendimento: string;
  intencaoComercial: boolean; evidenciaIntencao: string;
  agendamento: boolean; evidenciaAgendamento: string;
  fechamento: boolean; evidenciaFechamento: string;
  orcamentoEnviado?: boolean; evidenciaOrcamento?: string;
  perda?: boolean; evidenciaPerda?: string;
  confiancaFechamento?: number; confiancaPerda?: number;
  motivo: string;
  localizacao?: string; evidenciaLocalizacao?: string;
  servicoSolicitado?: string; servicoCompativel?: boolean | null; atendeRequisitos?: boolean | null;
};
export type Msg = { from_me: boolean; body: string };

/** Evidence must be a literal excerpt of a message from the expected side. */
export function literal(evidence: string, msgs: Msg[], side: "empresa" | "cliente" | "any") {
  const e = norm(evidence);
  if (e.length < 3) return false;
  return msgs.some((m) => (side === "any" || (side === "empresa") === m.from_me) && norm(m.body).includes(e));
}

export type Decision = { kind: "move" | "suggest" | "none"; target?: string; reason: string; evidence?: string; qualification?: Qualification };

/** Company-configured commercial criteria. Empty lists mean "not restricted". */
export type QualificationCriteria = { servedRegions: string[]; excludedRegions: string[]; services: string[]; requirements: string; adMessages: string[] };
export const EMPTY_CRITERIA: QualificationCriteria = { servedRegions: [], excludedRegions: [], services: [], requirements: "", adMessages: [] };
export type Qualification = { status: "qualificado" | "desqualificado" | "insuficiente"; reason: string };

const plain = (s: string) => norm(s).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
/** Pre-filled texts that ad buttons/forms send on the client's behalf; they never prove qualification. */
const GENERIC_AD = ["quero agendar uma avaliacao", "gostaria de agendar uma avaliacao", "gostaria de mais informacoes", "quero mais informacoes", "quero saber mais", "tenho interesse", "ola tenho interesse e queria mais informacoes por favor", "ola gostaria de mais informacoes", "posso saber mais sobre isso", "ola quero agendar uma avaliacao", "quero fazer um orcamento", "gostaria de fazer um orcamento"];
export function isAutomaticMessage(body: string, adMessages: string[] = []) {
  const b = plain(body).replace(/^(ola|oi|bom dia|boa tarde|boa noite)\s+/, "");
  if (!b) return true;
  if (adMessages.some((m) => { const r = plain(m); return r.length > 0 && (plain(body) === r || b === r.replace(/^(ola|oi|bom dia|boa tarde|boa noite)\s+/, "")); })) return true;
  if (GENERIC_AD.some((g) => b === g || b === g.replace(/^ola /, ""))) return true;
  return /^vim atraves do (site|anuncio)\b/.test(b);
}
const mentions = (text: string, region: string) => { const r = plain(region); return r.length >= 3 && new RegExp(`(^| )${r.replace(/ /g, " ")}( |$)`).test(plain(text)); };

/** Qualification gate: real client replies, served region, compatible service and company requirements. */
export function qualify(v: AiVerdict, msgs: Msg[], c: QualificationCriteria = EMPTY_CRITERIA): Qualification {
  const genuine = msgs.filter((m) => !m.from_me && !isAutomaticMessage(m.body, c.adMessages));
  if (!genuine.length) return { status: "insuficiente", reason: "O cliente só enviou a mensagem automática do anúncio; ainda não há respostas reais." };
  const loc = v.localizacao?.trim() ?? "";
  const clientText = genuine.map((m) => m.body).join(" \n ");
  const excluded = c.excludedRegions.find((r) => mentions(clientText, r) || (loc && (mentions(loc, r) || mentions(r, loc))));
  if (excluded) return { status: "desqualificado", reason: `Região não atendida pela empresa: ${excluded}.` };
  if (c.servedRegions.length) {
    const locOk = loc && literal(v.evidenciaLocalizacao || loc, msgs, "cliente");
    if (!locOk) return { status: "insuficiente", reason: "Localização do cliente ainda não informada na conversa." };
    const served = c.servedRegions.find((r) => mentions(loc, r) || mentions(r, loc) || mentions(v.evidenciaLocalizacao ?? "", r));
    if (!served) return { status: "desqualificado", reason: `Localização "${loc}" fora das regiões atendidas (${c.servedRegions.join(", ")}).` };
  }
  if (!(v.intencaoComercial && literal(v.evidenciaIntencao, genuine, "cliente"))) return { status: "insuficiente", reason: "Sem resposta real do cliente demonstrando intenção comercial (a mensagem do anúncio não conta)." };
  if (c.services.length) {
    if (v.servicoCompativel === false) return { status: "desqualificado", reason: `Serviço solicitado incompatível: ${v.servicoSolicitado || "não informado"}.` };
    if (!v.servicoSolicitado?.trim() || v.servicoCompativel !== true) return { status: "insuficiente", reason: "Serviço desejado ainda não identificado na conversa." };
  }
  if (c.requirements.trim() && v.atendeRequisitos !== true) return { status: v.atendeRequisitos === false ? "desqualificado" : "insuficiente", reason: v.atendeRequisitos === false ? "Não atende aos requisitos de qualificação da empresa." : "Requisitos de qualificação da empresa ainda não confirmados." };
  return { status: "qualificado", reason: `Respostas reais do cliente com intenção comercial${loc ? `, região atendida (${loc})` : ""}${v.servicoSolicitado ? `, serviço: ${v.servicoSolicitado}` : ""}.` };
}

/** Existing AI qualification that predates the gate or rests only on an ad message needs human re-evaluation. */
export function reviewReason(run: { evidence: string | null; qualification: unknown }, adMessages: string[] = []): string | null {
  const parts = (run.evidence ?? "").split(" | ");
  const intentEvidence = parts[parts.length - 1] ?? "";
  if (intentEvidence && isAutomaticMessage(intentEvidence, adMessages)) return "Qualificado pela IA com base apenas na mensagem automática do anúncio.";
  if (!run.qualification) return "Qualificado pela IA antes dos critérios de região, serviço e requisitos.";
  return null;
}

/** Auto: Novo→Em atendimento (attendance), Em atendimento→Qualificado (clear intent). Agendado/Fechado: suggestion only. Forward only. */
export type AutomationOptions = { autoClose?: boolean; autoLost?: boolean };
export function decide(current: string, stages: { id: string; title: string }[], v: AiVerdict, msgs: Msg[], options: AutomationOptions = {}, criteria: QualificationCriteria = EMPTY_CRITERIA): Decision {
  return decideInner(current, stages, v, msgs, options, criteria);
}
function decideInner(current: string, stages: { id: string; title: string }[], v: AiVerdict, msgs: Msg[], options: AutomationOptions, criteria: QualificationCriteria): Decision {
  const role = (id: string) => stageRole(stages.find((s) => s.id === id) ?? { id, title: id });
  const find = (r: StageRole) => { const matches = stages.filter(s => stageRole(s) === r); return matches.length === 1 ? matches[0]?.id : undefined; };
  const cur = role(current);
  if (["fechado", "perdido", "other"].includes(cur)) return { kind: "none", reason: "Etapa final ou não reconhecida; sem movimentação automática." };
  const attended = v.atendimentoIniciado && literal(v.evidenciaAtendimento, msgs, "empresa");
  const intent = v.intencaoComercial && literal(v.evidenciaIntencao, msgs, "cliente");
  const closed = v.fechamento && literal(v.evidenciaFechamento, msgs, "cliente");
  const lost = v.perda && literal(v.evidenciaPerda ?? "", msgs, "cliente");
  const booked = v.agendamento && literal(v.evidenciaAgendamento, msgs, "any");
  const fechado = find("fechado"), perdido = find("perdido"), agendado = find("agendado");
  // Literal evidence alone is insufficient: explicit semantics and high confidence are required.
  const clearClose = !/\b(nao|se|talvez|ainda|vou pensar)\b|\?/.test(norm(v.evidenciaFechamento)) && /\b(aprovad[oa]|aprov[oa]|confirmo|contratad[oa]|fechado|pode(m)? (executar|realizar|iniciar)|aceito (o |a )?(orcamento|proposta))\b/.test(norm(v.evidenciaFechamento));
  const clearLost = /\b(nao (quero|vou|vamos|tenho interesse)|desisti|desistimos|cancel[oa]|cancelad[oa]|recuso|nao aprovado|contratei outra)\b/.test(norm(v.evidenciaPerda ?? ""));
  if (closed && fechado) return { kind: options.autoClose && !lost && clearClose && (v.confiancaFechamento ?? 0) >= 0.9 ? "move" : "suggest", target: fechado, reason: `Confirmação de contratação: ${v.motivo}`, evidence: v.evidenciaFechamento };
  if (lost && perdido) return { kind: options.autoLost && clearLost && (v.confiancaPerda ?? 0) >= 0.9 ? "move" : "suggest", target: perdido, reason: `Recusa ou desistência: ${v.motivo}`, evidence: v.evidenciaPerda };
  const orcamento = find("orcamento");
  const quoteEvidence = norm(v.evidenciaOrcamento ?? "");
  const presentedQuote = /\b(orcamento|proposta|valor|preco)\b/.test(quoteEvidence) && !/\b(vou enviar|vamos enviar|enviarei|preparar|preparando|elaborar|elaborando|nao enviei|ainda nao)\b/.test(quoteEvidence);
  if (v.orcamentoEnviado && presentedQuote && orcamento && ["novo", "atendimento", "qualificado"].includes(cur) && literal(v.evidenciaOrcamento ?? "", msgs, "empresa")) return { kind: "move", target: orcamento, reason: `Orçamento apresentado pela empresa: ${v.motivo}`, evidence: v.evidenciaOrcamento };
  if (booked && agendado && ["novo", "atendimento", "qualificado"].includes(cur)) return { kind: "suggest", target: agendado, reason: `Possível agendamento: ${v.motivo}`, evidence: v.evidenciaAgendamento };
  const atendimento = find("atendimento"), qualificado = find("qualificado");
  const q = qualify(v, msgs, criteria);
  const qualifiedOk = intent && q.status === "qualificado";
  const withQ = (dd: Decision): Decision => ({ ...dd, qualification: q, reason: `${dd.reason} · Qualificação: ${q.reason}` });
  if (cur === "novo" && qualifiedOk && !atendimento && qualificado) return withQ({ kind: "move", target: qualificado, reason: `Intenção comercial clara: ${v.motivo}`, evidence: v.evidenciaIntencao });
  if (cur === "novo" && attended) {
    if (qualifiedOk && qualificado && !atendimento) return withQ({ kind: "move", target: qualificado, reason: `Atendimento iniciado e intenção comercial clara: ${v.motivo}`, evidence: `${v.evidenciaAtendimento} | ${v.evidenciaIntencao}` });
    if (qualifiedOk && qualificado && atendimento) return withQ({ kind: "move", target: qualificado, reason: `Atendimento iniciado (Novo→Em atendimento) e intenção comercial clara (→Qualificado): ${v.motivo}`, evidence: `${v.evidenciaAtendimento} | ${v.evidenciaIntencao}` });
    if (atendimento) return withQ({ kind: "move", target: atendimento, reason: `Atendimento iniciado: ${v.motivo}`, evidence: v.evidenciaAtendimento });
  }
  if (cur === "atendimento" && qualifiedOk && qualificado) return withQ({ kind: "move", target: qualificado, reason: `Intenção comercial clara: ${v.motivo}`, evidence: v.evidenciaIntencao });
  return { kind: "none", reason: `${v.motivo || "Sem evidência suficiente para mover."} · Qualificação: ${q.reason}`, qualification: q };
}
