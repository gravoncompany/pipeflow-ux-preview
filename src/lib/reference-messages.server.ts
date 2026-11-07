/** Webhook hook: identifies campaign reference messages and creates/locates the lead in the configured funnel. */
export async function captureReferenceMessages(instance: string, rows: { message_id: string; from_me: boolean; media_type?: string }[]) {
  const inbound = rows.filter((r) => !r.from_me && !r.media_type);
  if (!inbound.length || !instance) return [];
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as unknown as { rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: any; error: unknown }> };
  const results: string[] = [];
  for (const row of inbound) {
    // Each message is isolated: one failure never blocks the others or the webhook response.
    const { data, error } = await db.rpc("capture_crm_reference_message", { p_instance: instance, p_message: row.message_id });
    if (error) {
      const { isMissingSchema } = await import("./crm-agent-access");
      if (isMissingSchema(error as { code?: string; message?: string })) return results; // Not installed yet: nothing to capture.
      console.error("reference_capture_failed"); results.push("error"); continue;
    }
    results.push(String(data?.status ?? "ignored"));
  }
  return results;
}
