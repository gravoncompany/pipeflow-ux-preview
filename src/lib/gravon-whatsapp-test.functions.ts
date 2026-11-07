import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { phoneKey, sameWhatsAppNumber } from "./phone";
import { EVOLUTION_BASE_URL } from "./evolution.functions";
import { openInstances } from "./whatsapp-message-sync";

export type TestLogEntry = {
  id: string;
  event: string;
  phone: string;
  body: string;
  status: string;
  detail: string;
  created_at: string;
  delivered_at?: string | null;
};

export type WhatsAppTestStatus = {
  needsAuth: boolean;
  enabled: boolean;
  authorizedPhone: string;
  crmReadEnabled: boolean;
  crmMoveEnabled: boolean;
  crmFinanceEnabled: boolean;
  openaiConfigured: boolean;
  logs: TestLogEntry[];
};

export type DiagnosticResult = {
  needsAuth: boolean;
  ok: boolean;
  error: string | null;
  instanceName: string;
  ownNumber: string;
  selfChatMessages: number;
  lastSelfChat: { fromMe: boolean; hasId: boolean; sentAt: string } | null;
  canReply: boolean;
};

async function requireFull() {
  const secret = process.env.CRM_SESSION_SECRET;
  const { hasFullCrmSession } = await import("./crm-session.server");
  return Boolean(secret && (await hasFullCrmSession(secret)));
}

async function fetchOpenInstance(apiKey: string) {
  const res = await fetch(`${EVOLUTION_BASE_URL}/instance/fetchInstances`, {
    headers: { apikey: apiKey },
  });
  const body = await res.text();
  if (!res.ok) return { error: `Evolution API respondeu ${res.status}.`, instance: null as any };
  const list = JSON.parse(body) as any[];
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: settings, error } = await supabaseAdmin
    .from("gravon_ai_test_settings")
    .select("authorized_phone")
    .eq("id", 1)
    .maybeSingle();
  if (error)
    return { error: "Não foi possível verificar o número autorizado.", instance: null as any };
  const candidates = openInstances(list).filter(
    (i) => !settings?.authorized_phone || sameWhatsAppNumber(i.number, settings.authorized_phone),
  );
  const open = candidates.length === 1 ? candidates[0] : null;
  if (!open) return { error: "Nenhuma instância do WhatsApp conectada.", instance: null as any };
  return { error: null, instance: open };
}

export const getWhatsAppTestStatus = createServerFn({ method: "POST" }).handler(
  async (): Promise<WhatsAppTestStatus> => {
    if (!(await requireFull()))
      return {
        needsAuth: true,
        enabled: false,
        authorizedPhone: "",
        crmReadEnabled: false,
        crmMoveEnabled: false,
        crmFinanceEnabled: false,
        openaiConfigured: false,
        logs: [],
      };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { recoverAcceptedMessages } = await import("./whatsapp-message-sync.server");
    await recoverAcceptedMessages();
    const [{ data: settings, error: settingsError }, { data: logs, error: logsError }] =
      await Promise.all([
        supabaseAdmin
          .from("gravon_ai_test_settings")
          .select("enabled,authorized_phone,crm_read_enabled,crm_move_enabled,crm_finance_enabled")
          .eq("id", 1)
          .maybeSingle(),
        supabaseAdmin
          .from("gravon_ai_test_log")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(30),
      ]);
    if (settingsError || logsError)
      throw new Error("Não foi possível carregar o histórico dos testes.");
    return {
      needsAuth: false,
      enabled: settings?.enabled === true,
      authorizedPhone: settings?.authorized_phone ?? "",
      crmReadEnabled: settings?.crm_read_enabled === true,
      crmMoveEnabled: settings?.crm_move_enabled === true,
      crmFinanceEnabled: settings?.crm_finance_enabled === true,
      openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
      logs: (logs ?? []) as TestLogEntry[],
    };
  },
);

