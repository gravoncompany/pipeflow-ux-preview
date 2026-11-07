import { emailHtml, emailPlainText, parseEmailBody } from "./email-content";
import { z } from "zod";

/**
 * E-mail Marketing: regras puras (sem rede/banco) para validação de canal, agendamento com fuso
 * configurado, renderização segura do conteúdo e classificação das respostas do provedor.
 * E-mail usa o endereço salvo no card; descadastro, bloqueio e restrições da Brevo continuam excluindo.
 */

export const DEFAULT_CAMPAIGN_TIMEZONE = "America/Sao_Paulo";
/** Antecedência mínima para agendar (evita "agendar" algo que o provedor trataria como envio imediato). */
export const MIN_SCHEDULE_LEAD_MS = 5 * 60 * 1000;
/** Limite conservador de agendamento no provedor transacional (agendamento nativo da Brevo). */
export const MAX_SCHEDULE_AHEAD_MS = 72 * 60 * 60 * 1000;
/** Destinatários por confirmação: cada um gera uma requisição individual ao provedor. */
export const EMAIL_DISPATCH_LIMIT = 300;
/** Envios de teste por janela, para evitar uso do teste como canal de disparo. */
export const TEST_SEND_LIMIT = 5;
export const TEST_SEND_WINDOW_MS = 10 * 60 * 1000;

export const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "yahoo.com",
  "yahoo.com.br",
  "icloud.com",
  "bol.com.br",
  "uol.com.br",
  "terra.com.br",
  "protonmail.com",
  "proton.me",
]);

export function validTimezone(tz: string) {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(0);
    return true;
  } catch {
    return false;
  }
}

export const emailSettingsInput = z
  .object({
    senderEmail: z.string().trim().toLowerCase().email().max(254),
    senderName: z
      .string()
      .trim()
      .min(2)
      .max(70)
      .refine((v) => !/[\r\n<>"]/.test(v), "Nome inválido"),
    replyTo: z
      .string()
      .trim()
      .toLowerCase()
      .max(254)
      .refine(
        (v) => v === "" || z.string().email().safeParse(v).success,
        "E-mail de resposta inválido",
      ),
    timezone: z.string().trim().refine(validTimezone, "Fuso horário inválido"),
    revision: z.number().int().nonnegative(),
  })
  .strict();
export type EmailSettingsInput = z.infer<typeof emailSettingsInput>;
export type EmailSettings = {
  sender_email: string;
  sender_name: string;
  reply_to: string;
  timezone: string;
  revision: number;
  updated_at: string | null;
};
export const emptyEmailSettings: EmailSettings = {
  sender_email: "",
  sender_name: "",
  reply_to: "",
  timezone: DEFAULT_CAMPAIGN_TIMEZONE,
  revision: 0,
  updated_at: null,
};

function offsetMs(instant: number, tz: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(instant))
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)]),
  );
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** "AAAA-MM-DDTHH:mm" no fuso configurado → instante ISO UTC. Horários inexistentes (DST) são rejeitados. */
export function zonedLocalToUtc(local: string, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m || !validTimezone(tz)) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  if (Number.isNaN(naive)) return null;
  let guess = naive - offsetMs(naive, tz);
  guess = naive - offsetMs(guess, tz);
  return utcToZonedLocal(new Date(guess).toISOString(), tz) === local
    ? new Date(guess).toISOString()
    : null;
}

/** Instante ISO → "AAAA-MM-DDTHH:mm" no fuso configurado (para input datetime-local). */
export function utcToZonedLocal(iso: string, tz: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t) || !validTimezone(tz)) return "";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(new Date(t))
    .replace(" ", "T");
}

export function formatInZone(iso: string, tz: string) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleString("pt-BR", {
    timeZone: validTimezone(tz) ? tz : DEFAULT_CAMPAIGN_TIMEZONE,
    dateStyle: "short",
    timeStyle: "short",
  });
}

