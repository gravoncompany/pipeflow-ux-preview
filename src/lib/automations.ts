import { z } from "zod";
import { FLOW_MAX_STEPS, type FlowStep } from "./email-flows";
import { parseEmailBody } from "./email-content";

/**
 * Central de Automações (fase 1: e-mail). Regras puras: blocos do construtor visual,
 * compilação do desenho em etapas do mecanismo de Fluxos de E-mail e links rastreados.
 * Nada aqui acessa banco ou rede.
 */

export const AUTOMATION_NODE_KINDS = ["trigger", "ai", "email", "wait", "if_reply", "if_form", "update_card", "notify", "end"] as const;
export type AutomationNodeKind = (typeof AUTOMATION_NODE_KINDS)[number];

/** entry = card adicionado ao funil; manual = só os cards selecionados por uma pessoa no CRM. */
export type TriggerMode = "entry" | "manual";
export const TRIGGER_MODE_LABEL: Record<TriggerMode, string> = { entry: "Card adicionado ao funil", manual: "Início manual — Cards selecionados" };
export const triggerModeOf = (g: { nodes: { kind: string; data: unknown }[] }): TriggerMode =>
  (g.nodes.find((n) => n.kind === "trigger")?.data as { mode?: TriggerMode } | undefined)?.mode === "manual" ? "manual" : "entry";

export const NODE_LABEL: Record<AutomationNodeKind, string> = {
  trigger: "Card adicionado ao funil",
  ai: "Gravon IA: personalizar mensagem",
  email: "Enviar e-mail (Brevo)",
  wait: "Aguardar",
  if_reply: "Respondeu?",
  if_form: "Preencheu o formulário?",
  update_card: "Atualizar card",
  notify: "Enviar notificação",
  end: "Encerrar automação",
};

/** Canal da notificação do bloco "Enviar notificação" (mesmos canais da Central de Notificações). */
export type NotifyAction = { channel: "push" | "email" | "whatsapp"; message: string };

const text = (max: number) => z.string().max(max).default("");
export const cardActions = z.object({
  stage: text(80), tag: text(60), status: text(80),
}).strict();
export type CardActions = z.infer<typeof cardActions>;

const nodeData = {
  trigger: z.object({ pipelineId: z.string().uuid().nullable().default(null), mode: z.enum(["entry", "manual"]).default("entry") }).strict(),
  ai: z.object({ guidance: text(500) }).strict(),
  email: z.object({ subject: text(200), body: text(8000), cta: text(60) }).strict(),
  wait: z.object({ amount: z.number().int().min(1).max(720), unit: z.enum(["hours", "days"]) }).strict(),
  if_reply: z.object({}).strict(),
  if_form: z.object({}).strict(),
  update_card: cardActions,
  notify: z.object({ channel: z.enum(["push", "email", "whatsapp"]).default("push"), message: text(300) }).strict(),
  end: z.object({}).strict(),
} satisfies Record<AutomationNodeKind, z.ZodTypeAny>;

const base = { id: z.string().min(1).max(40), x: z.number().finite(), y: z.number().finite() };
export const graphNode = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("trigger"), data: nodeData.trigger }).strict(),
  z.object({ ...base, kind: z.literal("ai"), data: nodeData.ai }).strict(),
  z.object({ ...base, kind: z.literal("email"), data: nodeData.email }).strict(),
  z.object({ ...base, kind: z.literal("wait"), data: nodeData.wait }).strict(),
  z.object({ ...base, kind: z.literal("if_reply"), data: nodeData.if_reply }).strict(),
  z.object({ ...base, kind: z.literal("if_form"), data: nodeData.if_form }).strict(),
  z.object({ ...base, kind: z.literal("update_card"), data: nodeData.update_card }).strict(),
  z.object({ ...base, kind: z.literal("notify"), data: nodeData.notify }).strict(),
  z.object({ ...base, kind: z.literal("end"), data: nodeData.end }).strict(),
]);
export type GraphNode =
  | { id: string; x: number; y: number; kind: "trigger"; data: { pipelineId: string | null; mode?: TriggerMode } }
  | { id: string; x: number; y: number; kind: "ai"; data: { guidance: string } }
  | { id: string; x: number; y: number; kind: "email"; data: { subject: string; body: string; cta: string } }
  | { id: string; x: number; y: number; kind: "wait"; data: { amount: number; unit: "hours" | "days" } }
  | { id: string; x: number; y: number; kind: "if_reply" | "if_form" | "end"; data: Record<string, never> }
  | { id: string; x: number; y: number; kind: "update_card"; data: CardActions }
  | { id: string; x: number; y: number; kind: "notify"; data: NotifyAction };

