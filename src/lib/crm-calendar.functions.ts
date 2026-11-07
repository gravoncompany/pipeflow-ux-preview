import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { availableSlots, isSlotStillAvailable } from "./crm-calendar";
import { CALENDAR_ACTOR, liveCalendarBusy, readCalendarSettings, requireCalendarSession, toCalendarSettings } from "./crm-calendar.server";

const time = z.string().regex(/^\d{2}:\d{2}$/);

export const getCrmCalendar = createServerFn({ method: "GET" }).handler(async () => {
  const db = await requireCalendarSession();
  const settings = await readCalendarSettings(db);
  const { data: appointments, error } = await db.from("crm_appointments").select("id,lead_id,event_id,summary,starts_at,ends_at,status,origin,responsible,created_by,created_at,cancelled_at").order("starts_at", { ascending: false }).limit(100);
  if (error) throw new Error("Não foi possível carregar as reuniões.");
  const leadIds = [...new Set((appointments ?? []).map((r: any) => r.lead_id))];
  const { data: leads, error: le } = leadIds.length ? await db.from("leads").select("id,name").in("id", leadIds) : { data: [], error: null };
  if (le) throw new Error("Não foi possível carregar os leads das reuniões.");
  const { data: allLeads, error: ale } = await db.from("leads").select("id,name").order("created_at", { ascending: false }).limit(300);
  if (ale) throw new Error("Não foi possível carregar os leads.");
  const { data: blocked, error: be } = await db.from("crm_calendar_blocked").select("id,starts_at,ends_at,reason,created_by,created_at").gte("ends_at", new Date().toISOString()).order("starts_at").limit(100);
  if (be) throw new Error("Não foi possível carregar os bloqueios.");
  let calendars: { id: string; name: string; primary: boolean }[] = [];
  let calendarsError = "";
  try { calendars = await (await import("./google-calendar.server")).listCalendars(); }
  catch (e) { calendarsError = e instanceof Error ? e.message : "Falha ao consultar o Google Agenda."; }
  return { settings, appointments: appointments ?? [], leadNames: Object.fromEntries((leads ?? []).map((l: any) => [l.id, l.name])), leads: allLeads ?? [], blocked: blocked ?? [], calendars, calendarsError };
});

export const saveCrmCalendarSettings = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({
    calendarId: z.string().max(500),
    durationMinutes: z.number().int().min(5).max(240),
    gapMinutes: z.number().int().min(0).max(20),
    businessDays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    dayStart: time,
    dayEnd: time,
    lunchStart: time,
    lunchEnd: time,
    minNoticeHours: z.number().int().min(0).max(168),
    responsible: z.string().max(160),
    enabled: z.boolean(),
    revision: z.number().int().min(0),
  }).strict().parse(i))
  .handler(async ({ data }) => {
    const db = await requireCalendarSession();
    const result = await db.rpc("save_crm_calendar_settings", {
      p_actor: CALENDAR_ACTOR, p_calendar: data.calendarId, p_duration: data.durationMinutes, p_gap: data.gapMinutes,
      p_days: data.businessDays, p_start: data.dayStart, p_end: data.dayEnd, p_lunch_start: data.lunchStart, p_lunch_end: data.lunchEnd,
      p_notice: data.minNoticeHours, p_responsible: data.responsible, p_enabled: data.enabled, p_revision: data.revision,
    });
    if (result.error) throw new Error("Configuração não salva: verifique os horários e atualize a tela antes de tentar novamente.");
    return { ok: true };
  });

export const getCrmCalendarSlots = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({ days: z.number().int().min(1).max(30).default(14) }).strict().parse(i))
  .handler(async ({ data }) => {
    const db = await requireCalendarSession();
    const settings = await readCalendarSettings(db);
    if (!settings?.enabled || !settings.calendar_id) throw new Error("Ative a agenda e selecione o calendário antes de consultar horários.");
    const busy = await liveCalendarBusy(db, settings, data.days);
    return { slots: availableSlots(toCalendarSettings(settings), busy, { days: data.days }) };
  });

export const bookCrmAppointment = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({ leadId: z.string().uuid(), start: z.string().datetime({ offset: true }), summary: z.string().min(1).max(500), confirmed: z.literal(true) }).strict().parse(i))
  .handler(async ({ data }) => {
    const db = await requireCalendarSession();
    const settings = await readCalendarSettings(db);
    if (!settings?.enabled || !settings.calendar_id) throw new Error("Ative a agenda e selecione o calendário antes de agendar.");
    const { data: lead, error } = await db.from("leads").select("id,name").eq("id", data.leadId).maybeSingle();
    if (error || !lead) throw new Error("Lead indisponível.");
    // Recheck availability against the live calendar immediately before creating the event.
    const busy = await liveCalendarBusy(db, settings, 60);
    if (!isSlotStillAvailable(toCalendarSettings(settings), busy, data.start)) throw new Error("O horário não está mais disponível; escolha outro.");
    const start = new Date(data.start);
    const end = new Date(start.getTime() + settings.duration_minutes * 60_000);
    const gc = await import("./google-calendar.server");
    const event = await gc.createCalendarEvent(settings.calendar_id, {
      summary: data.summary, description: `Reunião com ${lead.name} — registrada pelo PipeFlow CRM.`,
      start: start.toISOString(), end: end.toISOString(), timezone: settings.timezone,
    });
    const booked = await db.rpc("book_crm_appointment", {
      p_actor: CALENDAR_ACTOR, p_lead: lead.id, p_event: event.id, p_summary: data.summary,
      p_start: start.toISOString(), p_end: end.toISOString(), p_origin: "manual",
    });
    if (booked.error || !booked.data) {
      // The event exists but the CRM record failed: remove the orphan event, never confirm without both.
      await gc.deleteCalendarEvent(settings.calendar_id, event.id).catch(() => null);
      throw new Error("O agendamento não foi concluído: conflito de horário registrado no CRM. O evento criado foi desfeito.");
    }
    return { ok: true, id: booked.data };
  });