export type IssueCategory = "content" | "consent" | "sender" | "provider" | "schedule";
export const issueCategoryLabels: Record<IssueCategory, string> = {
  content: "Mensagem",
  consent: "Destinatários",
  sender: "Remetente",
  provider: "Serviço de e-mail",
  schedule: "Agendamento",
};
export type ReadinessIssue = {
  category: IssueCategory;
  code: string;
  message: string;
  action: string;
  blocking: boolean;
};
export type CheckState = "ok" | "pending" | "error";
export type ProviderCheck = {
  id: "credential" | "account" | "sender" | "domain";
  label: string;
  state: CheckState;
  detail: string;
  action: string;
};
export type ProviderStatus = {
  checkedAt: string;
  configured: boolean;
  reachable: boolean;
  senderActive: boolean;
  domainAuthenticated: boolean;
  freeMailDomain: boolean;
  checks: ProviderCheck[];
};

const TEMPLATE_SYNTAX = /\{\{(?!\s*(nome|empresa)\s*\}\})|\{%|%\}|\{#|#\}/;

export function emailContentIssues(input: { subject: string; body: string }): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];
  if (!input.subject.trim())
    issues.push({
      category: "content",
      code: "subject_missing",
      message: "Assunto vazio.",
      action: "Preencha o assunto do e-mail e salve o rascunho.",
      blocking: true,
    });
  if (/[\r\n]/.test(input.subject))
    issues.push({
      category: "content",
      code: "subject_newline",
      message: "Assunto com quebra de linha.",
      action: "Use o assunto em uma única linha.",
      blocking: true,
    });
  if (!input.body.trim())
    issues.push({
      category: "content",
      code: "body_missing",
      message: "Mensagem vazia.",
      action: "Escreva a mensagem e salve o rascunho.",
      blocking: true,
    });
  if (TEMPLATE_SYNTAX.test(input.subject) || TEMPLATE_SYNTAX.test(input.body))
    issues.push({
      category: "content",
      code: "template_syntax",
      message: "Marcadores não suportados no texto.",
      action: "Use apenas {{nome}} e {{empresa}}; remova outras chaves {{ }} ou {% %}.",
      blocking: true,
    });
  for (const m of parseEmailBody(input.body).issues)
    issues.push({ category: "content", code: m.code, message: m.message, action: "Corrija o bloco indicado no editor da mensagem e salve o rascunho.", blocking: true });
  return issues;
}

export function scheduleIssues(
  scheduledAt: string | null,
  tz: string,
  now = Date.now(),
): ReadinessIssue[] {
  if (!scheduledAt) return [];
  const t = Date.parse(scheduledAt);
  const when = formatInZone(scheduledAt, tz);
  if (Number.isNaN(t))
    return [
      {
        category: "schedule",
        code: "schedule_invalid",
        message: "Data pretendida inválida.",
        action: "Informe novamente a data e salve o rascunho.",
        blocking: true,
      },
    ];
  if (t <= now)
    return [
      {
        category: "schedule",
        code: "schedule_past",
        message: `A data pretendida (${when}, ${tz}) já passou.`,
        action:
          "Escolha uma data futura ou limpe o campo para enviar agora; depois salve o rascunho.",
        blocking: true,
      },
    ];
  if (t - now < MIN_SCHEDULE_LEAD_MS)
    return [
      {
        category: "schedule",
        code: "schedule_too_soon",
        message: `A data pretendida (${when}, ${tz}) está a menos de 5 minutos.`,
        action:
          "Escolha um horário com pelo menos 5 minutos de antecedência ou limpe o campo para enviar agora.",
        blocking: true,
      },
    ];
  if (t - now > MAX_SCHEDULE_AHEAD_MS)
    return [
      {
        category: "schedule",
        code: "schedule_too_far",
        message: `A data pretendida (${when}, ${tz}) passa de 72 horas.`,
        action:
          "O agendamento é feito pela Brevo com até 72 horas de antecedência. Mantenha o rascunho salvo e confirme mais perto da data.",
        blocking: true,
      },
    ];
  return [];
}

export function providerIssues(
  status: ProviderStatus,
  settings: EmailSettings,
  mode: "campaign" | "test",
): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];
  if (!settings.sender_email)
    issues.push({
      category: "sender",
      code: "sender_not_configured",
      message: "Remetente não configurado no CRM.",
      action:
        'Em "Canal de e-mail", informe o e-mail e o nome do remetente cadastrados na Brevo e salve.',
      blocking: true,
    });
  for (const c of status.checks) {
    if (c.state === "ok") continue;
    const blocking = c.id !== "domain" || mode === "campaign";
    issues.push({
      category: c.id === "credential" || c.id === "account" ? "provider" : "sender",
      code: `${c.id}_${c.state}`,
      message: c.detail,
      action: c.action,
      blocking,
    });
  }
  return issues;
}

