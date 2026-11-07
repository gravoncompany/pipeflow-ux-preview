import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { suggestionSchema } from "./client-tasks";
import {
  chargeInput, clientInput, convertInput, knowledgeInput, paymentInput, planSaveInput, recordInput, taskInput,
} from "./crm-clients";
import { CLIENTS_ACTOR, requireClientsSession } from "./crm-clients.server";

const idParam = (i: unknown) => z.object({ id: z.string().uuid() }).strict().parse(i);

function rpcError(e: { message?: string } | null, fallback: string): never {
  const m = e?.message ?? "";
  if (m.includes("duplicate_cnpj")) throw new Error("Já existe um cliente com este CNPJ.");
  if (m.includes("already_client")) throw new Error("Este contato já foi convertido em cliente.");
  if (m.includes("lead_unavailable")) throw new Error("Contato indisponível.");
  if (m.includes("client_unavailable")) throw new Error("Cliente indisponível.");
  if (m.includes("client_changed") || m.includes("plan_changed") || m.includes("task_changed") || m.includes("charge_changed"))
    throw new Error("Alguém alterou este cadastro; atualize a tela antes de salvar.");
  if (m.includes("charge_paid")) throw new Error("Cobrança já paga; pagamentos confirmados não podem ser alterados.");
  if (m.includes("charge_cancelled")) throw new Error("Cobrança cancelada.");
  if (m.includes("payment_not_confirmed")) throw new Error("Confirme o recebimento antes de registrar o pagamento.");
  if (m.includes("invalid_cnpj")) throw new Error("CNPJ inválido: use 14 dígitos numéricos.");
  throw new Error(fallback);
}

/** Todos os contatos: leads do CRM + empresas da Prospecção B2B + clientes. */
export const listContacts = createServerFn({ method: "GET" }).handler(async () => {
  const db = await requireClientsSession();
  const [leads, b2b, clients, pipelines] = await Promise.all([
    db.from("leads").select("id,name,company,whatsapp,email,source,utm_source,stage,pipeline_id,created_at").order("created_at", { ascending: false }).limit(500),
    db.from("b2b_companies").select("id,cnpj,place_id,profile,lead_id,created_at").order("created_at", { ascending: false }).limit(500),
    db.from("crm_clients").select("id,lead_id,trade_name,cnpj,status").limit(500),
    db.from("sales_pipelines").select("id,name,stages").eq("archived", false).limit(50),
  ]);
  for (const r of [leads, b2b, clients, pipelines]) if (r.error) throw new Error("Não foi possível carregar os contatos.");
  const clientByLead = new Map((clients.data ?? []).filter((c: any) => c.lead_id).map((c: any) => [c.lead_id, c]));
  const stageTitles = new Map<string, string>();
  for (const p of pipelines.data ?? []) for (const s of (p as any).stages ?? []) stageTitles.set(`${(p as any).id}:${s.id}`, s.title);
  const mainStages = new Map<string, string>();
  for (const p of pipelines.data ?? []) for (const s of (p as any).stages ?? []) if (!mainStages.has(s.id)) mainStages.set(s.id, s.title);
  const leadRows = (leads.data ?? []).map((l: any) => ({
    kind: "lead" as const,
    id: l.id,
    name: l.name,
    company: l.company,
    contact: l.whatsapp || l.email,
    email: l.email,
    cnpj: "",
    origin: l.utm_source || l.source || "manual",
    stage: l.pipeline_id ? stageTitles.get(`${l.pipeline_id}:${l.stage}`) ?? l.stage : mainStages.get(l.stage) ?? l.stage,
    client: clientByLead.get(l.id) ?? null,
  }));
  const b2bRows = (b2b.data ?? []).map((b: any) => {
    const p = b.profile ?? {};
    return {
      kind: "b2b" as const,
      id: b.id,
      name: p.tradeName || p.legalName || "Empresa sem nome",
      company: p.legalName || "",
      contact: (p.phones ?? [])[0] ?? "",
      email: (p.emails ?? [])[0] ?? "",
      cnpj: b.cnpj ?? "",
      origin: p.source === "deskdata" ? "DeskData" : "Google Maps",
      stage: b.lead_id ? "Enviada ao funil" : "Prospect",
      client: b.lead_id ? clientByLead.get(b.lead_id) ?? null : null,
    };
  });
  const clientRows = (clients.data ?? []).map((c: any) => ({
    kind: "cliente" as const, id: c.id, name: c.trade_name, company: "", contact: "", email: "", cnpj: c.cnpj,
    origin: "Cliente", stage: c.status, client: c,
  }));
  return { contacts: [...clientRows, ...leadRows, ...b2bRows] };
});