export const graphEdge = z.object({
  id: z.string().min(1).max(90), source: z.string().min(1).max(40), target: z.string().min(1).max(40),
  branch: z.enum(["yes", "no"]).nullable().default(null),
}).strict();
export type GraphEdge = { id: string; source: string; target: string; branch: "yes" | "no" | null };

export const automationGraph = z.object({
  nodes: z.array(graphNode).min(1).max(60),
  edges: z.array(graphEdge).max(120),
}).strict();
export type AutomationGraph = { nodes: GraphNode[]; edges: GraphEdge[] };

/** Etapa compilada: extensão compatível da etapa dos Fluxos de E-mail. */
export type AutomationStep = FlowStep & { hours: number; ai: boolean; cta: string; signature: true };

export type CompiledAutomation = {
  pipelineId: string | null;
  steps: AutomationStep[];
  usesAi: boolean;
  usesLink: boolean;
  onReply: CardActions | null;
  onForm: CardActions | null;
  onFinish: CardActions | null;
  /** Notificação personalizada quando o contato responde / preenche o formulário. */
  onReplyNotify: NotifyAction | null;
  onFormNotify: NotifyAction | null;
  finishAfterHours: number;
  triggerMode: TriggerMode;
  /** "Atualizar card" logo depois de um e-mail: aplicado quando aquele e-mail é aceito pela Brevo; a cadência continua. */
  stepActions: { step: number; actions: CardActions }[];
};

export type CompileResult = { ok: true; compiled: CompiledAutomation } | { ok: false; errors: string[] };

export const LINK_PLACEHOLDER = "{{link_diagnostico}}";
export const AUTOMATION_VARIABLES = ["{{nome}}", "{{empresa}}", "{{segmento}}", "{{cidade}}", LINK_PLACEHOLDER] as const;

const MAX_OFFSET_HOURS = 119 * 24 + 23;
const emptyActions = (a: CardActions) => !a.stage.trim() && !a.tag.trim() && !a.status.trim();
const mergeActions = (list: CardActions[]): CardActions | null => {
  const out: CardActions = { stage: "", tag: "", status: "" };
  for (const a of list) {
    if (a.stage.trim()) out.stage = a.stage.trim();
    if (a.tag.trim()) out.tag = a.tag.trim();
    if (a.status.trim()) out.status = a.status.trim();
  }
  return emptyActions(out) ? null : out;
};

/**
 * Transforma o desenho em uma cadência linear (caminho "Não" das condições) e em ações
 * por evento (caminhos "Sim"). As condições valem durante toda a cadência: resposta ou
 * formulário interrompem os envios a qualquer momento.
 */