export const runWhatsAppTestDiagnostic = createServerFn({ method: "POST" }).handler(
  async (): Promise<DiagnosticResult> => {
    const empty: DiagnosticResult = {
      needsAuth: false,
      ok: false,
      error: null,
      instanceName: "",
      ownNumber: "",
      selfChatMessages: 0,
      lastSelfChat: null,
      canReply: false,
    };
    if (!(await requireFull())) return { ...empty, needsAuth: true };
    const apiKey = process.env.EVOLUTION_API_KEY;
    if (!apiKey) return { ...empty, error: "Chave da Evolution API não configurada." };

    const { error, instance } = await fetchOpenInstance(apiKey);
    if (error || !instance) return { ...empty, error: error ?? "Instância não encontrada." };
    const ownNumber = String(instance.number ?? instance.ownerJid ?? "").split("@")[0];
    const instanceName = String(instance.name ?? instance.instance?.instanceName ?? "");
    if (!ownNumber)
      return { ...empty, error: "Não foi possível identificar o número conectado.", instanceName };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const key = phoneKey(ownNumber);
    const { data: rows, error: messagesError } = await supabaseAdmin
      .from("whatsapp_messages")
      .select("message_id,from_me,sent_at")
      .eq("phone_key", key)
      .eq("instance", instanceName)
      .eq("from_me", true)
      .order("sent_at", { ascending: false })
      .limit(20);
    if (messagesError)
      return {
        ...empty,
        error: "Não foi possível consultar as mensagens do teste.",
        instanceName,
        ownNumber,
      };
    const last = rows?.[0];
    return {
      needsAuth: false,
      ok: true,
      error: null,
      instanceName,
      ownNumber,
      selfChatMessages: rows?.length ?? 0,
      lastSelfChat: last
        ? { fromMe: last.from_me, hasId: Boolean(last.message_id), sentAt: last.sent_at }
        : null,
      canReply: Boolean(instanceName && ownNumber),
    };
  },
);

export const setWhatsAppTestEnabled = createServerFn({ method: "POST" })
  .inputValidator((i) =>
    z
      .object({ enabled: z.boolean(), authorizedPhone: z.string().trim().max(40).default("") })
      .parse(i),
  )
  .handler(async ({ data }) => {
    if (!(await requireFull()))
      return { ok: false, error: "Entre com a senha de acesso completo." };
    if (data.enabled && phoneKey(data.authorizedPhone).length < 8)
      return { ok: false, error: "Informe o número autorizado para o teste (com DDD)." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("gravon_ai_test_settings").upsert({
      id: 1,
      enabled: data.enabled,
      authorized_phone: data.authorizedPhone,
      crm_read_enabled: false,
      crm_read_instance: "",
      crm_read_phone: "",
      crm_read_revision: crypto.randomUUID(),
      crm_move_enabled: false,
      crm_move_instance: "",
      crm_move_phone: "",
      crm_move_revision: crypto.randomUUID(),
      crm_move_authorized_phone: "",
      crm_finance_enabled: false,
      crm_finance_instance: "",
      crm_finance_phone: "",
      crm_finance_revision: crypto.randomUUID(),
      crm_finance_read_revision: "",
      crm_finance_authorized_phone: "",
      crm_knowledge_enabled: false,
      crm_knowledge_read_revision: "",
      updated_at: new Date().toISOString(),
    });
    if (error) return { ok: false, error: "Não foi possível salvar a configuração." };
    await supabaseAdmin.from("gravon_ai_test_log").insert({
      event: "toggle",
      phone: data.authorizedPhone,
      body: "",
      status: "ok",
      detail: data.enabled
        ? "Teste pessoal ativado pelo administrador."
        : "Teste pessoal desativado.",
    });
    return { ok: true, error: null };
  });

export const setCrmReadEnabled = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ enabled: z.boolean() }).strict().parse(input))
  .handler(async ({ data }) => {
    if (!(await requireFull())) return { ok: false, error: "Entre com acesso completo." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: settings, error: settingsError } = await supabaseAdmin
      .from("gravon_ai_test_settings")
      .select("enabled,authorized_phone")
      .eq("id", 1)
      .maybeSingle();
    if (settingsError || !settings) return { ok: false, error: "Configuração indisponível." };
    let instance: { name: string; number: string } | null = null;
    if (data.enabled) {
      if (!settings.enabled || !settings.authorized_phone)
        return { ok: false, error: "Autorize primeiro o teste pessoal." };
      const key = process.env.EVOLUTION_API_KEY;
      if (!key) return { ok: false, error: "Conexão indisponível." };
      const result = await fetchOpenInstance(key);
      if (result.error || !result.instance)
        return { ok: false, error: result.error ?? "Conexão indisponível." };
      instance = result.instance;
    }
    const { data: changed, error } = await supabaseAdmin
      .from("gravon_ai_test_settings")
      .update({
        crm_read_enabled: data.enabled,
        crm_read_instance: instance?.name ?? "",
        crm_read_phone: instance?.number ?? "",
        crm_read_revision: crypto.randomUUID(),
        updated_at: new Date().toISOString(),
        crm_move_enabled: false,
        crm_move_instance: "",
        crm_move_phone: "",
        crm_move_revision: crypto.randomUUID(),
        crm_move_authorized_phone: "",
        crm_finance_enabled: false,
        crm_finance_instance: "",
        crm_finance_phone: "",
        crm_finance_revision: crypto.randomUUID(),
        crm_finance_read_revision: "",
        crm_finance_authorized_phone: "",
        crm_knowledge_enabled: false,
        crm_knowledge_read_revision: "",
      })
      .eq("id", 1)
      .eq("enabled", settings.enabled)
      .eq("authorized_phone", settings.authorized_phone)
      .select("id");
    if (error || changed?.length !== 1)
      return { ok: false, error: "Configuração alterada; tente novamente." };
    return { ok: true, error: null };
  });