export const listClients = createServerFn({ method: "GET" }).handler(async () => {
  const db = await requireClientsSession();
  const { data, error } = await db.from("crm_clients").select("*").order("created_at", { ascending: false }).limit(500);
  if (error) throw new Error("Não foi possível carregar os clientes.");
  const counts = { ativo: 0, pausado: 0, encerrado: 0, implantacao: 0 };
  for (const c of data ?? []) counts[(c as any).status as keyof typeof counts] += 1;
  return { clients: data ?? [], counts };
});

/** Ficha completa do cliente: todas as abas compartilham este carregamento. */
export const getClient = createServerFn({ method: "GET" })
  .inputValidator(idParam)
  .handler(async ({ data }) => {
    const db = await requireClientsSession();
    await db.rpc("refresh_crm_charge_status");
    const { data: client, error } = await db.from("crm_clients").select("*").eq("id", data.id).maybeSingle();
    if (error) throw new Error("Não foi possível carregar o cliente.");
    if (!client) throw new Error("Cliente não encontrado.");
    const [knowledge, plans, versions, documents, records, tasks, charges, payments, projects] = await Promise.all([
      db.from("crm_client_knowledge").select("*").eq("client_id", data.id).order("created_at", { ascending: false }).limit(200),
      db.from("crm_client_plans").select("*").eq("client_id", data.id).order("updated_at", { ascending: false }).limit(20),
      db.from("crm_client_plan_versions").select("*").order("created_at", { ascending: false }).limit(100),
      db.from("crm_client_documents").select("*").eq("client_id", data.id).order("created_at", { ascending: false }).limit(200),
      db.from("crm_client_records").select("*").eq("client_id", data.id).order("created_at", { ascending: false }).limit(200),
      db.from("crm_client_tasks").select("*").eq("client_id", data.id).is("deleted_at", null).order("created_at", { ascending: false }).limit(200),
      db.from("crm_client_charges").select("*").eq("client_id", data.id).order("due_date", { ascending: true }).limit(300),
      db.from("crm_client_payments").select("*").order("created_at", { ascending: false }).limit(300),
      db.from("crm_client_projects").select("*").eq("client_id", data.id).order("created_at", { ascending: false }).limit(100),
    ]);
    for (const r of [knowledge, plans, versions, documents, records, tasks, charges, payments, projects]) if (r.error) throw new Error("Não foi possível carregar a ficha do cliente.");
    // Conversas e reuniões do lead vinculado (reuso das integrações existentes, sem duplicar dados).
    let conversations: any[] = [];
    let appointments: any[] = [];
    let linkedInstagram = "";
    let conversationKey = "";
    let conversationInstance = "";
    if (client.lead_id) {
      const { data: lead } = await db.from("leads").select("id,whatsapp,instagram").eq("id", client.lead_id).maybeSingle();
      linkedInstagram = String(lead?.instagram ?? "").trim();
      // Mesmo identificador de contato usado pela central de Conversas (phone_key), para abrir a conversa existente.
      const { phoneKey } = await import("./phone");
      const key = phoneKey(lead?.whatsapp ?? "");
      if (key.length >= 8) {
        const { data: msgs } = await db.from("whatsapp_messages").select("id,from_me,body,sent_at,push_name,instance").eq("phone_key", key).order("sent_at", { ascending: false }).limit(100);
        conversations = msgs ?? [];
        if (conversations.length) { conversationKey = key; conversationInstance = String(conversations[0].instance ?? ""); }
      }
      const { data: appts } = await db.from("crm_appointments").select("id,summary,starts_at,ends_at,status,origin,responsible").eq("lead_id", client.lead_id).order("starts_at", { ascending: false }).limit(50);
      appointments = appts ?? [];
    }
    const chargeIds = new Set((charges.data ?? []).map((c: any) => c.id));
    const finance = { previsto: 0, pendente: 0, vencido: 0, recebido: 0 };
    for (const c of charges.data ?? []) {
      const v = Number((c as any).amount) || 0;
      if ((c as any).status !== "cancelado") finance.previsto += v;
      if ((c as any).status === "pendente") finance.pendente += v;
      if ((c as any).status === "vencido") finance.vencido += v;
    }
    for (const p of payments.data ?? []) if (chargeIds.has((p as any).charge_id)) finance.recebido += Number((p as any).amount) || 0;
    return {
      client,
      knowledge: knowledge.data ?? [],
      projects: projects.data ?? [],
      plans: plans.data ?? [],
      versions: (versions.data ?? []).filter((v: any) => (plans.data ?? []).some((p: any) => p.id === v.plan_id)),
      documents: documents.data ?? [],
      records: records.data ?? [],
      tasks: tasks.data ?? [],
      charges: charges.data ?? [],
      payments: (payments.data ?? []).filter((p: any) => chargeIds.has(p.charge_id)),
      conversations,
      appointments,
      finance,
      linkedInstagram,
      conversationKey,
      conversationInstance,
    };
  });

