import { test } from "node:test";
import assert from "node:assert/strict";
import { availableSlots, isSlotStillAvailable, lunchIntervals, zonedWallToUtc, type CalendarSettings } from "./crm-calendar";

const settings: CalendarSettings = {
  durationMinutes: 30, gapMinutes: 15, businessDays: [1, 2, 3, 4, 5],
  dayStart: "09:00", dayEnd: "18:00", lunchStart: "13:30", lunchEnd: "14:00",
  minNoticeHours: 2, timezone: "America/Sao_Paulo",
};
// 2026-11-02 is a Monday; America/Sao_Paulo is UTC-3 (no DST).
const now = Date.parse("2026-11-02T12:00:00Z"); // 09:00 in São Paulo

test("emits 30-minute slots on a 45-minute grid inside business hours, respecting minimum notice", () => {
  const slots = availableSlots(settings, [], { now, days: 1 });
  assert.ok(slots.length > 0);
  assert.equal(slots[0].start, "2026-11-02T14:15:00.000Z"); // first 45-min grid slot at/after now + 2h notice
  assert.equal(Date.parse(slots[1].start) - Date.parse(slots[0].start), 45 * 60_000);
  const last = slots[slots.length - 1];
  assert.ok(Date.parse(last.end) <= zonedWallToUtc("America/Sao_Paulo", 2026, 11, 2, 18, 0));
  assert.ok(slots.every(s => Date.parse(s.end) - Date.parse(s.start) === 30 * 60_000));
});

test("skips days outside the business days", () => {
  const sunday = Date.parse("2026-11-01T12:00:00Z");
  assert.equal(availableSlots(settings, [], { now: sunday, days: 1 }).length, 0);
});

test("removes slots that conflict with existing events, including the gap", () => {
  // Busy 14:00–15:00 UTC blocks the grid slots touching it plus the 15min gap on both sides.
  const slots = availableSlots(settings, [{ start: "2026-11-02T14:00:00Z", end: "2026-11-02T15:00:00Z" }], { now, days: 1 });
  assert.equal(slots.some(s => s.start === "2026-11-02T14:15:00.000Z"), false); // overlaps the event
  assert.equal(slots.some(s => s.start === "2026-11-02T15:00:00.000Z"), false); // inside event + gap
  assert.equal(slots.some(s => s.start === "2026-11-02T15:45:00.000Z"), true); // first grid slot after event + gap
});

test("never offers slots during the lunch break", () => {
  const busy = lunchIntervals(settings, now, 1);
  const slots = availableSlots(settings, busy, { now: Date.parse("2026-11-02T11:00:00Z"), days: 1 });
  // Lunch 13:30–14:00 local = 16:30–17:00 UTC; no slot may touch it (plus the 15min gap).
  for (const s of slots) {
    assert.equal(Date.parse(s.start) < Date.parse("2026-11-02T17:15:00Z") && Date.parse(s.end) > Date.parse("2026-11-02T16:15:00Z"), false);
  }
  assert.equal(slots.some(s => s.start === "2026-11-02T17:15:00.000Z"), true); // 14:15 local, right after lunch + gap
});

test("never offers slots during a blocked period or holiday", () => {
  const blocked = [{ start: "2026-11-03T03:00:00Z", end: "2026-11-04T03:00:00Z" }]; // Tuesday full day
  const slots = availableSlots(settings, blocked, { now, days: 3 });
  assert.ok(slots.every(s => !s.start.startsWith("2026-11-03")));
  assert.ok(slots.some(s => s.start.startsWith("2026-11-04")));
});

test("never offers slots before the minimum notice even when the window is open", () => {
  const tight = availableSlots({ ...settings, minNoticeHours: 24 }, [], { now, days: 1 });
  assert.ok(tight.every(s => Date.parse(s.start) >= now + 24 * 3_600_000));
});

test("isSlotStillAvailable confirms only real free slots", () => {
  const slots = availableSlots(settings, [], { now, days: 2 });
  assert.equal(isSlotStillAvailable(settings, [], slots[0].start, now), true);
  assert.equal(isSlotStillAvailable(settings, [{ start: slots[0].start, end: slots[0].end }], slots[0].start, now), false);
  assert.equal(isSlotStillAvailable(settings, [], "2026-11-02T03:00:00Z", now), false);
});

test("converts São Paulo wall time to UTC without a DST ambiguity", () => {
  assert.equal(new Date(zonedWallToUtc("America/Sao_Paulo", 2026, 11, 2, 9, 0)).toISOString(), "2026-11-02T12:00:00.000Z");
});
