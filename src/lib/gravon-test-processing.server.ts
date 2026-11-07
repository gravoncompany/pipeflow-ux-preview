import { sameWhatsAppNumber } from "./phone";
import { isAiGeneratedBody } from "./gravon-whatsapp-test";
import {
  normalizeAcceptedMessage,
  selectTestInstance,
  type AcceptedMessage,
} from "./whatsapp-message-sync";
import type { CrmReadGrant } from "./gravon-crm-read";
import { parseMoveCommand, type MoveGrant } from "./gravon-crm-actions";
import type { FinanceGrant } from "./gravon-financial-read";

export type TestIncoming = {
  message_id: string;
  instance: string;
  remote_jid: string;
  phone: string;
  from_me: boolean;
  body: string;
};
export type TestSettings = {
  enabled: boolean;
  authorized_phone: string;
  crm_read_enabled?: boolean;
  crm_read_instance?: string;
  crm_read_phone?: string;
  crm_read_revision?: string;
  crm_move_enabled?: boolean;
  crm_move_instance?: string;
  crm_move_phone?: string;
  crm_move_revision?: string;
  crm_move_authorized_phone?: string;
  crm_finance_enabled?: boolean;
  crm_finance_instance?: string;
  crm_finance_phone?: string;
  crm_finance_revision?: string;
  crm_finance_read_revision?: string;
  crm_finance_authorized_phone?: string;
  crm_knowledge_enabled?: boolean;
  crm_knowledge_read_revision?: string;
};
export type TestReadContext = {
  portalInbound?: { inboundId: string; instance: string; remoteJid: string };
  grant: CrmReadGrant | null;
  authorize: () => Promise<void>;
  moveGrant?: MoveGrant | null;
  authorizeMove?: () => Promise<void>;
  financeGrant?: FinanceGrant | null;
  authorizeFinance?: () => Promise<void>;
  knowledge?: { read: () => Promise<unknown> } | null;
};
export type TestRecord = {
  event: string;
  status: string;
  detail: string;
  body: string;
  instance: string;
  phone: string;
  remote_jid: string;
  inbound_id?: string;
  outbound_id?: string;
  accepted_at?: string;
};
export type TestDependencies = {
  settings: () => Promise<TestSettings | null>;
  instances: () => Promise<unknown>;
  claim: (row: TestIncoming) => Promise<boolean>;
  record: (entry: TestRecord) => Promise<void>;
  generate: (body: string, context: TestReadContext) => Promise<string>;
  resolveMove?: (
    grant: MoveGrant,
    command: { code: string; cancel: boolean },
    authorize: () => Promise<void>,
  ) => Promise<string>;
  send: (instance: string, number: string, body: string) => Promise<Response>;
  save: (message: AcceptedMessage) => Promise<void>;
  knowledge?: () => Promise<unknown>;
  isOwnEcho?: (row: TestIncoming) => Promise<boolean>;
  reserve?: (row: TestIncoming, body: string) => Promise<boolean>;
  outcome?: (row: TestIncoming, state: "accepted" | "failed" | "unknown", providerId?: string) => Promise<void>;
};