export const saveClient = createServerFn({ method: "POST" })
  .inputValidator(i => clientInput.parse(i))
  .handler(async ({ data }) => {
    const db = await requireClientsSession();
    const { data: id, error } = await db.rpc("save_crm_client", {
      p_actor: CLIENTS_ACTOR, p_id: data.id, p_lead: data.leadId, p_trade_name: data.tradeName, p_legal_name: data.legalName,
      p_cnpj: data.cnpj, p_contact_name: data.contactName, p_phone: data.phone, p_whatsapp: data.whatsapp, p_email: data.email,
      p_address: data.address, p_website: data.website, p_relationship_start: data.relationshipStart, p_services: data.services,
      p_status: data.status, p_internal_responsible: data.internalResponsible, p_reminder_days: data.reminderDays,
      p_notes: data.notes, p_revision: data.revision,
    } as any);
    if (error) rpcError(error, "Não foi possível salvar o cliente.");
    return { id };
  });

export const convertLeadToClient = createServerFn({ method: "POST" })
  .inputValidator(i => convertInput.parse(i))
  .handler(async ({ data }) => {
    const db = await requireClientsSession();
    const { data: id, error } = await db.rpc("convert_lead_to_client", {
      p_actor: CLIENTS_ACTOR, p_lead: data.leadId, p_status: data.status,
      p_internal_responsible: data.internalResponsible, p_services: data.services, p_notes: data.notes,
    });
    if (error) rpcError(error, "Não foi possível converter o contato.");
    return { id };
  });

export const addClientKnowledge = createServerFn({ method: "POST" })
  .inputValidator(i => knowledgeInput.parse(i))
  .handler(async ({ data }) => {
    const db = await requireClientsSession();
    const { error } = await db.rpc("add_crm_client_knowledge", {
      p_actor: CLIENTS_ACTOR, p_client: data.clientId, p_kind: data.kind, p_title: data.title, p_text: data.text, p_source: data.source,
    });
    if (error) rpcError(error, "Não foi possível registrar o conhecimento.");
    return { ok: true };
  });

