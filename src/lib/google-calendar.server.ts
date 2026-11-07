import { fetchWithoutRedirects } from "./no-redirect-fetch.server";

const GATEWAY = "https://connector-gateway.lovable.dev/google_calendar/calendar/v3";

async function calendarFetch(path: string, init: { method?: string; body?: unknown; query?: Record<string, string> } = {}) {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const connectionKey = process.env.GOOGLE_CALENDAR_API_KEY;
  if (!lovableKey || !connectionKey) throw new Error("Integração com Google Agenda não configurada.");
  const url = new URL(`${GATEWAY}${path}`);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  const response = await fetchWithoutRedirects(url.toString(), {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${lovableKey}`, "X-Connection-Api-Key": connectionKey, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 204) return null;
  const text = await response.text();
  if (!response.ok) {
    console.error(`Google Calendar request failed [${response.status}]: ${text.slice(0, 500)}`);
    throw new Error(`O Google Agenda recusou a operação (${response.status}).`);
  }
  return text ? JSON.parse(text) : null;
}

export async function listCalendars() {
  const data = await calendarFetch("/users/me/calendarList", { query: { maxResults: "100" } });
  return (data?.items ?? []).map((c: any) => ({ id: String(c.id), name: String(c.summary ?? c.id), primary: Boolean(c.primary) }));
}

export async function listBusyIntervals(calendarId: string, timeMin: string, timeMax: string) {
  const data = await calendarFetch(`/calendars/${encodeURIComponent(calendarId)}/events`, {
    query: { singleEvents: "true", timeMin, timeMax, maxResults: "250", orderBy: "startTime" },
  });
  return (data?.items ?? [])
    .filter((e: any) => e.status !== "cancelled" && e.start?.dateTime && e.end?.dateTime)
    .map((e: any) => ({ start: new Date(e.start.dateTime).toISOString(), end: new Date(e.end.dateTime).toISOString() }));
}

/** Eventos com título do calendário configurado (somente leitura; mesma consulta usada para a disponibilidade). */
export async function listCalendarEvents(calendarId: string, timeMin: string, timeMax: string) {
  const data = await calendarFetch(`/calendars/${encodeURIComponent(calendarId)}/events`, {
    query: { singleEvents: "true", timeMin, timeMax, maxResults: "250", orderBy: "startTime" },
  });
  return (data?.items ?? [])
    .filter((e: any) => e.status !== "cancelled" && (e.start?.dateTime || e.start?.date))
    .map((e: any) => ({
      id: String(e.id),
      summary: String(e.summary ?? "").slice(0, 300) || "Ocupado",
      allDay: !e.start?.dateTime,
      start: e.start?.dateTime ? new Date(e.start.dateTime).toISOString() : String(e.start.date),
      end: e.end?.dateTime ? new Date(e.end.dateTime).toISOString() : String(e.end?.date ?? e.start.date),
    }));
}

export async function createCalendarEvent(calendarId: string, event: { summary: string; description: string; start: string; end: string; timezone: string }) {
  const data = await calendarFetch(`/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    body: { summary: event.summary, description: event.description, start: { dateTime: event.start, timeZone: event.timezone }, end: { dateTime: event.end, timeZone: event.timezone } },
  });
  if (!data?.id) throw new Error("O Google Agenda não confirmou a criação do evento.");
  return { id: String(data.id) };
}

export async function moveCalendarEvent(calendarId: string, eventId: string, event: { start: string; end: string; timezone: string }) {
  const data = await calendarFetch(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    body: { start: { dateTime: event.start, timeZone: event.timezone }, end: { dateTime: event.end, timeZone: event.timezone } },
  });
  if (!data?.id) throw new Error("O Google Agenda não confirmou a atualização do evento.");
  return { id: String(data.id) };
}

export async function deleteCalendarEvent(calendarId: string, eventId: string) {
  await calendarFetch(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
}
