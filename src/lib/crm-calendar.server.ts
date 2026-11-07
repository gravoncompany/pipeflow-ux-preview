import { lunchIntervals, type BusyInterval, type CalendarSettings } from "./crm-calendar";

export const CALENDAR_ACTOR = "Gestor comercial";

export async function requireCalendarSession() {
  const { requireCrmLeadSession } = await import("./crm-leads.server");
  const level = await requireCrmLeadSession(process.env.CRM_SESSION_SECRET);
  if (level !== "full") throw new Error("A agenda comercial exige o acesso completo.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export const toCalendarSettings = (s: any): CalendarSettings => ({
  durationMinutes: s.duration_minutes,
  gapMinutes: s.gap_minutes,
  businessDays: s.business_days,
  dayStart: String(s.day_start).slice(0, 5),
  dayEnd: String(s.day_end).slice(0, 5),
  lunchStart: String(s.lunch_start).slice(0, 5),
  lunchEnd: String(s.lunch_end).slice(0, 5),
  minNoticeHours: s.min_notice_hours,
  timezone: s.timezone,
});

export async function readCalendarSettings(db: any) {
  const { data, error } = await db.from("crm_calendar_settings").select("*").eq("id", 1).maybeSingle();
  if (error) throw new Error("Configuração da agenda indisponível.");
  return data;
}

export async function readCalendarBlocked(db: any, from: string, to: string): Promise<BusyInterval[]> {
  const { data, error } = await db.from("crm_calendar_blocked").select("starts_at,ends_at").lt("starts_at", to).gt("ends_at", from).limit(200);
  if (error) throw new Error("Não foi possível carregar os bloqueios da agenda.");
  return (data ?? []).map((b: any) => ({ start: new Date(b.starts_at).toISOString(), end: new Date(b.ends_at).toISOString() }));
}

/** Live busy intervals: Google events + lunch break + blocked periods/holidays. */
export async function liveCalendarBusy(db: any, settings: any, days: number) {
  const from = new Date().toISOString();
  const to = new Date(Date.now() + days * 24 * 3_600_000).toISOString();
  const gc = await import("./google-calendar.server");
  const events = await gc.listBusyIntervals(settings.calendar_id, from, to);
  const blocked = await readCalendarBlocked(db, from, to);
  const lunch = lunchIntervals(toCalendarSettings(settings), Date.now(), days);
  return [...events, ...blocked, ...lunch];
}