async function clientContext(db: any, clientId: string) {
  const { data: client, error } = await db.from("crm_clients").select("*").eq("id", clientId).maybeSingle();
  if (error || !client) throw new Error("Cliente indisponível.");
  const [knowledge, records, tasks, plans] = await Promise.all([
    db.from("crm_client_knowledge").select("kind,title,text").eq("client_id", clientId).order("created_at", { ascending: false }).limit(40),
    db.from("crm_client_records").select("kind,description,created_at").eq("client_id", clientId).order("created_at", { ascending: false }).limit(30),
    db.from("crm_client_tasks").select("title,status,due_date").eq("client_id", clientId).is("deleted_at", null).order("created_at", { ascending: false }).limit(30),
    db.from("crm_client_plans").select("id,approved_version").eq("client_id", clientId).eq("status", "aprovado").limit(1),
  ]);
  let approvedPlan: string | null = null;
  const approved = plans.data?.[0];
  if (approved?.approved_version) {
    const { data: v } = await db.from("crm_client_plan_versions").select("content").eq("plan_id", approved.id).eq("version", approved.approved_version).maybeSingle();
    approvedPlan = v?.content ?? null;
  }
  return { client, knowledge: knowledge.data ?? [], records: records.data ?? [], tasks: tasks.data ?? [], approvedPlan };
}

/** Resumo Inteligente do Cliente: gerado sob demanda e gravado como conhecimento "resumo" (fontes preservadas). */
export const generateClientSummary = createServerFn({ method: "POST" })
  .inputValidator(idParam)
  .handler(async ({ data }) => {
    const db = await requireClientsSession();
    const ctx = await clientContext(db, data.id);
    const { generateClientSummary: run } = await import("./ai/gravon-client-plan.server");
    const text = await run(ctx);
    const { error } = await db.rpc("add_crm_client_knowledge", {
      p_actor: "Gravon IA", p_client: data.id, p_kind: "resumo", p_title: "Resumo Inteligente do Cliente", p_text: text, p_source: "Geração sob demanda",
    });
    if (error) rpcError(error, "Resumo gerado, mas não foi possível registrá-lo.");
    return { text };
  });

export const saveClientPlan = createServerFn({ method: "POST" })
  .inputValidator(i => planSaveInput.parse(i))
  .handler(async ({ data }) => {
    const db = await requireClientsSession();
    const { data: id, error } = await db.rpc("save_crm_client_plan", {
      p_actor: CLIENTS_ACTOR, p_client: data.clientId, p_plan: data.planId, p_title: data.title,
      p_content: data.content, p_origin: data.origin, p_expected_version: data.expectedVersion,
    } as any);
    if (error) rpcError(error, "Não foi possível salvar o planejamento.");
    return { id };
  });

/** Gera rascunho de planejamento com IA; nunca substitui versão aprovada (vai para revisão humana). */
export const generateClientPlan = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({ clientId: z.string().uuid(), briefing: z.string().max(10000) }).strict().parse(i))
  .handler(async ({ data }) => {
    const db = await requireClientsSession();
    const ctx = await clientContext(db, data.clientId);
    const { generateClientPlan: run } = await import("./ai/gravon-client-plan.server");
    const content = await run(ctx, data.briefing);
    return { content };
  });

export const approveClientPlan = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({ planId: z.string().uuid(), version: z.number().int().min(1), revision: z.number().int().min(0), confirmed: z.literal(true) }).strict().parse(i))
  .handler(async ({ data }) => {
    const db = await requireClientsSession();
    const { error } = await db.rpc("approve_crm_client_plan", {
      p_actor: CLIENTS_ACTOR, p_plan: data.planId, p_version: data.version, p_revision: data.revision,
    });
    if (error) rpcError(error, "Não foi possível aprovar o planejamento.");
    return { ok: true };
  });

export const addClientRecord = createServerFn({ method: "POST" })
  .inputValidator(i => recordInput.parse(i))
  .handler(async ({ data }) => {
    const db = await requireClientsSession();
    const { error } = await db.rpc("add_crm_client_record", {
      p_actor: CLIENTS_ACTOR, p_client: data.clientId, p_kind: data.kind, p_description: data.description,
    });
    if (error) rpcError(error, "Não foi possível adicionar o registro.");
    return { ok: true };
  });

