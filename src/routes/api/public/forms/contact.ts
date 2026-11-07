import { createFileRoute } from "@tanstack/react-router";
import { contactFormSchema, contactFormPayload } from "@/lib/contact-form";

export const Route = createFileRoute("/api/public/forms/contact")({ server: { handlers: {
  POST: async ({ request }) => {
    const origin = new URL(request.url).origin;
    // Browser form only. External commercial forms retain the private Zapier endpoint.
    if (request.headers.get("origin") !== origin || !request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: "Forbidden" }, { status: 403 });
    const text = await request.text();
    if (text.length > 16000) return Response.json({ error: "Invalid input" }, { status: 413 });
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { return Response.json({ error: "Invalid input" }, { status: 400 }); }
    const parsed = contactFormSchema.safeParse(raw);
    if (!parsed.success || new URL(parsed.data.landingUrl).origin !== origin || new URL(parsed.data.landingUrl).pathname !== "/captura") return Response.json({ error: "Invalid input" }, { status: 400 });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const payload = contactFormPayload(parsed.data, origin, new Date());
    const { data, error } = await supabaseAdmin.from("leads").insert(payload).select("*").single();
    if (error?.code === "23505") return Response.json({ ok: true });
    if (error || !data) return Response.json({ error: "Unable to save" }, { status: 500 });
    // Preserve the existing optional outbound integration without exposing its destination.
    const { data: settings } = await supabaseAdmin.from("crm_settings").select("zapier_webhook_url").eq("id", 1).maybeSingle();
    if (settings?.zapier_webhook_url) {
      const { fetchWithoutRedirects } = await import("@/lib/no-redirect-fetch.server");
      const { rowToLead } = await import("@/lib/lead-mapper");
      try { await fetchWithoutRedirects(settings.zapier_webhook_url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "lead.created", timestamp: new Date().toISOString(), lead: rowToLead(data), whatsapp_consent: { granted: parsed.data.whatsappConsent, at: payload.first_contact_consent_at, version: payload.first_contact_consent_version }, event_id: payload.first_contact_submission_id, form_origin: origin }), signal: AbortSignal.timeout(10000) }); }
      catch { console.error("capture_outbound_notification_failed"); }
    }
    return Response.json({ ok: true });
  },
} } });