export function compileAutomation(graph: AutomationGraph): CompileResult {
  const errors: string[] = [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  if (byId.size !== graph.nodes.length) return { ok: false, errors: ["Há blocos repetidos no desenho."] };
  const triggers = graph.nodes.filter((n) => n.kind === "trigger");
  if (triggers.length !== 1) return { ok: false, errors: ["Use exatamente um bloco de gatilho “Card adicionado ao funil”."] };
  const out = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) { errors.push("Há uma ligação para um bloco que não existe."); continue; }
    if (e.target === triggers[0].id) errors.push("Nenhuma ligação pode voltar para o gatilho.");
    out.set(e.source, [...(out.get(e.source) ?? []), e]);
  }
  const isCond = (n: GraphNode) => n.kind === "if_reply" || n.kind === "if_form";
  const nextOf = (n: GraphNode, branch: "yes" | "no" | null) => {
    const list = (out.get(n.id) ?? []).filter((e) => (isCond(n) ? e.branch === branch : true));
    if (list.length > 1) errors.push(`O bloco “${NODE_LABEL[n.kind]}” tem mais de uma saída${isCond(n) ? ` no caminho ${branch === "yes" ? "Sim" : "Não"}` : ""}.`);
    return list[0] ? byId.get(list[0].target) ?? null : null;
  };

  const visited = new Set<string>();
  const steps: AutomationStep[] = [];
  let offset = 0, lastEmailOffset = -1, pendingAi = false, finishAt = -1;
  /** Ações depois de uma espera: só valem como conclusão (nenhum e-mail depois delas). */
  const finishActions: CardActions[] = [];
  const afterEmail = new Map<number, CardActions[]>();
  let onReply: CardActions | null | undefined, onForm: CardActions | null | undefined;
  let onReplyNotify: NotifyAction | null = null, onFormNotify: NotifyAction | null = null;
  let node: GraphNode | null = triggers[0];
  let reachedEnd = false;

  const branchActions = (start: GraphNode | null, label: string): { actions: CardActions | null; notify: NotifyAction | null } | null => {
    const acts: CardActions[] = [];
    let notify: NotifyAction | null = null;
    let cur = start;
    while (cur) {
      if (visited.has(cur.id)) { errors.push(`O caminho “Sim” de ${label} volta para um bloco já usado.`); return null; }
      visited.add(cur.id);
      if (cur.kind === "end") return { actions: mergeActions(acts), notify };
      if (cur.kind === "notify") {
        if (notify) { errors.push(`No caminho “Sim” de ${label}, use apenas um bloco “Enviar notificação”.`); return null; }
        if (!cur.data.message.trim()) { errors.push(`Escreva a mensagem do bloco “Enviar notificação” de ${label}.`); return null; }
        notify = { channel: cur.data.channel, message: cur.data.message.trim() };
      } else if (cur.kind !== "update_card") {
        errors.push(`No caminho “Sim” de ${label}, use apenas “Atualizar card”, “Enviar notificação” e “Encerrar automação”.`); return null;
      } else {
        acts.push(cur.data);
      }
      cur = nextOf(cur, null);
    }
    if (start) errors.push(`Termine o caminho “Sim” de ${label} com “Encerrar automação”.`);
    return { actions: mergeActions(acts), notify };
  };

  while (node) {
    if (visited.has(node.id)) { errors.push("O desenho tem um ciclo: a cadência precisa seguir em frente até “Encerrar automação”."); break; }
    visited.add(node.id);
    switch (node.kind) {
      case "trigger": break;
      case "ai": pendingAi = true; break;
      case "email": {
        const d = node.data;
        if (!d.subject.trim() || !d.body.trim()) errors.push(`Preencha assunto e mensagem do ${steps.length + 1}º e-mail.`);
        if (lastEmailOffset >= 0 && offset <= lastEmailOffset) errors.push(`Coloque um bloco “Aguardar” antes do ${steps.length + 1}º e-mail.`);
        if (offset > MAX_OFFSET_HOURS) errors.push("A cadência pode durar no máximo 120 dias.");
        if (finishActions.length) { errors.push("Coloque o “Atualizar card” logo depois de um “Enviar e-mail” (antes do “Aguardar”), ou no fim da cadência."); finishActions.length = 0; }
        steps.push({ day: Math.floor(offset / 24) + 1, hours: offset % 24, subject: d.subject.trim(), body: d.body.trim(), cta: d.cta.trim(), ai: pendingAi, signature: true });
        pendingAi = false; lastEmailOffset = offset;
        break;
      }
      case "wait": offset += node.data.amount * (node.data.unit === "days" ? 24 : 1); break;
      case "if_reply":
      case "if_form": {
        const label = node.kind === "if_reply" ? "“Respondeu?”" : "“Preencheu o formulário?”";
        if ((node.kind === "if_reply" ? onReply : onForm) !== undefined) { errors.push(`Use o bloco ${label} uma única vez.`); break; }
        const branch = branchActions(nextOf(node, "yes"), label);
        if (node.kind === "if_reply") { onReply = branch?.actions; onReplyNotify = branch?.notify ?? null; }
        else { onForm = branch?.actions; onFormNotify = branch?.notify ?? null; }
        break;
      }
      case "update_card": {
        if (lastEmailOffset < 0) { errors.push("Coloque o “Atualizar card” depois de um “Enviar e-mail”: o card já começa na primeira etapa do funil."); break; }
        if (offset === lastEmailOffset) {
          const i = steps.length - 1;
          afterEmail.set(i, [...(afterEmail.get(i) ?? []), node.data]);
        } else {
          if (!finishActions.length) finishAt = offset;
          finishActions.push(node.data);
        }
        break;
      }
      case "end": reachedEnd = true; break;
    }
    if (reachedEnd) break;
    const isC = isCond(node);
    const next = nextOf(node, isC ? "no" : null);
    if (!next) {
      errors.push(isC ? `Conecte o caminho “Não” de “${NODE_LABEL[node.kind]}”.` : `Conecte a saída de “${NODE_LABEL[node.kind]}” ou termine com “Encerrar automação”.`);
      break;
    }
    node = next;
  }

  if (pendingAi) errors.push("O bloco “Gravon IA” precisa vir antes de um e-mail.");
  if (!steps.length) errors.push("Adicione ao menos um bloco “Enviar e-mail”.");
  if (steps.length > FLOW_MAX_STEPS) errors.push(`Use no máximo ${FLOW_MAX_STEPS} e-mails por automação.`);
  for (const n of graph.nodes) if (!visited.has(n.id)) { errors.push(`O bloco “${NODE_LABEL[n.kind]}” não está ligado à automação.`); break; }
  for (const [i, s] of steps.entries()) {
    const issues = parseEmailBody(assembleBody(s.body, s.cta, "https://exemplo.com/link")).issues;
    if (issues.length) errors.push(`${i + 1}º e-mail: ${issues[0].message}`);
  }
  if (errors.length) return { ok: false, errors: [...new Set(errors)] };
  const end = finishActions.length ? finishAt : offset;
  const stepActions = [...afterEmail.entries()].map(([step, list]) => ({ step, actions: mergeActions(list) }))
    .filter((x): x is { step: number; actions: CardActions } => x.actions !== null).sort((a, b) => a.step - b.step);
  const usesLink = steps.some((s) => s.cta || s.body.includes(LINK_PLACEHOLDER) || s.subject.includes(LINK_PLACEHOLDER));
  return { ok: true, compiled: {
    pipelineId: (triggers[0].data as { pipelineId: string | null }).pipelineId,
    steps, usesAi: steps.some((s) => s.ai), usesLink,
    onReply: onReply ?? null, onForm: onForm ?? null, onFinish: mergeActions(finishActions),
    onReplyNotify, onFormNotify,
    finishAfterHours: Math.max(0, end - lastEmailOffset),
    stepActions, triggerMode: triggerModeOf(graph),
  } };
}