export const saveClientTask = createServerFn({ method: "POST" })
  .inputValidator(i => taskInput.parse(i))
  .handler(async ({ data }) => {
    const db = await requireClientsSession();
    const { data: id, error } = await db.rpc("save_crm_client_task", {
      p_actor: CLIENTS_ACTOR, p_id: data.id, p_client: data.clientId, p_title: data.title, p_description: data.description,
      p_responsible: data.responsible, p_priority: data.priority, p_due: data.dueDate, p_status: data.status,
      p_origin: "manual", p_revision: data.revision,
    } as any);
    if (error) rpcError(error, "Não foi possível salvar a tarefa.");
    return { id };
  });

export const saveClientCharge = createServerFn({ method: "POST" })
  .inputValidator(i => chargeInput.parse(i))
  .handler(async ({ data }) => {
    const db = await requireClientsSession();
    const { data: id, error } = await db.rpc("save_crm_client_charge", {
      p_actor: CLIENTS_ACTOR, p_id: data.id, p_client: data.clientId, p_description: data.description, p_amount: data.amount,
      p_due: data.dueDate, p_recurrence: data.recurrence, p_interval: data.recurrenceInterval, p_method: data.paymentMethod, p_revision: data.revision,
    } as any);
    if (error) rpcError(error, "Não foi possível salvar a cobrança.");
    return { id };
  });

export const registerClientPayment = createServerFn({ method: "POST" })
  .inputValidator(i => paymentInput.parse(i))
  .handler(async ({ data }) => {
    const db = await requireClientsSession();
    const { error } = await db.rpc("register_crm_client_payment", {
      p_actor: CLIENTS_ACTOR, p_charge: data.chargeId, p_amount: data.amount, p_method: data.method, p_note: data.note, p_confirmed: data.confirmed,
    });
    if (error) rpcError(error, "Não foi possível registrar o pagamento.");
    return { ok: true };
  });

export const cancelClientCharge = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({ chargeId: z.string().uuid(), revision: z.number().int().min(0), confirmed: z.literal(true) }).strict().parse(i))
  .handler(async ({ data }) => {
    const db = await requireClientsSession();
    const { error } = await db.rpc("cancel_crm_client_charge", {
      p_actor: CLIENTS_ACTOR, p_charge: data.chargeId, p_revision: data.revision,
    });
    if (error) rpcError(error, "Não foi possível cancelar a cobrança.");
    return { ok: true };
  });

/** Lembretes de pagamento: criam APENAS tarefas internas para o gestor. Nenhum e-mail é enviado (Brevo pendente). */
export const runPaymentReminders = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({ confirmed: z.literal(true) }).strict().parse(i))
  .handler(async () => {
    const db = await requireClientsSession();
    const { data: created, error } = await db.rpc("create_due_charge_reminders", { p_actor: CLIENTS_ACTOR });
    if (error) rpcError(error, "Não foi possível gerar os lembretes.");
    return { created: Number(created) || 0 };
  });

const MAX_DOC_BYTES = 15 * 1024 * 1024;

