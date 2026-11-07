// Isolated PGlite database for the reference-message and Commercial Agent migrations (tests only).
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { AgentVerdict } from "./commercial-agent";

export const CRM = "00000000-0000-4000-8000-0000000000c1";
export const OTHER = "00000000-0000-4000-8000-0000000000c2";
export const ARCHIVED = "00000000-0000-4000-8000-0000000000c3";

/** Minimal stand-ins for the existing CRM tables; the migration under test is applied unchanged. */
export async function referenceDb() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT coalesce(nullif(current_setting('test.role',true),''),'service_role') $$;
    CREATE TABLE public.sales_pipelines(id uuid PRIMARY KEY, name text, stages jsonb, archived boolean NOT NULL DEFAULT false, created_at timestamptz DEFAULT now());
    CREATE TABLE public.leads(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text DEFAULT '', company text DEFAULT '', whatsapp text DEFAULT '', stage text DEFAULT 'lead-novo',
      pipeline_id uuid, source text DEFAULT '', utm_source text DEFAULT '', utm_medium text DEFAULT '', tags jsonb DEFAULT '[]', entry_date date, notes text DEFAULT '',
      last_conversation text DEFAULT '', history jsonb DEFAULT '[]', gravon_change_revision bigint NOT NULL DEFAULT 0, created_at timestamptz DEFAULT now());
    CREATE FUNCTION public.bump_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.gravon_change_revision:=OLD.gravon_change_revision+1; RETURN NEW; END $$;
    CREATE TRIGGER bump_revision BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.bump_revision();
    CREATE TABLE public.whatsapp_messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), message_id text NOT NULL UNIQUE, instance text NOT NULL DEFAULT '', phone text NOT NULL DEFAULT '',
      phone_key text NOT NULL DEFAULT '', remote_jid text, from_me boolean NOT NULL DEFAULT false, push_name text NOT NULL DEFAULT '', body text NOT NULL DEFAULT '',
      media_type text NOT NULL DEFAULT '', sent_at timestamptz NOT NULL DEFAULT now(), send_state text, accepted_at timestamptz, message_source text);
    CREATE TABLE public.ai_knowledge(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_key text, entry_type text, title text, text text, updated_at timestamptz DEFAULT now());
    INSERT INTO public.sales_pipelines(id,name,stages) VALUES
      ('${CRM}','CRM','[{"id":"crm-novo","title":"Novo"},{"id":"crm-atendimento","title":"Em atendimento"},{"id":"crm-qualificado","title":"Qualificado"},{"id":"crm-fechado","title":"Fechado"}]'),
      ('${OTHER}','Outbound','[{"id":"out-novo","title":"Novo"}]');
    INSERT INTO public.sales_pipelines(id,name,stages,archived) VALUES('${ARCHIVED}','Antigo','[{"id":"x","title":"X"}]',true);`);
  await db.exec(await readFile("drizzle/migrations/0083_crm_reference_messages.sql", "utf8"));
  return db;
}
export const PIPELINES = { CRM, OTHER, ARCHIVED };

let seq = 0;
export async function inbound(db: PGlite, phone: string, body: string, over: Record<string, unknown> = {}) {
  const id = String(over.id ?? `MSG${++seq}`);
  const row = { instance: "gravon", from_me: false, media_type: "", push_name: "Cliente Teste", sent_at: new Date().toISOString(), ...over };
  await db.query(`INSERT INTO whatsapp_messages(message_id,instance,phone,phone_key,remote_jid,from_me,push_name,body,media_type,sent_at) VALUES($1,$2,$3,public.crm_phone_key($3),$3||'@s.whatsapp.net',$4,$5,$6,$7,$8)`,
    [id, row.instance, phone, row.from_me, row.push_name, body, row.media_type, row.sent_at]);
  return id;
}
export const SENDER = "5551900000000";
export const TESTER = "5551999991111";

export async function agentDb() {
  const db = await referenceDb();
  await db.exec(await readFile("drizzle/migrations/0084_crm_commercial_agent.sql", "utf8"));
  await db.exec(await readFile("drizzle/migrations/0088_crm_agent_contact_controls.sql", "utf8"));
  await db.exec(await readFile("drizzle/migrations/0103_crm_agent_move_stages.sql", "utf8"));
  await db.exec(`INSERT INTO ai_knowledge(company_key,entry_type,title,text) VALUES('crm:1','manual','Plano CRM','Plano mensal R$ 297. Implantação em 7 dias.')`);
  return db;
}
export const CONFIG = {
  enabled: true, audience: "test", instance: "gravon", senderPhone: SENDER, recipients: [TESTER],
  allowedStages: ["crm-novo", "crm-atendimento"], instructions: "Seja cordial.", stageMap: { novo: "crm-novo", atendimento: "crm-atendimento", qualificado: "crm-qualificado" },
  businessDays: [0, 1, 2, 3, 4, 5, 6], dayStart: "00:00", dayEnd: "23:59:59",
};
export async function configure(db: PGlite, pipeline: string | null = CRM, over: Record<string, unknown> = {}) {
  const current = (await db.query<any>("SELECT revision FROM crm_agent_settings WHERE pipeline_id IS NOT DISTINCT FROM $1", [pipeline])).rows[0];
  return (await db.query<any>("SELECT save_crm_agent_settings(NULL,$1,$2,$3) AS s", [pipeline, current?.revision ?? 0, JSON.stringify({ ...CONFIG, ...over })])).rows[0].s;
}
export async function lead(db: PGlite, phone = TESTER, pipeline: string | null = CRM, stage = "crm-novo") {
  return (await db.query<any>("INSERT INTO leads(name,whatsapp,stage,pipeline_id) VALUES('Tester',$1,$2,$3) RETURNING id", [phone, stage, pipeline])).rows[0].id as string;
}

export const verdict = (over: Partial<AgentVerdict> = {}): AgentVerdict => ({
  humanRequired: false, humanReason: "", knowledgeTitles: [], response: "Olá! Como posso ajudar?", situation: "", interest: "", nextAction: "",
  atendimentoIniciado: false, evidenciaAtendimento: "", intencaoComercial: false, evidenciaIntencao: "", agendamento: false, evidenciaAgendamento: "",
  fechamento: false, evidenciaFechamento: "", confiancaFechamento: 0, perda: false, evidenciaPerda: "", confiancaPerda: 0, orcamentoEnviado: false,
  evidenciaOrcamento: "", motivo: "", localizacao: "", evidenciaLocalizacao: "", servicoSolicitado: "", servicoCompativel: null, atendeRequisitos: null, ...over,
});