/** Requisitos para ligar (teste ou ativa); o rascunho pode ser salvo incompleto. */
export function activationIssues(c: CompiledAutomation, cfg: { landingUrl: string; testContacts: string[] }, mode: "test" | "active") {
  const issues: string[] = [];
  if (!c.pipelineId) issues.push("Escolha o funil do gatilho.");
  if (c.usesLink && !safeLandingUrl(cfg.landingUrl)) issues.push("Informe o endereço https:// da landing page do diagnóstico.");
  if (mode === "test" && !cfg.testContacts.length) issues.push("Adicione ao menos um e-mail de teste.");
  return issues;
}

export function safeLandingUrl(raw: string) {
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" && !u.username && !u.password && raw.trim().length <= 500 ? u.toString() : null;
  } catch { return null; }
}

/** Destino do clique: a landing page com UTMs que identificam a automação e o card. */
export function landingWithUtms(landing: string, automationSlug: string, token: string) {
  const u = new URL(landing);
  u.searchParams.set("utm_source", "pipeflow");
  u.searchParams.set("utm_medium", "email");
  u.searchParams.set("utm_campaign", automationSlug.slice(0, 80) || "automacao");
  u.searchParams.set("utm_content", `pf-${token}`);
  return u.toString();
}

export const isRunToken = (t: string) => /^[0-9a-f]{32}$/.test(t);
export const trackedLink = (origin: string, token: string) => `${origin}/api/public/r/${token}`;