/** Upload de documento para o storage privado + metadados na biblioteca do cliente. */
export const uploadClientDocument = createServerFn({ method: "POST" })
  .inputValidator(i => {
    if (!(i instanceof FormData)) throw new Error("Envio inválido.");
    return i;
  })
  .handler(async ({ data: form }) => {
    const db = await requireClientsSession();
    const clientId = String(form.get("clientId") ?? "");
    const category = String(form.get("category") ?? "");
    const aiAuthorized = form.get("aiAuthorized") === "true";
    const projectId = String(form.get("projectId") ?? "");
    if (projectId && !/^[0-9a-f-]{36}$/.test(projectId)) throw new Error("Projeto inválido.");
    const file = form.get("file");
    if (!/^[0-9a-f-]{36}$/.test(clientId)) throw new Error("Cliente inválido.");
    if (!["contrato", "proposta", "briefing", "relatorio", "apresentacao", "outro"].includes(category)) throw new Error("Categoria inválida.");
    if (!(file instanceof File) || file.size === 0) throw new Error("Selecione um arquivo.");
    if (file.size > MAX_DOC_BYTES) throw new Error("Arquivo acima de 15 MB.");
    if (projectId) {
      const pr = await db.from("crm_client_projects").select("id").eq("id", projectId).eq("client_id", clientId).maybeSingle();
      if (pr.error || !pr.data) throw new Error("Projeto não pertence a este cliente.");
    }
    const safeName = file.name.replace(/[^\w.()-]+/g, "_").slice(-120);
    const path = `${clientId}/${crypto.randomUUID()}-${safeName}`;
    const { error: up } = await db.storage.from("crm-client-documents").upload(path, file, { contentType: file.type || "application/octet-stream" });
    if (up) throw new Error("Não foi possível enviar o arquivo.");
    const { error } = await db.from("crm_client_documents").insert({
      client_id: clientId, category, name: file.name.slice(0, 300), path,
      size_bytes: file.size, content_type: file.type || "", ai_authorized: aiAuthorized, created_by: CLIENTS_ACTOR,
      ...(projectId ? { project_id: projectId } : {}),
    });
    if (error) {
      await db.storage.from("crm-client-documents").remove([path]);
      throw new Error("Não foi possível registrar o documento.");
    }
    return { ok: true };
  });

/** Link temporário (5 min) para visualizar um documento do storage privado. */
export const getClientDocumentUrl = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({ documentId: z.string().uuid() }).strict().parse(i))
  .handler(async ({ data }) => {
    const db = await requireClientsSession();
    const { data: doc, error } = await db.from("crm_client_documents").select("path,name").eq("id", data.documentId).maybeSingle();
    if (error || !doc) throw new Error("Documento indisponível.");
    const { data: signed, error: se } = await db.storage.from("crm-client-documents").createSignedUrl(doc.path, 300);
    if (se || !signed?.signedUrl) throw new Error("Não foi possível abrir o documento.");
    return { url: signed.signedUrl, name: doc.name };
  });

/** Leads do Pipeline já vinculados a uma ficha de cliente (evita cadastro duplicado). */
export const listLeadClientLinks = createServerFn({ method: "GET" }).handler(async () => {
  const db = await requireClientsSession();
  const { data, error } = await db.from("crm_clients").select("id,lead_id,trade_name").not("lead_id", "is", null).limit(2000);
  if (error) throw new Error("Não foi possível carregar os clientes vinculados.");
  return { links: (data ?? []).map((c: any) => ({ leadId: c.lead_id as string, clientId: c.id as string, name: c.trade_name as string })) };
});

/**
 * Adicionar lead fechado como cliente: o cadastro revisado é salvo vinculado ao lead de origem, que continua em
 * Fechado. Se o lead já tem ficha, devolve a ficha existente em vez de duplicar.
 */
export const addLeadAsClient = createServerFn({ method: "POST" })
  .inputValidator(i => clientInput.parse(i))
  .handler(async ({ data }) => {
    const db = await requireClientsSession();
    if (!data.leadId || data.id) throw new Error("Cadastro inválido.");
    const { data: lead, error: le } = await db.from("leads").select("id,stage").eq("id", data.leadId).maybeSingle();
    if (le || !lead) throw new Error("Contato indisponível.");
    if (lead.stage !== "fechado") throw new Error("Só leads na etapa Fechado podem ser adicionados como cliente por aqui.");
    const existing = async () => (await db.from("crm_clients").select("id").eq("lead_id", data.leadId!).maybeSingle()).data?.id as string | undefined;
    const found = await existing();
    if (found) return { status: "linked" as const, id: found };
    const { data: id, error } = await db.rpc("save_crm_client", {
      p_actor: CLIENTS_ACTOR, p_id: null, p_lead: data.leadId, p_trade_name: data.tradeName, p_legal_name: data.legalName,
      p_cnpj: data.cnpj, p_contact_name: data.contactName, p_phone: data.phone, p_whatsapp: data.whatsapp, p_email: data.email,
      p_address: data.address, p_website: data.website, p_relationship_start: data.relationshipStart, p_services: data.services,
      p_status: data.status, p_internal_responsible: data.internalResponsible, p_reminder_days: data.reminderDays,
      p_notes: data.notes, p_revision: 0,
    } as any);
    if (error) {
      if (error.message?.includes("already_client")) { const again = await existing(); if (again) return { status: "linked" as const, id: again }; }
      if (error.message?.includes("duplicate_cnpj") && data.cnpj) {
        const same = await db.from("crm_clients").select("id").eq("cnpj", data.cnpj).maybeSingle();
        if (same.data?.id) return { status: "linked" as const, id: same.data.id as string };
      }
      rpcError(error, "Não foi possível salvar o cliente.");
    }
    return { status: "created" as const, id: id as string };
  });

