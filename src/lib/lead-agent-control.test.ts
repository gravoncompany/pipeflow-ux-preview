import { test } from "node:test";
import assert from "node:assert/strict";
import { leadAgentState, effectiveMode } from "./lead-agent-control";

const now = new Date("2026-11-03T15:00:00Z");
const funnel = { enabled: true, blocked: false, authorized: true, stageAllowed: true, openNow: true };
const base = { cards: 1, funnel, control: null, hold: false, humanRecent: false, now };

test("lead with no individual control follows the funnel agent", () => {
  assert.equal(leadAgentState(base).state, "active");
});

test("individual control never widens the funnel: funnel off stays off even if the lead is active", () => {
  assert.equal(leadAgentState({ ...base, funnel: { ...funnel, enabled: false }, control: { mode: "active", pausedUntil: null } }).state, "funnel_off");
});

test("numbers outside the funnel's authorized test list stay unanswered", () => {
  assert.equal(leadAgentState({ ...base, funnel: { ...funnel, authorized: false } }).state, "not_authorized");
});

test("disabling a lead stops automatic replies", () => {
  assert.equal(leadAgentState({ ...base, control: { mode: "disabled", pausedUntil: null } }).state, "disabled");
});

test("a pause holds until its deadline and then expires", () => {
  const paused = { mode: "paused" as const, pausedUntil: "2026-11-03T16:00:00Z" };
  assert.equal(leadAgentState({ ...base, control: paused }).state, "paused");
  assert.equal(effectiveMode(paused, new Date("2026-11-03T16:00:01Z")), "active");
});

test("a recent human reply pauses the AI for that conversation", () => {
  assert.equal(leadAgentState({ ...base, humanRecent: true }).state, "human_recent");
});

test("a human handoff is shown as human responsibility", () => {
  assert.equal(leadAgentState({ ...base, hold: true }).state, "human");
});

test("outside business hours the AI does not answer", () => {
  assert.equal(leadAgentState({ ...base, funnel: { ...funnel, openNow: false } }).state, "outside_hours");
});
