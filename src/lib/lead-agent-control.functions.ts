import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { phoneKey, sameWhatsAppNumber } from "./phone";
import { withinBusinessHours } from "./commercial-agent";
import { leadAgentState, effectiveMode, type AgentControlMode, type LeadAgentState, type LeadAgentTone } from "./lead-agent-control";

export type LeadAgentView = {
  contactKey: string; revision: number; mode: AgentControlMode; pausedUntil: string | null; holdReason: string | null;
  state: LeadAgentState; label: string; tone: LeadAgentTone; funnelName: string | null;
};

const phoneInput = z.object({ phone: z.string().min(8).max(40) }).strict();

export const getLeadAgentControl = createServerFn({ method: "POST" }).inputValidator((i) => phoneInput.parse(i)).handler(async ({ data }) => {
  const { crmAgentAdmin, withAdminAccess } = await import("./crm-agent-admin.server");
  return withAdminAccess(async () => {
    const a = await crmAgentAdmin();
    const key = phoneKey(data.phone);
    if (key.length < 8) throw new Error("Telefone inválido.");
    const [leads, pipes, settings, control, hold] = await Promise.all([
      a.db.from("leads").select("id,whatsapp,pipeline_id,stage"),
      a.db.from("sales_pipelines").select("id,name,archived"),
      a.db.from("crm_agent_settings").select("*"),
      a.db.from("crm_agent_contact_controls").select("mode,paused_until,revision").eq("contact_key", key).maybeSingle(),
      a.db.from("crm_agent_holds").select("reason").eq("contact_key", key).eq("active", true).maybeSingle(),
    ]);
    if ([leads, pipes, settings, control, hold].some((q: any) => q.error)) throw new Error("Não foi possível carregar a Gravon IA deste lead.");
    const archived = new Set(((pipes.data ?? []) as any[]).filter((p) => p.archived).map((p) => p.id as string));
    const names = new Map(((pipes.data ?? []) as any[]).map((p) => [p.id as string, p.name as string]));
    const cards = ((leads.data ?? []) as any[]).filter((l) => phoneKey(l.whatsapp ?? "") === key && !(l.pipeline_id && archived.has(l.pipeline_id)));
    const rows = (settings.data ?? []) as any[];
    const settingsOf = (pipelineId: string | null) => rows.find((s) => (s.pipeline_id ?? null) === (pipelineId ?? null)) ?? null;
    // Same card selection as claim_crm_agent: only cards whose funnel has an enabled agent compete.
    const withAgent = cards.filter((c) => settingsOf(c.pipeline_id)?.enabled);
    const card = withAgent[0] ?? cards[0] ?? null;
    const s = card ? settingsOf(card.pipeline_id) : null;
    const now = new Date();
    let humanRecent = false;
    if (s?.enabled && s.pause_on_human_reply && s.instance) {
      const since = new Date(now.getTime() - Number(s.human_pause_hours) * 3600_000).toISOString();
      const r = await a.db.rpc("crm_agent_human_since", { p_instance: s.instance, p_contact: key, p_since: since });
      humanRecent = r.data === true;
    }
    const c = control.data as { mode: AgentControlMode; paused_until: string | null; revision: number } | null;
    const ctl = c ? { mode: c.mode, pausedUntil: c.paused_until } : null;
    const status = leadAgentState({
      cards: withAgent.length > 1 ? withAgent.length : cards.length ? 1 : 0,
      funnel: s ? {
        enabled: Boolean(s.enabled), blocked: Boolean(s.blocked_reason),
        authorized: s.audience === "all" || ((s.recipients ?? []) as string[]).some((r) => sameWhatsAppNumber(r, data.phone) || phoneKey(r) === key),
        stageAllowed: ((s.allowed_stages ?? []) as string[]).includes(card.stage),
        openNow: withinBusinessHours(now, s.business_days ?? [], String(s.day_start).slice(0, 5), String(s.day_end).slice(0, 5)),
      } : null,
      control: ctl, hold: Boolean(hold.data), humanRecent, now,
    });
    const view: LeadAgentView = {
      contactKey: key, revision: Number(c?.revision ?? 0), mode: effectiveMode(ctl, now),
      pausedUntil: effectiveMode(ctl, now) === "paused" ? c!.paused_until : null,
      holdReason: (hold.data as any)?.reason ?? null, ...status,
      funnelName: card ? (card.pipeline_id ? names.get(card.pipeline_id) ?? "Funil" : "Funil principal") : null,
    };
    return { control: view };
  });
});

export const setLeadAgentControl = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({
    phone: z.string().min(8).max(40), mode: z.enum(["active", "paused", "disabled"]),
    hours: z.number().int().min(1).max(720).nullable(), revision: z.number().int().min(0),
  }).strict().refine((v) => v.mode !== "paused" || v.hours !== null, "Escolha por quanto tempo pausar.").parse(i))
  .handler(async ({ data }) => {
    const { crmAgentAdmin } = await import("./crm-agent-admin.server");
    const a = await crmAgentAdmin();
    const key = phoneKey(data.phone);
    if (key.length < 8) throw new Error("Telefone inválido.");
    const { error } = await a.db.rpc("set_crm_agent_contact_control", {
      p_contact: key, p_mode: data.mode, p_hours: data.mode === "paused" ? data.hours : null, p_revision: data.revision, p_actor: a.userId,
    });
    if (error) {
      console.error("lead_agent_control_failed", { code: String(error.code ?? "").slice(0, 12) });
      throw new Error(error.message?.includes("stale_revision") ? "O controle foi alterado em outra tela. Atualize e tente de novo." : "Não foi possível alterar a Gravon IA deste lead.");
    }
    return { ok: true };
  });