/** Situação de cada cliente em relação aos cards do CRM (vínculo salvo + possíveis correspondências, nunca automáticas). */
export const getClientCardLinks = createServerFn({ method: "GET" }).handler(async () => {
  const db = await requireClientsSession();
  const { clientCardLinks } = await import("./client-card-links");
  const [clients, leads] = await Promise.all([
    db.from("crm_clients").select("id,lead_id,trade_name,contact_name,phone,whatsapp,email").limit(2000),
    db.from("leads").select("id,name,company,whatsapp,email,stage,pipeline_id").order("created_at", { ascending: false }).limit(5000),
  ]);
  if (clients.error || leads.error) throw new Error("Não foi possível verificar os cards do CRM.");
  return { links: clientCardLinks((clients.data ?? []) as any, (leads.data ?? []) as any) };
});

/** Cria um único card no Funil Principal, etapa Fechado, a partir do cliente; se já houver card vinculado, devolve-o. */
export const createClientCard = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({ clientId: z.string().uuid() }).strict().parse(i))
  .handler(async ({ data }) => {
    const db = await requireClientsSession();
    const before = await db.from("crm_clients").select("lead_id").eq("id", data.clientId).maybeSingle();
    if (before.error || !before.data) throw new Error("Cliente indisponível.");
    if (before.data.lead_id) return { status: "existing" as const, leadId: before.data.lead_id as string };
    const { data: leadId, error } = await db.rpc("create_crm_client_card" as any, { p_actor: CLIENTS_ACTOR, p_client: data.clientId } as any);
    if (error || !leadId) rpcError(error, "Não foi possível criar o card.");
    return { status: "created" as const, leadId: leadId as string };
  });

/** Vínculo manual com um card existente escolhido pelo usuário. */
export const linkClientCard = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({ clientId: z.string().uuid(), leadId: z.string().uuid() }).strict().parse(i))
  .handler(async ({ data }) => {
    const db = await requireClientsSession();
    const { error } = await db.rpc("link_crm_client_card" as any, { p_actor: CLIENTS_ACTOR, p_client: data.clientId, p_lead: data.leadId } as any);
    if (error) {
      if (error.message?.includes("client_already_linked")) throw new Error("Este cliente já tem um card vinculado.");
      if (error.message?.includes("already_client")) throw new Error("Este card já está vinculado a outro cliente.");
      rpcError(error, "Não foi possível vincular o card.");
    }
    return { ok: true, leadId: data.leadId };
  });

/** Gravon IA: sugere tarefas a partir das conversas de um cliente. Somente leitura, sem envios. */
export const analyzeClientConversationsForTasks = createServerFn({ method: "POST" })
  .inputValidator(i => idParam(i))
  .handler(async ({ data }) => {
    const { analyzeClientTasks } = await import("./client-tasks-ai.server");
    return analyzeClientTasks(data.id);
  });

export const registerSuggestedTasks = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({ clientId: z.string().uuid(), tasks: z.array(suggestionSchema).min(1).max(50) }).strict().parse(i))
  .handler(async ({ data }) => {
    const { registerAiTasks } = await import("./client-tasks-ai.server");
    return registerAiTasks(data.clientId, data.tasks);
  });