export type Readiness = {
  ready: boolean;
  eligible: number;
  issues: ReadinessIssue[];
  reasons: string[];
};
export function emailReadiness(
  input: { subject: string; body: string; scheduledAt: string | null },
  status: ProviderStatus,
  settings: EmailSettings,
  eligible: number,
  now = Date.now(),
  providerCheck: { checked: boolean; ok: boolean; code: string; blockedCount: number } = {
    checked: false,
    ok: true,
    code: "",
    blockedCount: 0,
  },
): Readiness {
  const issues: ReadinessIssue[] = [...emailContentIssues(input)];
  if (eligible === 0)
    issues.push({
      category: "consent",
      code: "no_eligible",
      message: "Nenhum destinatário com e-mail válido e sem bloqueio.",
      action:
        'Use "Revisar destinatários" para ver o motivo de cada exclusão. Corrija o e-mail no card ou selecione outros contatos.',
      blocking: true,
    });
  if (providerCheck.checked && !providerCheck.ok)
    issues.push({
      category: "provider",
      code: `blocklist_${providerCheck.code}`,
      message:
        providerCheck.code === "too_many"
          ? "A lista de bloqueio da Brevo é grande demais para ser conferida por completo."
          : "Não foi possível consultar a lista de bloqueio da Brevo (falhas permanentes, reclamações e descadastros).",
      action: "Tente validar novamente em alguns minutos. Sem essa consulta o envio fica bloqueado.",
      blocking: true,
    });
  if (providerCheck.checked && providerCheck.ok && providerCheck.blockedCount > 0)
    issues.push({
      category: "provider",
      code: "provider_blocked_recipients",
      message: `${providerCheck.blockedCount} destinatário(s) bloqueado(s) pela Brevo foram excluídos.`,
      action: 'Veja o motivo em "Revisar destinatários" (restrições da Brevo).',
      blocking: false,
    });
  if (eligible > EMAIL_DISPATCH_LIMIT)
    issues.push({
      category: "consent",
      code: "too_many",
      message: `${eligible} destinatários elegíveis excedem o limite de ${EMAIL_DISPATCH_LIMIT} por campanha.`,
      action: "Divida os destinatários em campanhas menores.",
      blocking: true,
    });
  issues.push(
    ...scheduleIssues(input.scheduledAt, settings.timezone, now),
    ...providerIssues(status, settings, "campaign"),
  );
  const blocking = issues.filter((i) => i.blocking);
  return {
    ready: blocking.length === 0,
    eligible,
    issues,
    reasons: [...new Set(issues.map((i) => i.message))],
  };
}

/* ------------------------------ Conteúdo ------------------------------ */

export function escapeHtml(text: string) {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}
export function personalize(text: string, name: string, company: string) {
  return text.replace(/\{\{\s*(nome|empresa)\s*\}\}/g, (_, field: string) =>
    field === "nome" ? name : company,
  );
}
export const UNSUBSCRIBE_NOTE =
  "Você recebe esta mensagem da Gravon Company. Para não receber mais, responda a este e-mail com a palavra DESCADASTRAR.";
export function renderEmail(
  input: { subject: string; body: string },
  recipient: { name: string; company: string },
  test = false,
) {
  const subject =
    `${test ? "[TESTE] " : ""}${personalize(input.subject, recipient.name, recipient.company)}`
      .replace(/[\r\n]+/g, " ")
      .trim();
  const p = (t: string) => personalize(t, recipient.name, recipient.company);
  const text = `${emailPlainText(input.body, p)}\n\n--\n${UNSUBSCRIBE_NOTE}`;
  const html = emailHtml(input.body, UNSUBSCRIBE_NOTE, p, subject);
  return { subject, text, html };
}

/* -------------------------- Respostas da Brevo -------------------------- */

export type SendOutcome =
  | { state: "accepted"; messageId: string }
  | { state: "failed"; code: string }
  | { state: "unknown"; code: string };
