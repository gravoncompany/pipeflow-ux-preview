import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { phoneKey } from "./phone";
import { analysisSchema, type Analysis, type AnalysisMessage } from "./whatsapp-analysis";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const scope = z.object({ start: date.optional(), end: date.optional() }).refine(d => Boolean(d.start) === Boolean(d.end) && (!d.start || !d.end || d.start <= d.end), "Período inválido");
async function access() {
  const secret = process.env.CRM_SESSION_SECRET;
  const { hasFullCrmSession } = await import("./crm-session.server");
  return Boolean(secret && await hasFullCrmSession(secret));
}
export type AnalysisRow = { phoneKey: string; phone: string; name: string; result: Analysis | null; analyzedAt: string | null };

export const listAnalysisConversations = createServerFn({ method: "POST" })
  .inputValidator(i => scope.parse(i)).handler(async ({ data }) => {
    if (!await access()) return { needsAuth: true, rows: [] as AnalysisRow[] };
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const [{ data: saved, error: savedError }, { data: leads, error: leadError }] = await Promise.all([
      db.from("whatsapp_analyses").select("*").eq("scope_start", data.start ?? "").eq("scope_end", data.end ?? ""),
      db.from("leads").select("name,whatsapp"),
    ]);
    if (savedError || leadError) throw new Error("Não foi possível carregar as análises.");
    const names = new Map((leads ?? []).map(l => [phoneKey(l.whatsapp), l.name]));
    const rows = new Map<string, AnalysisRow>();
    for (let offset = 0; ; offset += 1000) {
      let query = db.from("whatsapp_messages").select("phone_key,phone,push_name,sent_at").order("sent_at", { ascending: false }).order("message_id");
      if (data.start && data.end) query = query.gte("sent_at", `${data.start}T00:00:00-03:00`).lte("sent_at", `${data.end}T23:59:59.999999-03:00`);
      const { data: msgs, error } = await query.range(offset, offset + 999);
      if (error) throw new Error("Não foi possível carregar as conversas.");
      for (const m of msgs ?? []) {
        if (rows.has(m.phone_key)) continue;
        const a = saved?.find(s => s.phone_key === m.phone_key);
        const parsed = analysisSchema.safeParse(a?.result);
        rows.set(m.phone_key, { phoneKey: m.phone_key, phone: m.phone, name: names.get(m.phone_key) || m.push_name || m.phone, result: parsed.success ? parsed.data : null, analyzedAt: a?.analyzed_at ?? null });
      }
      if ((msgs?.length ?? 0) < 1000) break;
    }
    return { needsAuth: false, rows: [...rows.values()] };
  });

export const analyzeConversation = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({ phone: z.string().min(8).max(40), start: date.optional(), end: date.optional(), refresh: z.boolean().optional() }).refine(d => Boolean(d.start) === Boolean(d.end) && (!d.start || !d.end || d.start <= d.end)).parse(i))
  .handler(async ({ data }): Promise<{ result: Analysis | null; error: string | null; analyzedAt?: string; cached?: boolean }> => {
    if (!await access()) return { result: null, error: "Entre com a senha de acesso completo." };
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) return { result: null, error: "Análise por IA não configurada." };
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: control, error: controlError } = await db.from("whatsapp_ai_control").select("*").eq("id", 1).maybeSingle();
    if (controlError) return { result: null, error: "Não foi possível verificar a disponibilidade da análise." };
    if (control?.blocked_status) return { result: null, error: control.blocked_message || "Análise pausada. Verifique o acesso à IA." };
    const key = phoneKey(data.phone);
    let query = db.from("whatsapp_messages").select("message_id,body,from_me,sent_at,media_type").eq("phone_key", key).order("sent_at", { ascending: false }).order("message_id").limit(301);
    if (data.start && data.end) query = query.gte("sent_at", `${data.start}T00:00:00-03:00`).lte("sent_at", `${data.end}T23:59:59.999999-03:00`);
    const { data: fetched, error } = await query;
    if (error) return { result: null, error: "Não foi possível ler a conversa." };
    if (!fetched?.length) return { result: null, error: "Nenhuma mensagem no período selecionado." };
    let size = 0;
    const messages: AnalysisMessage[] = [];
    for (const m of fetched.slice(0, 300)) { size += m.body.length; if (size > 80000) break; messages.push(m); }
    messages.reverse();
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(messages)));
    const fingerprint = Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
    const start = data.start ?? "", end = data.end ?? "";
    const { data: previous } = await db.from("whatsapp_analyses").select("*").eq("phone_key", key).eq("scope_start", start).eq("scope_end", end).maybeSingle();
    const parsed = analysisSchema.safeParse(previous?.result);
    if (!data.refresh && previous?.fingerprint === fingerprint && parsed.success) return { result: parsed.data, error: null, analyzedAt: previous.analyzed_at, cached: true };
    try {
      const { runConversationAnalysis } = await import("./ai/whatsapp-analysis.server");
      const result = await runConversationAnalysis(apiKey, messages);
      if (messages.length < fetched.length) result.limitations += " Apenas as mensagens mais recentes foram analisadas (até 300 mensagens e 80 mil caracteres).";
      if (messages.some(m => m.media_type)) result.limitations += " Áudios, imagens e outras mídias não foram transcritos ou interpretados; apenas textos e legendas foram analisados.";
      const analyzedAt = new Date().toISOString();
      const { error: saveError } = await db.from("whatsapp_analyses").upsert({ phone_key: key, scope_start: start, scope_end: end, fingerprint, result, analyzed_at: analyzedAt }, { onConflict: "phone_key,scope_start,scope_end" });
      if (saveError) return { result, error: "Análise concluída, mas não foi possível salvar.", analyzedAt };
      return { result, error: null, analyzedAt };
    } catch (e) {
      const failure = e as { statusCode?: number; responseBody?: string; message?: string };
      const status = failure.statusCode;
      let message = "Não foi possível concluir a análise. Tente novamente mais tarde.";
      try { const body = JSON.parse(failure.responseBody ?? "{}"); message = body.error?.message ?? body.message ?? message; } catch { /* no provider payload exposed */ }
      if (status === 402 || status === 403 || status === 404) await db.from("whatsapp_ai_control").upsert({ id: 1, blocked_status: status, blocked_message: message, blocked_kind: status === 402 ? "credits" : "access", updated_at: new Date().toISOString() });
      return { result: null, error: message };
    }
  });

export const resumeWhatsAppAnalysis = createServerFn({ method: "POST" }).handler(async () => {
  if (!await access()) return { error: "Sem acesso." };
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const { data: control } = await db.from("whatsapp_ai_control").select("blocked_kind").eq("id", 1).maybeSingle();
  if (control?.blocked_kind === "access") return { error: "O acesso à IA precisa ser restabelecido antes de retomar." };
  const { error } = await db.from("whatsapp_ai_control").upsert({ id: 1, blocked_status: null, blocked_message: null, blocked_kind: null });
  return { error: error ? "Não foi possível retomar." : null };
});