/** Central de tarefas: todas as tarefas de todos os clientes (mesma tabela da ficha). */
export const listAllClientTasks = createServerFn({ method: "GET" }).handler(async () => {
  const db = await requireClientsSession();
  const [tasks, clients] = await Promise.all([
    db.from("crm_client_tasks").select("*").is("deleted_at", null).order("created_at", { ascending: false }).limit(2000),
    db.from("crm_clients").select("id,trade_name").limit(2001),
  ]);
  if (tasks.error || clients.error) throw new Error("Não foi possível carregar as tarefas.");
  const names = new Map((clients.data ?? []).map(c => [c.id, c.trade_name]));
  return { tasks: (tasks.data ?? []).map(t => ({ ...t, client_name: names.get(t.client_id) ?? "Cliente" })) };
});

export const getMessageTaskContext = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({ messageId: z.string().min(1).max(200) }).strict().parse(i))
  .handler(async ({ data }) => { const { messageTaskContext } = await import("./message-task.server"); return messageTaskContext(data.messageId); });
export const createTaskFromWhatsAppMessage = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({ messageId: z.string().min(1).max(200), title: z.string().trim().min(2).max(300), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), responsible: z.string().trim().max(160) }).strict().parse(i))
  .handler(async ({ data }) => { const { createTaskFromMessage } = await import("./message-task.server"); return createTaskFromMessage(data); });

export const getConversationClient = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({ phone: z.string().min(8).max(40) }).strict().parse(i))
  .handler(async ({ data }) => { const { clientForConversation } = await import("./message-task.server"); return clientForConversation(data.phone); });

const taskContext = z.string().regex(/^(central|client:[0-9a-f-]{36})$/);
/** Ações em lote: concluir, excluir (registro de auditoria; some das listas) ou alterar prioridade. */
export const bulkClientTasks = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({ ids: z.array(z.string().uuid()).min(1).max(500), action: z.enum(["complete", "delete", "priority"]), priority: z.enum(["baixa", "media", "alta", "urgente"]).optional() }).strict().parse(i))
  .handler(async ({ data }) => {
    const db = await requireClientsSession();
    const { data: n, error } = await db.rpc("bulk_crm_client_tasks", { p_actor: CLIENTS_ACTOR, p_ids: data.ids, p_action: data.action, p_priority: data.priority ?? null } as any);
    if (error) rpcError(error, "Não foi possível atualizar as tarefas.");
    return { changed: Number(n ?? 0) };
  });
/** Ordem personalizada por lista (central ou ficha do cliente); não altera status. */
export const getTaskOrder = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({ context: taskContext }).strict().parse(i))
  .handler(async ({ data }) => {
    const db = await requireClientsSession();
    const r = await db.from("crm_task_orders").select("task_id,position").eq("context", data.context).limit(3000);
    if (r.error) throw new Error("Não foi possível ler a ordem das tarefas.");
    return Object.fromEntries((r.data ?? []).map(x => [x.task_id, x.position])) as Record<string, number>;
  });
export const saveTaskOrder = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({ context: taskContext, ids: z.array(z.string().uuid()).max(3000) }).strict().parse(i))
  .handler(async ({ data }) => {
    const db = await requireClientsSession();
    const { error } = await db.rpc("reorder_crm_tasks", { p_context: data.context, p_ids: data.ids } as any);
    if (error) throw new Error("Não foi possível salvar a ordem.");
    return { ok: true };
  });
/** Histórico de tarefas do cliente: criações, conclusões, alterações e exclusões (auditoria). */
export const getClientTaskHistory = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({ clientId: z.string().uuid() }).strict().parse(i))
  .handler(async ({ data }) => {
    const db = await requireClientsSession();
    const r = await db.from("crm_client_task_events").select("id,task_id,action,actor,title,origin,responsible,changes,created_at").eq("client_id", data.clientId).order("created_at", { ascending: false }).limit(300);
    if (r.error) throw new Error("Não foi possível ler o histórico.");
    return r.data ?? [];
  });