/** Somente respostas explícitas de recusa contam como "não enviado"; o resto é desconhecido e nunca é reenviado. */
export function classifySend(status: number, body: unknown): SendOutcome {
  if (status === 201 || status === 202) {
    const id = z
      .object({ messageId: z.string().min(1).max(300) })
      .passthrough()
      .safeParse(body);
    return id.success
      ? { state: "accepted", messageId: id.data.messageId }
      : { state: "unknown", code: "accepted_without_id" };
  }
  if (status === 400 || status === 401 || status === 402 || status === 403 || status === 404) {
    const code = z
      .object({ code: z.string().max(80) })
      .passthrough()
      .safeParse(body);
    return {
      state: "failed",
      code: `http_${status}${code.success ? `_${code.data.code.replace(/[^a-z_]/gi, "").slice(0, 40)}` : ""}`,
    };
  }
  return { state: "unknown", code: `http_${status}` };
}

const sendersSchema = z
  .object({
    senders: z
      .array(z.object({ email: z.string().max(254), active: z.boolean().optional() }).passthrough())
      .max(1000),
  })
  .passthrough();
const domainsSchema = z
  .object({
    domains: z
      .array(
        z
          .object({
            domain_name: z.string().max(253),
            authenticated: z.boolean().optional(),
            verified: z.boolean().optional(),
          })
          .passthrough(),
      )
      .max(1000),
  })
  .passthrough();

export type ProviderProbe = {
  configured: boolean;
  account: { status: number } | { error: true } | null;
  senders: { status: number; body: unknown } | { error: true } | null;
  domains: { status: number; body: unknown } | { error: true } | null;
};