export function slugify(name: string) {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

/** Corpo final: texto + botão do diagnóstico (linha própria). A assinatura entra no envio. */
export function assembleBody(body: string, cta: string, link: string) {
  const core = body.split(LINK_PLACEHOLDER).join(link).trim();
  return cta.trim() ? `${core}\n\n[botão: ${cta.trim().replace(/[|\]]/g, "")} | ${link}]` : core;
}

/** Variáveis além de {{nome}}/{{empresa}}; sem dado, usa termo neutro (nunca inventa). */
export function fillCompanyVars(text: string, v: { segment: string; city: string }) {
  return text
    .replace(/\{\{\s*segmento\s*\}\}/g, v.segment.trim() || "seu segmento")
    .replace(/\{\{\s*cidade\s*\}\}/g, v.city.trim() || "sua região");
}

/* ------------------------------ Estados ------------------------------ */

/**
 * Por que um card ativo não está recebendo o próximo e-mail agora (null = nada impede).
 * Só explica; quem decide enviar continua sendo o agendador com as travas do banco.
 */
export function runBlocker(x: {
  automationState: string; flowState: string | null; agentEnabled: boolean; status: string; nextSendAt: string | null; now?: number;
}): string | null {
  if (x.status !== "active") return null;
  if (x.automationState !== "test" && x.automationState !== "active") return "Automação pausada: o próximo e-mail espera ela ser ligada de novo.";
  if (x.flowState && x.flowState !== "active") return "Envio da automação pausado: o próximo e-mail espera ela ser ligada de novo.";
  if (!x.agentEnabled) return "Envio automático de e-mails desligado no Agente Comercial.";
  const due = x.nextSendAt ? Date.parse(x.nextSendAt) : NaN;
  if (Number.isFinite(due) && due < (x.now ?? Date.now()) - 20 * 60e3) return "Envio atrasado: aguardando a próxima execução automática (a cada 10 minutos, no site publicado).";
  return null;
}

export type AutomationState = "draft" | "test" | "active" | "paused" | "archived";
export const AUTOMATION_STATE_LABEL: Record<AutomationState, string> = {
  draft: "Desligada (rascunho)", test: "Em teste", active: "Ativa", paused: "Pausada", archived: "Arquivada",
};
export type RunEventKind = "enrolled" | "skipped" | "reply" | "opt_out" | "form" | "click" | "card_updated" | "paused" | "resumed" | "cancelled" | "finished" | "send_now"
  | "sent" | "send_failed" | "send_unknown" | "blocked";
export const RUN_EVENT_LABEL: Record<RunEventKind, string> = {
  enrolled: "Entrou na automação", skipped: "Não entrou", reply: "Respondeu", opt_out: "Pediu para não receber",
  form: "Preencheu o formulário", click: "Clicou no link", card_updated: "Card atualizado", paused: "Pausada no card",
  resumed: "Retomada no card", cancelled: "Cancelada no card", finished: "Cadência concluída", send_now: "Próximo envio antecipado (teste)",
  sent: "E-mail enviado", send_failed: "Envio recusado", send_unknown: "Envio com resultado desconhecido", blocked: "Envio bloqueado",
};

export const saveAutomationInput = z.object({
  id: z.string().uuid().nullable(),
  revision: z.number().int().min(0),
  name: z.string().trim().min(2).max(120),
  graph: automationGraph,
  landingUrl: z.string().trim().max(500),
  testContacts: z.array(z.string().trim().toLowerCase().email().max(254)).max(10),
  approveAi: z.boolean(),
}).strict();
export type SaveAutomationInput = z.infer<typeof saveAutomationInput>;

/* --------------------------- Modelo padrão --------------------------- */

/** Mesmo modelo de cinco e-mails, mas só entram os cards selecionados no CRM. Intervalos editáveis nos blocos "Aguardar". */
export function manualAutomationGraph(pipelineId: string | null): AutomationGraph {
  const g = defaultAutomationGraph(pipelineId);
  return { ...g, nodes: g.nodes.map((n) => (n.kind === "trigger" ? { ...n, data: { pipelineId, mode: "manual" as const } } : n)) };
}

/** Cinco e-mails em 18 dias (dias 1, 3, 7, 12 e 18), levando à landing page do diagnóstico. */
export function defaultAutomationGraph(pipelineId: string | null): AutomationGraph {
  const col = 280;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  let y = 0, prev = "";
  const add = (n: Omit<GraphNode, "x" | "y"> & { x?: number }, branch: "yes" | "no" | null = null) => {
    const node = { x: n.x ?? 0, y, ...n } as GraphNode;
    nodes.push(node);
    if (prev) edges.push({ id: `${prev}-${node.id}`, source: prev, target: node.id, branch });
    prev = node.id; y += 120;
    return node.id;
  };
  const side = (from: string, items: GraphNode[]) => {
    let p = from, b: "yes" | null = "yes";
    for (const n of items) { nodes.push(n); edges.push({ id: `${p}-${n.id}`, source: p, target: n.id, branch: b }); p = n.id; b = null; }
  };
  add({ id: "gatilho", kind: "trigger", data: { pipelineId } });
  add({ id: "email1", kind: "email", data: {
    subject: "{{empresa}}: mais clientes chegando pelo Google e Instagram",
    body: `Olá, {{nome}}! Tudo bem?\n\nSou da Gravon Company. Vi que a {{empresa}} atua com {{segmento}} em {{cidade}} e quis compartilhar uma ideia rápida.\n\nAjudamos empresas a atrair clientes com tráfego pago (Google Ads e Meta Ads) e a acompanhar cada contato até a venda no Pipeflow, nosso CRM com Inteligência Artificial. Assim, nenhum interessado fica sem resposta e você vê exatamente quanto cada campanha traz de retorno.\n\nPreparei uma página com o diagnóstico estratégico gratuito: em poucos minutos você conta como está hoje e nós mostramos onde estão as oportunidades.`,
    cta: "Quero meu diagnóstico gratuito" } });
  add({ id: "enviou1", kind: "update_card", data: { stage: "tentando-contato", tag: "", status: "" } });
  add({ id: "espera1", kind: "wait", data: { amount: 2, unit: "days" } });
  const r = add({ id: "respondeu", kind: "if_reply", data: {} as Record<string, never> });
  side(r, [
    { id: "resp-card", kind: "update_card", x: col, y: y - 120, data: { stage: "contato-realizado", tag: "", status: "Respondeu o e-mail da automação" } },
    { id: "resp-fim", kind: "end", x: col, y: y, data: {} as Record<string, never> },
  ]);
  prev = r;
  const step = (n: number, subject: string, body: string, cta: string, waitDays: number) => {
    add({ id: `ia${n}`, kind: "ai", data: { guidance: "" } }, n === 2 ? "no" : null);
    add({ id: `email${n}`, kind: "email", data: { subject, body, cta } });
    add({ id: `espera${n}`, kind: "wait", data: { amount: waitDays, unit: "days" } });
  };
  step(2, "Re: {{empresa}}: uma ideia para {{cidade}}",
    "Olá, {{nome}}!\n\nRetomando meu e-mail: empresas de {{segmento}} costumam perder clientes porque o anúncio até gera contatos, mas o atendimento não acompanha. Na Gravon, campanha e atendimento andam juntos: o Pipeflow organiza as conversas do WhatsApp e a Gravon IA aponta quem está pronto para comprar.\n\nSe quiser ver como isso ficaria para a {{empresa}}, o diagnóstico leva poucos minutos.",
    "Fazer o diagnóstico", 4);
  const f = add({ id: "formulario", kind: "if_form", data: {} as Record<string, never> });
  side(f, [
    { id: "form-card", kind: "update_card", x: col, y: y - 120, data: { stage: "qualificacao", tag: "quente", status: "Preencheu o diagnóstico estratégico" } },
    { id: "form-fim", kind: "end", x: col, y: y, data: {} as Record<string, never> },
  ]);
  prev = f;
  add({ id: "ia3", kind: "ai", data: { guidance: "" } }, "no");
  add({ id: "email3", kind: "email", data: {
    subject: "Como empresas de {{segmento}} estão atraindo clientes",
    body: "Olá, {{nome}}!\n\nUm ponto que vemos muito: investir em anúncio sem saber quantos contatos viraram clientes. Com a Gravon você acompanha o investimento, os contatos e as vendas no mesmo lugar, com relatórios claros no Portal Gravon.\n\nO diagnóstico mostra por onde começar na {{empresa}}, sem compromisso.",
    cta: "Ver meu diagnóstico" } });
  add({ id: "espera3", kind: "wait", data: { amount: 5, unit: "days" } });
  add({ id: "ia4", kind: "ai", data: { guidance: "" } });
  add({ id: "email4", kind: "email", data: {
    subject: "{{nome}}, ainda faz sentido?",
    body: "Olá, {{nome}}!\n\nSei que a rotina é corrida, por isso vou direto: se atrair mais clientes em {{cidade}} está nos planos da {{empresa}}, o diagnóstico gratuito é o primeiro passo. Se preferir, é só responder este e-mail com o melhor horário.",
    cta: "Quero conversar" } });
  add({ id: "espera4", kind: "wait", data: { amount: 6, unit: "days" } });
  add({ id: "ia5", kind: "ai", data: { guidance: "" } });
  add({ id: "email5", kind: "email", data: {
    subject: "Última mensagem por aqui",
    body: "Olá, {{nome}}!\n\nEsta é minha última mensagem por e-mail. Se em algum momento quiser entender como o tráfego pago e o Pipeflow podem trazer mais clientes para a {{empresa}}, o diagnóstico continua disponível no link abaixo.\n\nObrigado pela atenção!",
    cta: "Acessar o diagnóstico" } });
  add({ id: "espera5", kind: "wait", data: { amount: 3, unit: "days" } });
  add({ id: "concluiu", kind: "update_card", data: { stage: "", tag: "", status: "Cadência de e-mail concluída sem resposta" } });
  add({ id: "fim", kind: "end", data: {} as Record<string, never> });
  return { nodes, edges };
}