export const rescheduleCrmAppointment = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({ id: z.string().uuid(), start: z.string().datetime({ offset: true }), confirmed: z.literal(true) }).strict().parse(i))
  .handler(async ({ data }) => {
    const db = await requireCalendarSession();
    const settings = await readCalendarSettings(db);
    if (!settings?.enabled || !settings.calendar_id) throw new Error("Ative a agenda e selecione o calendário antes de reagendar.");
    const { data: appt, error } = await db.from("crm_appointments").select("id,event_id,status,starts_at,ends_at").eq("id", data.id).maybeSingle();
    if (error || !appt || appt.status !== "scheduled") throw new Error("Agendamento indisponível ou já cancelado.");
    const busy = await liveCalendarBusy(db, settings, 60);
    if (!isSlotStillAvailable(toCalendarSettings(settings), busy, data.start)) throw new Error("O horário não está mais disponível; escolha outro.");
    const start = new Date(data.start);
    const end = new Date(start.getTime() + settings.duration_minutes * 60_000);
    const gc = await import("./google-calendar.server");
    await gc.moveCalendarEvent(settings.calendar_id, appt.event_id, { start: start.toISOString(), end: end.toISOString(), timezone: settings.timezone });
    const result = await db.rpc("reschedule_crm_appointment", { p_actor: CALENDAR_ACTOR, p_id: data.id, p_start: start.toISOString(), p_end: end.toISOString() });
    if (result.error) {
      // The event was moved but the CRM record failed: move the event back, never confirm without both.
      await gc.moveCalendarEvent(settings.calendar_id, appt.event_id, { start: new Date(appt.starts_at).toISOString(), end: new Date(appt.ends_at).toISOString(), timezone: settings.timezone }).catch(() => null);
      throw new Error("O reagendamento não foi concluído: conflito de horário registrado no CRM. O horário anterior foi mantido.");
    }
    return { ok: true };
  });

export const cancelCrmAppointment = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({ id: z.string().uuid(), confirmed: z.literal(true) }).strict().parse(i))
  .handler(async ({ data }) => {
    const db = await requireCalendarSession();
    const settings = await readCalendarSettings(db);
    const { data: appt, error } = await db.from("crm_appointments").select("id,event_id,status").eq("id", data.id).maybeSingle();
    if (error || !appt || appt.status !== "scheduled") throw new Error("Agendamento indisponível ou já cancelado.");
    // CRM state first: it is the source of truth; the calendar event is removed afterwards.
    const result = await db.rpc("cancel_crm_appointment", { p_actor: CALENDAR_ACTOR, p_id: data.id });
    if (result.error) throw new Error("Não foi possível registrar o cancelamento.");
    if (settings?.calendar_id) await (await import("./google-calendar.server")).deleteCalendarEvent(settings.calendar_id, appt.event_id).catch((e) => console.error("calendar_event_delete_failed", e instanceof Error ? e.message : ""));
    return { ok: true };
  });

export const addCrmCalendarBlocked = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({ start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }), reason: z.string().trim().min(1).max(160) }).strict().parse(i))
  .handler(async ({ data }) => {
    const db = await requireCalendarSession();
    if (Date.parse(data.end) <= Date.parse(data.start)) throw new Error("O fim do bloqueio deve ser depois do início.");
    const result = await db.rpc("add_crm_calendar_blocked", { p_actor: CALENDAR_ACTOR, p_start: data.start, p_end: data.end, p_reason: data.reason });
    if (result.error || !result.data) throw new Error("Não foi possível registrar o bloqueio.");
    return { ok: true, id: result.data };
  });

export const removeCrmCalendarBlocked = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({ id: z.string().uuid() }).strict().parse(i))
  .handler(async ({ data }) => {
    const db = await requireCalendarSession();
    const result = await db.rpc("remove_crm_calendar_blocked", { p_actor: CALENDAR_ACTOR, p_id: data.id });
    if (result.error) throw new Error("Não foi possível remover o bloqueio.");
    return { ok: true };
  });

/** Eventos do Google Agenda já configurado para a semana exibida; reuniões do CRM são marcadas pelo id do evento. */
export const getCrmCalendarEvents = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({ from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) }).strict().parse(i))
  .handler(async ({ data }) => {
    const db = await requireCalendarSession();
    if (Date.parse(data.to) - Date.parse(data.from) > 45 * 86_400_000 || Date.parse(data.to) <= Date.parse(data.from)) throw new Error("Período da agenda inválido.");
    const settings = await readCalendarSettings(db);
    if (!settings?.calendar_id) return { configured: false as const, events: [], error: "" };
    try {
      const events = await (await import("./google-calendar.server")).listCalendarEvents(settings.calendar_id, data.from, data.to);
      return { configured: true as const, events, error: "" };
    } catch (e) {
      return { configured: true as const, events: [], error: e instanceof Error ? e.message : "Falha ao consultar o Google Agenda." };
    }
  });