/** Monta o diagnóstico sem expor chave, IDs internos ou dados da conta. */
export function providerStatusFrom(
  probe: ProviderProbe,
  settings: EmailSettings,
  checkedAt = new Date().toISOString(),
): ProviderStatus {
  const checks: ProviderCheck[] = [];
  const sender = settings.sender_email;
  const domain = sender.split("@")[1] ?? "";
  const freeMailDomain = FREE_MAIL_DOMAINS.has(domain);
  if (!probe.configured) {
    checks.push({
      id: "credential",
      label: "Chave da API",
      state: "error",
      detail: "Chave da Brevo não configurada no servidor.",
      action:
        "Cadastre a variável de ambiente BREVO_API_KEY no servidor (Brevo › SMTP & API › API Keys) e atualize esta página. A chave nunca é exibida no CRM.",
    });
    return {
      checkedAt,
      configured: false,
      reachable: false,
      senderActive: false,
      domainAuthenticated: false,
      freeMailDomain,
      checks,
    };
  }
  checks.push({
    id: "credential",
    label: "Chave da API",
    state: "ok",
    detail: "Chave configurada no servidor.",
    action: "",
  });
  const account = probe.account;
  const reachable = Boolean(account && !("error" in account) && account.status === 200);
  if (!account || "error" in account)
    checks.push({
      id: "account",
      label: "Conta Brevo",
      state: "error",
      detail: "Não foi possível contatar a Brevo (rede, prazo de 10s ou redirecionamento).",
      action:
        "Tente novamente em instantes. Se persistir, verifique o status da Brevo e a saída de rede do servidor.",
    });
  else if (account.status === 401)
    checks.push({
      id: "account",
      label: "Conta Brevo",
      state: "error",
      detail: "A Brevo recusou a chave da API (HTTP 401).",
      action:
        "Gere uma nova chave em Brevo › SMTP & API e atualize BREVO_API_KEY. Verifique também se o IP do servidor não está bloqueado em Brevo › Segurança › IPs autorizados.",
    });
  else if (account.status === 403)
    checks.push({
      id: "account",
      label: "Conta Brevo",
      state: "error",
      detail: "A Brevo negou acesso à conta (HTTP 403).",
      action: "Confirme se a conta está ativa e se o envio transacional foi liberado pela Brevo.",
    });
  else if (account.status !== 200)
    checks.push({
      id: "account",
      label: "Conta Brevo",
      state: "error",
      detail: `A Brevo respondeu HTTP ${account.status} ao verificar a conta.`,
      action: "Tente novamente; erros 5xx indicam instabilidade do provedor.",
    });
  else
    checks.push({
      id: "account",
      label: "Conta Brevo",
      state: "ok",
      detail: "API disponível e chave aceita.",
      action: "",
    });

  let senderActive = false;
  if (!sender)
    checks.push({
      id: "sender",
      label: "Remetente",
      state: "pending",
      detail: "Remetente não configurado no CRM.",
      action: 'Informe o e-mail do remetente em "Canal de e-mail" e salve.',
    });
  else if (!reachable)
    checks.push({
      id: "sender",
      label: "Remetente",
      state: "pending",
      detail: "Remetente não verificado porque a conta Brevo não respondeu corretamente.",
      action: 'Resolva primeiro o item "Conta Brevo".',
    });
  else {
    const s = probe.senders;
    const parsed =
      s && !("error" in s) && s.status === 200 ? sendersSchema.safeParse(s.body) : null;
    if (!parsed?.success)
      checks.push({
        id: "sender",
        label: "Remetente",
        state: "error",
        detail: "Não foi possível ler a lista de remetentes da Brevo.",
        action: "Tente novamente. Se persistir, confirme as permissões da chave da API.",
      });
    else {
      const match = parsed.data.senders.filter((r) => r.email.trim().toLowerCase() === sender);
      senderActive = match.some((r) => r.active === true);
      if (!match.length)
        checks.push({
          id: "sender",
          label: "Remetente",
          state: "error",
          detail: `O remetente ${sender} não está cadastrado na Brevo.`,
          action:
            "Cadastre-o em Brevo › Remetentes, domínios e IPs › Remetentes e confirme o e-mail de validação enviado pela Brevo.",
        });
      else if (!senderActive)
        checks.push({
          id: "sender",
          label: "Remetente",
          state: "pending",
          detail: `O remetente ${sender} ainda não foi validado na Brevo.`,
          action:
            "Abra o e-mail de confirmação enviado pela Brevo para esse endereço (ou reenvie em Remetentes) e clique no link de validação.",
        });
      else
        checks.push({
          id: "sender",
          label: "Remetente",
          state: "ok",
          detail: `Remetente ${sender} validado.`,
          action: "",
        });
    }
  }

  let domainAuthenticated = false;
  if (!sender)
    checks.push({
      id: "domain",
      label: "Domínio",
      state: "pending",
      detail: "Domínio do remetente não informado.",
      action: "Configure o remetente primeiro.",
    });
  else if (freeMailDomain)
    checks.push({
      id: "domain",
      label: "Domínio",
      state: "error",
      detail: `O domínio ${domain} é de e-mail gratuito e não pode ser autenticado (DKIM/DMARC).`,
      action:
        "Use um remetente de domínio próprio (ex.: contato@suaempresa.com.br) e autentique o domínio na Brevo. Testes continuam permitidos.",
    });
  else if (!reachable)
    checks.push({
      id: "domain",
      label: "Domínio",
      state: "pending",
      detail: "Domínio não verificado porque a conta Brevo não respondeu corretamente.",
      action: 'Resolva primeiro o item "Conta Brevo".',
    });
  else {
    const d = probe.domains;
    const parsed =
      d && !("error" in d) && d.status === 200 ? domainsSchema.safeParse(d.body) : null;
    const row = parsed?.success
      ? parsed.data.domains.find((r) => r.domain_name.trim().toLowerCase() === domain)
      : undefined;
    domainAuthenticated = row?.authenticated === true;
    if (!parsed?.success)
      checks.push({
        id: "domain",
        label: "Domínio",
        state: "error",
        detail: "Não foi possível ler os domínios da Brevo.",
        action: "Tente novamente em instantes.",
      });
    else if (!row)
      checks.push({
        id: "domain",
        label: "Domínio",
        state: "pending",
        detail: `O domínio ${domain} não está cadastrado na Brevo.`,
        action:
          "Adicione o domínio em Brevo › Remetentes, domínios e IPs › Domínios e publique os registros DNS (código Brevo, DKIM e DMARC).",
      });
    else if (!domainAuthenticated)
      checks.push({
        id: "domain",
        label: "Domínio",
        state: "pending",
        detail: `O domínio ${domain} ainda não está autenticado (DKIM/DMARC).`,
        action:
          'Publique no DNS os registros indicados pela Brevo e clique em "Autenticar" no painel. A propagação pode levar até 48 horas.',
      });
    else
      checks.push({
        id: "domain",
        label: "Domínio",
        state: "ok",
        detail: `Domínio ${domain} autenticado.`,
        action: "",
      });
  }
  return {
    checkedAt,
    configured: true,
    reachable,
    senderActive,
    domainAuthenticated,
    freeMailDomain,
    checks,
  };
}

export const testRecipientInput = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    label: z.string().trim().min(2).max(80),
    confirmed: z.literal(true),
  })
  .strict();