export const setCrmMoveEnabled = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ enabled: z.boolean() }).strict().parse(input))
  .handler(async ({ data }) => {
    if (!(await requireFull())) return { ok: false, error: "Entre com acesso completo." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: settings, error: readError } = await supabaseAdmin
      .from("gravon_ai_test_settings")
      .select(
        "enabled,authorized_phone,crm_read_enabled,crm_read_revision,crm_read_instance,crm_read_phone,crm_move_revision",
      )
      .eq("id", 1)
      .maybeSingle();
    if (readError || !settings) return { ok: false, error: "Configuração indisponível." };
    let instance: { name: string; number: string } | null = null;
    if (data.enabled) {
      if (!settings.enabled || !settings.crm_read_enabled)
        return {
          ok: false,
          error: "Ative primeiro as respostas e a leitura de leads no seu WhatsApp.",
        };
      const key = process.env.EVOLUTION_API_KEY;
      if (!key) return { ok: false, error: "Conexão indisponível." };
      const result = await fetchOpenInstance(key);
      if (result.error || !result.instance)
        return { ok: false, error: result.error ?? "Conexão indisponível." };
      instance = result.instance;
      if (
        instance?.name !== settings.crm_read_instance ||
        instance?.number !== settings.crm_read_phone
      )
        return { ok: false, error: "Renove a autorização de leitura para a conexão atual." };
    }
    const { data: changed, error } = await supabaseAdmin
      .from("gravon_ai_test_settings")
      .update({
        crm_move_enabled: data.enabled,
        crm_move_instance: instance?.name ?? "",
        crm_move_phone: instance?.number ?? "",
        crm_move_revision: crypto.randomUUID(),
        crm_move_authorized_phone: data.enabled ? settings.authorized_phone : "",
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1)
      .eq("enabled", settings.enabled)
      .eq("authorized_phone", settings.authorized_phone)
      .eq("crm_read_revision", settings.crm_read_revision)
      .eq("crm_move_revision", settings.crm_move_revision)
      .select("id");
    if (error || changed?.length !== 1)
      return { ok: false, error: "Configuração alterada; tente novamente." };
    return { ok: true, error: null };
  });

export const setCrmFinanceEnabled = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ enabled: z.boolean() }).strict().parse(input))
  .handler(async ({ data }) => {
    if (!(await requireFull())) return { ok: false, error: "Entre com acesso completo." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: settings, error: readError } = await supabaseAdmin
      .from("gravon_ai_test_settings")
      .select(
        "enabled,authorized_phone,crm_read_enabled,crm_read_revision,crm_read_instance,crm_read_phone,crm_finance_revision",
      )
      .eq("id", 1)
      .maybeSingle();
    if (readError || !settings) return { ok: false, error: "Configuração indisponível." };
    let instance: { name: string; number: string } | null = null;
    if (data.enabled) {
      if (!settings.enabled || !settings.crm_read_enabled || !settings.crm_read_revision)
        return { ok: false, error: "Ative primeiro respostas e leitura no seu WhatsApp." };
      const key = process.env.EVOLUTION_API_KEY;
      if (!key) return { ok: false, error: "Conexão indisponível." };
      const result = await fetchOpenInstance(key);
      if (result.error || !result.instance)
        return { ok: false, error: result.error ?? "Conexão indisponível." };
      instance = result.instance;
      if (
        instance?.name !== settings.crm_read_instance ||
        instance?.number !== settings.crm_read_phone
      )
        return { ok: false, error: "Renove a autorização de leitura para a conexão atual." };
    }
    const { data: changed, error } = await supabaseAdmin
      .from("gravon_ai_test_settings")
      .update({
        crm_finance_enabled: data.enabled,
        crm_finance_instance: instance?.name ?? "",
        crm_finance_phone: instance?.number ?? "",
        crm_finance_revision: crypto.randomUUID(),
        crm_finance_read_revision: data.enabled ? settings.crm_read_revision : "",
        crm_finance_authorized_phone: data.enabled ? settings.authorized_phone : "",
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1)
      .eq("enabled", settings.enabled)
      .eq("authorized_phone", settings.authorized_phone)
      .eq("crm_read_enabled", settings.crm_read_enabled)
      .eq("crm_read_revision", settings.crm_read_revision)
      .eq("crm_finance_revision", settings.crm_finance_revision)
      .select("id");
    if (error || changed?.length !== 1)
      return { ok: false, error: "Configuração alterada; tente novamente." };
    return { ok: true, error: null };
  });
