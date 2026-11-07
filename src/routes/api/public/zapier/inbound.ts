import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { extractUtms, matchesWebhookToken, sourceFromUtms } from "@/lib/lead-attribution";
import { commercialFormOrigin, firstContactFormEvidence } from "@/lib/first-contact";

const InboundSchema = z.object({
  name: z.string().trim().min(1).max(160),
  company: z.string().trim().max(160).optional().default(""),
  email: z.string().trim().max(200).optional().default(""),
  whatsapp: z.string().trim().max(60).optional().default(""),
  instagram: z.string().trim().max(120).optional().default(""),
  website: z.string().trim().max(300).optional().default(""),
  invested_traffic: z.string().trim().max(40).optional().default(""),
  revenue: z.string().trim().max(120).optional().default(""),
  employees: z.string().trim().max(120).optional().default(""),
  source: z.string().trim().max(80).optional().default("Zapier"),
  service: z.string().trim().max(200).optional().default(""),
  potential_value: z.coerce.number().min(0).max(1_000_000_000).optional().default(0),
  owner: z.string().trim().max(120).optional().default(""),
  notes: z.string().trim().max(4000).optional().default(""),
  stage: z.string().trim().max(60).optional().default("lead-novo"),
  status: z.string().trim().max(120).optional().default("Novo"),
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Webhook-Token",
  "Content-Type": "application/json",
};

export const Route = createFileRoute("/api/public/zapier/inbound")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      POST: async ({ request }) => {
        const expectedToken = process.env['ZAPIER_INBOUND_TOKEN'];
        const { hasFullCrmSession } = await import("@/lib/crm-session.server");
        const sessionSecret = process.env['CRM_SESSION_SECRET'];
        const fullSession = sessionSecret ? await hasFullCrmSession(sessionSecret) : false;
        if (!fullSession && !matchesWebhookToken(expectedToken, request.headers.get("X-Webhook-Token"))) {
          return new Response(JSON.stringify({ error: expectedToken ? "unauthorized" : "webhook_not_configured" }), { status: expectedToken ? 401 : 503, headers: cors });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        let body: unknown;
        try { body = await request.json(); }
        catch { return new Response(JSON.stringify({ error: "invalid json" }), { status: 400, headers: cors }); }

        // Normalize: aceita variações de chaves (nome/Nome/full_name, etc.) e payloads aninhados
        const raw = (body && typeof body === "object" ? (body as Record<string, unknown>) : {}) as Record<string, unknown>;
        const inner = (raw.data && typeof raw.data === "object") ? (raw.data as Record<string, unknown>) : raw;
        const utms = extractUtms(raw);

        // Lookup case-insensitive em raw + inner
        const all: Record<string, string> = {};
        for (const src of [raw, inner]) {
          for (const [k, v] of Object.entries(src)) {
            if (v === undefined || v === null) continue;
            if (typeof v === "object") continue;
            const s = String(v).trim();
            if (!s) continue;
            all[k.toLowerCase().replace(/[\s_-]/g, "")] = s;
          }
        }
        const pick = (...keys: string[]) => {
          for (const k of keys) {
            const norm = k.toLowerCase().replace(/[\s_-]/g, "");
            if (all[norm]) return all[norm];
          }
          return undefined;
        };
        const first = pick("firstname", "first", "primeironome", "nome1");
        const last = pick("lastname", "last", "sobrenome", "ultimonome");
        const composed = [first, last].filter(Boolean).join(" ").trim();
        const normalized = {
          name: pick("name", "nome", "fullname", "nomecompleto", "nomedocliente", "cliente", "leadname") ?? (composed || undefined) ?? "Sem nome",
          company: pick("company", "empresa", "Empresa"),
          email: pick("email", "Email", "e-mail", "E-mail"),
          whatsapp: pick("whatsapp", "Whatsapp", "WhatsApp", "telefone", "Telefone", "phone"),
          instagram: pick("instagram", "Instagram", "@"),
          website: pick("website", "site", "Site", "url", "URL", "siteempresa", "websiteurl"),
          invested_traffic: pick("invested_traffic", "investiutrafego", "jainvestiuemtrafego", "trafegopago", "investimentotrafego", "trafego"),
          revenue: pick("revenue", "faturamento", "Faturamento"),
          employees: pick("employees", "funcionarios", "Funcionarios", "Funcionários"),
          source: pick("source", "origem", "Origem"),
          service: pick("segmento", "Segmento", "segment", "service", "servico", "Serviço", "Servico", "nicho", "Nicho", "areaatuacao", "areadeatuacao"),
          potential_value: pick("potential_value", "valor", "Valor"),
          owner: pick("owner", "responsavel", "Responsável"),
          notes: pick("notes", "observacoes", "Observações", "mensagem", "Mensagem"),
          stage: pick("stage", "estagio", "Estágio"),
          status: pick("status", "Status"),
        };

        const parsed = InboundSchema.safeParse(normalized);
        if (!parsed.success) {
          return new Response(JSON.stringify({ error: "validation", issues: parsed.error.issues }), { status: 400, headers: cors });
        }
        const d = parsed.data;
        const today = new Date().toISOString().slice(0, 10);

        // Optional destination pipeline + idempotency key. Legacy payloads without pipeline_id keep the original behavior.
        const commercialOrigin = commercialFormOrigin(inner.form_origin ?? inner.landing_url ?? raw.form_origin ?? raw.landing_url);
        const pipelineRaw = commercialOrigin ? undefined : pick("pipeline_id", "pipelineid");
        if (commercialOrigin) d.stage = "lead-novo";
        const eventId = pick("event_id", "eventid");
        const evidence = firstContactFormEvidence(d.name, d.whatsapp, { ...raw, ...inner }, eventId);
        if (pipelineRaw !== undefined || eventId !== undefined || commercialOrigin) {
          const { routeToPipeline } = await import("@/lib/zapier-inbound.server");
          const answers: Record<string, string> = {};
          const known = new Set(["pipelineid", "eventid", "utmsource", "utmmedium", "utmcampaign", "utmcontent", "utmterm"]);
          for (const [k, v] of Object.entries(inner)) if (v != null && typeof v !== "object" && String(v).trim() && !known.has(k.toLowerCase().replace(/[\s_-]/g, ""))) answers[k] = String(v).trim().slice(0, 1000);
          const result = await routeToPipeline(supabaseAdmin, { pipelineRaw, eventId, lead: d, utms, answers, source: sourceFromUtms(utms, d.source), today, commercialForm: Boolean(commercialOrigin), evidence });
          return new Response(JSON.stringify(result.body), { status: result.status, headers: cors });
        }
        const { data, error } = await supabaseAdmin
          .from("leads")
          .insert({
            ...evidence,
            name: d.name,
            company: d.company,
            email: d.email,
            whatsapp: d.whatsapp,
            instagram: d.instagram,
            website: d.website,
            invested_traffic: d.invested_traffic,
            revenue: d.revenue,
            employees: d.employees,
            source: sourceFromUtms(utms, d.source),
            ...utms,
            service: d.service,
            potential_value: d.potential_value,
            owner: d.owner,
            notes: d.notes,
            stage: d.stage,
            status: d.status,
            entry_date: today,
            history: [{ id: Math.random().toString(36).slice(2, 10), date: today, text: "Lead criado via Zapier." }],
          })
          .select("id")
          .single();

        if (error) {
          return new Response(JSON.stringify({ error: "Unable to save lead" }), { status: 500, headers: cors });
        }
        return new Response(JSON.stringify({ ok: true, id: data?.id }), { status: 200, headers: cors });
      },
    },
  },
});
