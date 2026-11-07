export type CalendarSettings = {
  durationMinutes: number;
  gapMinutes: number;
  businessDays: number[];
  dayStart: string;
  dayEnd: string;
  lunchStart: string;
  lunchEnd: string;
  minNoticeHours: number;
  timezone: string;
};
export type BusyInterval = { start: string; end: string };
export type Slot = { start: string; end: string };

const parts = (tz: string, ms: number) => {
  const map: Record<string, number> = {};
  for (const p of new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(ms)) {
    if (p.type !== "literal") map[p.type] = Number(p.value);
  }
  return map;
};
/** Milliseconds between the timezone wall clock and UTC at an instant. */
export const tzOffsetMs = (tz: string, utcMs: number) => { const p = parts(tz, utcMs); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - utcMs; };
/** UTC instant for a wall-clock time in the timezone (one correction pass covers DST gaps deterministically). */
export function zonedWallToUtc(tz: string, y: number, m: number, d: number, hh: number, mm: number) {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  return guess - tzOffsetMs(tz, guess - tzOffsetMs(tz, guess));
}
const hm = (s: string) => { const [h, m] = s.split(":").map(Number); return { h: h || 0, m: m || 0 }; };

/** Business days (local date parts) covered by the look-ahead window. */
function businessDaysInWindow(settings: CalendarSettings, now: number, days: number) {
  const out: { year: number; month: number; day: number }[] = [];
  const startDay = new Date(now - 24 * 3_600_000);
  const sp = parts(settings.timezone, startDay.getTime());
  for (let i = 0; i < days + 1; i++) {
    const dayUtc = Date.UTC(sp.year, sp.month - 1, sp.day + i);
    const dp = parts(settings.timezone, dayUtc + 12 * 3_600_000);
    if (!settings.businessDays.includes(new Date(Date.UTC(dp.year, dp.month - 1, dp.day)).getUTCDay())) continue;
    out.push({ year: dp.year, month: dp.month, day: dp.day });
  }
  return out;
}

/** Lunch break expressed as busy intervals for each business day in the window. */
export function lunchIntervals(settings: CalendarSettings, now: number, days: number): BusyInterval[] {
  const { h: lsh, m: lsm } = hm(settings.lunchStart);
  const { h: leh, m: lem } = hm(settings.lunchEnd);
  return businessDaysInWindow(settings, now, days).map((d) => ({
    start: new Date(zonedWallToUtc(settings.timezone, d.year, d.month, d.day, lsh, lsm)).toISOString(),
    end: new Date(zonedWallToUtc(settings.timezone, d.year, d.month, d.day, leh, lem)).toISOString(),
  }));
}

/**
 * Free slots from configured business windows minus busy intervals (calendar events, lunch,
 * blocked periods/holidays). Never invents times: every slot starts on a duration+gap grid
 * inside the window and clears every busy interval plus the configured gap on both sides.
 */
export function availableSlots(settings: CalendarSettings, busy: BusyInterval[], opts: { now?: number; days?: number; limit?: number } = {}): Slot[] {
  const now = opts.now ?? Date.now();
  const days = Math.min(opts.days ?? 14, 60);
  const limit = Math.min(opts.limit ?? 60, 200);
  const earliest = now + settings.minNoticeHours * 3_600_000;
  const step = (settings.durationMinutes + settings.gapMinutes) * 60_000;
  const dur = settings.durationMinutes * 60_000;
  const gap = settings.gapMinutes * 60_000;
  const intervals = busy.map(b => ({ s: Date.parse(b.start) - gap, e: Date.parse(b.end) + gap })).filter(b => Number.isFinite(b.s) && Number.isFinite(b.e) && b.e > b.s);
  const { h: sh, m: sm } = hm(settings.dayStart);
  const { h: eh, m: em } = hm(settings.dayEnd);
  const out: Slot[] = [];
  for (const dp of businessDaysInWindow(settings, now, days)) {
    if (out.length >= limit) break;
    const winStart = zonedWallToUtc(settings.timezone, dp.year, dp.month, dp.day, sh, sm);
    const winEnd = zonedWallToUtc(settings.timezone, dp.year, dp.month, dp.day, eh, em);
    for (let t = winStart; t + dur <= winEnd && out.length < limit; t += step) {
      if (t < earliest) continue;
      if (intervals.some(b => t < b.e && t + dur > b.s)) continue;
      out.push({ start: new Date(t).toISOString(), end: new Date(t + dur).toISOString() });
    }
  }
  return out;
}

export const isSlotStillAvailable = (settings: CalendarSettings, busy: BusyInterval[], start: string, now = Date.now()) =>
  availableSlots(settings, busy, { now, days: 60, limit: 200 }).some(s => s.start === new Date(start).toISOString());