export async function processTestRows(rows: TestIncoming[], deps: TestDependencies): Promise<void> {
  for (const row of rows) {
    if (
      !row.from_me ||
      !row.body ||
      isAiGeneratedBody(row.body) ||
      !/^\d{10,15}@s\.whatsapp\.net$/.test(row.remote_jid)
    )
      continue;
    if (deps.isOwnEcho && await deps.isOwnEcho(row)) continue;
    const settings = await deps.settings();
    if (!settings?.enabled) continue;
    const instance = selectTestInstance(
      await deps.instances(),
      row.instance,
      settings.authorized_phone,
    );
    if (!instance || !sameWhatsAppNumber(row.remote_jid, instance.number)) continue;
    if (!(await deps.claim(row))) continue; // durable unique claim; failure stops before sending
    const record = (status: string, detail: string, body = "", accepted?: AcceptedMessage) =>
      deps.record({
        event: "reply",
        status,
        detail,
        body,
        instance: row.instance,
        phone: row.phone,
        remote_jid: accepted?.remoteJid ?? row.remote_jid,
        inbound_id: row.message_id,
        ...(accepted ? { outbound_id: accepted.messageId, accepted_at: accepted.acceptedAt } : {}),
      });
    const grant: CrmReadGrant | null =
      settings.crm_read_enabled === true &&
      settings.crm_read_instance === instance.name &&
      settings.crm_read_phone === instance.number &&
      settings.crm_read_revision
        ? { instance: instance.name, phone: instance.number, revision: settings.crm_read_revision }
        : null;
    const authorizeRead = async () => {
      const now = await deps.settings();
      if (
        !grant ||
        !now?.enabled ||
        now.crm_read_enabled !== true ||
        now.crm_read_revision !== grant.revision ||
        now.crm_read_instance !== grant.instance ||
        now.crm_read_phone !== grant.phone ||
        !sameWhatsAppNumber(now.authorized_phone, grant.phone)
      )
        throw new Error("Autorização de consulta indisponível.");
      const connected = selectTestInstance(
        await deps.instances(),
        grant.instance,
        now.authorized_phone,
      );
      if (
        !connected ||
        connected.number !== grant.phone ||
        !sameWhatsAppNumber(row.remote_jid, connected.number)
      )
        throw new Error("Conversa pessoal indisponível.");
    };
    const moveGrant: MoveGrant | null =
      grant &&
      settings.crm_move_enabled === true &&
      settings.crm_move_instance === instance.name &&
      settings.crm_move_phone === instance.number &&
      settings.crm_move_revision &&
      settings.crm_move_authorized_phone === settings.authorized_phone
        ? {
            instance: instance.name,
            phone: instance.number,
            readRevision: grant.revision,
            revision: settings.crm_move_revision,
            inboundId: row.message_id,
          }
        : null;
    const authorizeMove = async () => {
      await authorizeRead();
      const now = await deps.settings();
      if (
        !moveGrant ||
        !now?.crm_move_enabled ||
        now.crm_move_revision !== moveGrant.revision ||
        now.crm_move_instance !== moveGrant.instance ||
        now.crm_move_phone !== moveGrant.phone ||
        now.crm_move_authorized_phone !== now.authorized_phone
      )
        throw new Error("Permissão de movimentação indisponível.");
    };
    const financeGrant: FinanceGrant | null =
      grant &&
      settings.crm_finance_enabled === true &&
      settings.crm_finance_instance === grant.instance &&
      settings.crm_finance_phone === grant.phone &&
      settings.crm_finance_revision &&
      settings.crm_finance_read_revision === grant.revision &&
      settings.crm_finance_authorized_phone === settings.authorized_phone
        ? {
            instance: grant.instance,
            phone: grant.phone,
            revision: settings.crm_finance_revision,
            readRevision: grant.revision,
            authorizedPhone: settings.authorized_phone,
          }
        : null;
    const authorizeFinance = async () => {
      await authorizeRead();
      const now = await deps.settings();
      if (
        !financeGrant ||
        !now?.crm_finance_enabled ||
        now.crm_finance_revision !== financeGrant.revision ||
        now.crm_finance_read_revision !== financeGrant.readRevision ||
        now.crm_finance_instance !== financeGrant.instance ||
        now.crm_finance_phone !== financeGrant.phone ||
        now.authorized_phone !== financeGrant.authorizedPhone ||
        now.crm_finance_authorized_phone !== now.authorized_phone
      )
        throw new Error("Autorização financeira indisponível.");
    };
    const knowledgeEnabled = Boolean(
      grant &&
      settings.crm_knowledge_enabled === true &&
      settings.crm_knowledge_read_revision === grant.revision &&
      deps.knowledge,
    );
    const authorizeKnowledge = async () => {
      await authorizeRead();
      const now = await deps.settings();
      if (
        !knowledgeEnabled ||
        !now?.crm_knowledge_enabled ||
        now.crm_knowledge_read_revision !== grant?.revision
      )
        throw new Error("Permissão de conhecimento indisponível.");
    };
    let body: string;
    try {
      const command = parseMoveCommand(row.body);
      const reply = command
        ? moveGrant && deps.resolveMove
          ? await deps.resolveMove(moveGrant, command, authorizeMove)
          : "Permissão de movimentação desligada. Nenhuma mudança aplicada."
        : await deps.generate(row.body, {
            portalInbound: {
              inboundId: row.message_id,
              instance: row.instance,
              remoteJid: row.remote_jid,
            },
            grant,
            authorize: authorizeRead,
            moveGrant,
            authorizeMove,
            financeGrant,
            authorizeFinance,
            knowledge:
              knowledgeEnabled && deps.knowledge
                ? {
                    read: async () => {
                      await authorizeKnowledge();
                      const read = deps.knowledge;
                      if (!read) throw new Error("Conhecimento indisponível.");
                      return read();
                    },
                  }
                : null,
          });
      body = reply.replace(/^\s*🤖\s*/, "");
    } catch {
      await record("error", "Falha ao gerar a resposta; nenhum envio realizado.");
      continue;
    }
    const current = await deps.settings();
    if (
      !current?.enabled ||
      !sameWhatsAppNumber(current.authorized_phone, instance.number) ||
      !selectTestInstance(await deps.instances(), row.instance, current.authorized_phone)
    ) {
      await record("skipped", "Autorização ou instância indisponível antes do envio.");
      continue;
    }
    if (grant) {
      try {
        await authorizeRead();
      } catch {
        await record("skipped", "Consultas revogadas ou instância alterada; resposta descartada.");
        continue;
      }
    }
    if (moveGrant) {
      try {
        await authorizeMove();
      } catch {
        await record(
          "skipped",
          "Permissão de movimentação revogada; resposta descartada. Consulte o histórico do CRM para mudanças já confirmadas.",
        );
        continue;
      }
    }
    if (financeGrant) {
      try {
        await authorizeFinance();
      } catch {
        await record("skipped", "Autorização financeira revogada; resposta descartada.");
        continue;
      }
    }
    if (knowledgeEnabled) {
      try {
        await authorizeKnowledge();
      } catch {
        await record("skipped", "Permissão de conhecimento revogada; resposta descartada.");
        continue;
      }
    }
    // If this durable record fails we must not initiate the provider request.
    await record("sending", "Solicitação registrada; ainda sem aceitação da Evolution.", body);
    if (deps.reserve && !await deps.reserve(row, body)) continue;
    let response: Response;
    try {
      response = await deps.send(instance.name, instance.number, body);
    } catch {
      await deps.outcome?.(row, "unknown");
      await record(
        "unknown",
        "Evolution não respondeu; resultado indeterminado. Não reenviar automaticamente.",
        body,
      );
      continue;
    }
    if (!response.ok) {
      await deps.outcome?.(row, "failed");
      await record("error", `Evolution rejeitou a solicitação (${response.status}).`, body);
      continue;
    }
    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      await deps.outcome?.(row, "unknown");
      await record(
        "unknown",
        "Resposta de sucesso sem comprovante legível; entrega e identidade não confirmadas.",
        body,
      );
      continue;
    }
    const message = normalizeAcceptedMessage(raw, {
      instance: instance.name,
      number: instance.number,
      body,
      acceptedAt: new Date().toISOString(),
    });
    if (!message) {
      await deps.outcome?.(row, "unknown");
      await record(
        "unknown",
        "Resposta sem identificador/destino válido; nenhuma mensagem enviada foi criada no CRM.",
        body,
      );
      continue;
    }
    // Save acceptance evidence even if canonical persistence later fails.
    await deps.outcome?.(row, "accepted", message.messageId);
    try {
      await record("accepted", "Aceita pela Evolution; entrega não confirmada.", body, message);
    } catch {
      console.error("Gravon acceptance log unavailable; preserving canonical write if possible.");
    }
    try {
      await deps.save(message);
    } catch {
      await record(
        "sync_error",
        "Aceita pela Evolution, mas a gravação em Conversas falhou. Recuperação somente da gravação, sem reenvio.",
        body,
        message,
      );
    }
  }
}
