import { createFileRoute } from "@tanstack/react-router";
import { apiKeyFromHeaders, hashApiKey, normalizeDiagnosis } from "@/lib/api-keys";
import { prepareDiagnosisMessage } from "@/lib/diagnosis-automation";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Recebe o formulário de diagnóstico (inicialmente pelo Zapier).
 * Autenticação: "Authorization: Bearer <chave>" ou "X-API-Key: <chave>" criada em Configurações → API e Integrações.
 */
export const Route = createFileRoute("/api/public/v1/forms/diagnosis")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = apiKeyFromHeaders(request.headers);
        if (!key) return json({ error: "unauthorized", message: "Envie a chave no cabeçalho Authorization: Bearer <chave>." }, 401);
        const text = await request.text();
        if (text.length > 32_000) return json({ error: "payload_too_large" }, 413);
        const type = request.headers.get("content-type") ?? "";
        let raw: unknown;
        try {
          raw = type.includes("application/x-www-form-urlencoded") ? Object.fromEntries(new URLSearchParams(text)) : JSON.parse(text);
        } catch { return json({ error: "invalid_body", message: "Envie JSON ou formulário (x-www-form-urlencoded)." }, 400); }
        const parsed = normalizeDiagnosis(raw);
        if (!parsed.success) return json({ error: "validation", fields: parsed.error.issues.map((i) => i.path.join(".") || "body") }, 400);
        const p = parsed.data;
        const prepared = prepareDiagnosisMessage(p);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.rpc("receive_crm_diagnosis_v2", {
          p_key_hash: await hashApiKey(key), p_event_id: p.event_id, p_name: p.name, p_company: p.company, p_email: p.email,
          p_whatsapp: p.whatsapp, p_objective: p.objective, p_utm_content: p.utm_content,
          p_consent: p.whatsapp_consent ?? null, p_phone: prepared?.phone ?? "", p_body: prepared?.body ?? "",
        });
        if (error || !data || typeof data !== "object") {
          console.error("diagnosis intake failed", error?.code ?? "no_data");
          return json({ error: "unavailable" }, 500);
        }
        const r = data as Record<string, unknown>;
        if (r.error === "unauthorized") return json({ error: "unauthorized", message: "Chave inválida ou revogada." }, 401);
        if (r.error) return json({ error: String(r.error) }, 400);
        // Receipt/CRM updates have already committed. Failures here never undo intake or repeat it.
        try {
          const { b2bDb } = await import("@/lib/b2b-prospecting.server");
          const db = await b2bDb();
          const { notifyDiagnosis, processDiagnosisWhatsApp } = await import("@/lib/diagnosis-automation.server");
          if (r.outcome === "matched" && r.duplicate !== true) {
            const sub = await db.from("crm_diagnosis_submissions").select("id,name,company,lead_id").eq("event_id", p.event_id).single();
            if (sub.error) throw new Error("diagnosis_notification_read_failed");
            if (sub.data?.lead_id) await notifyDiagnosis(db, sub.data);
          }
          await processDiagnosisWhatsApp(db);
        } catch { console.error("diagnosis_followup_pending"); }
        return json({ ok: true, duplicate: r.duplicate === true, outcome: r.outcome, lead_id: r.lead_id ?? null, paused_sequences: r.paused ?? 0 });
      },
    },
  },
});
