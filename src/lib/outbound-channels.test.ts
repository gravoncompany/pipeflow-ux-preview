import { test } from "node:test";
import assert from "node:assert/strict";
import { outboundChannels, type ChannelInputs } from "./outbound-channels";

const base = (over: Partial<ChannelInputs>): ChannelInputs => ({
  leads: [], emails: [], emailEvents: { byMessage: new Map(), failed: 0 }, diagnosisClicks: [], forms: [], emailReplies: [], waOut: [], waIn: [], ...over,
});
const at = (d: string, h = "15:00") => `${d}T${h}:00Z`;

test("a lead contacted by e-mail and WhatsApp counts once, in the channel of the first contact", () => {
  const r = outboundChannels(base({
    leads: [{ id: "a", stage: "reuniao-agendada", entryDate: "2026-11-02" }, { id: "b", stage: "fechado", entryDate: "2026-11-02" }, { id: "c", stage: "lead-novo", entryDate: "2026-11-02" }],
    emails: [{ leadId: "a", at: at("2026-11-02"), messageId: "m1" }, { leadId: "b", at: at("2026-11-04"), messageId: "m2" }],
    waOut: [{ leadId: "a", at: at("2026-11-03"), delivered: false, read: false }, { leadId: "b", at: at("2026-11-03"), delivered: true, read: true }],
  }), "2026-11-01", "2026-11-05");
  const by = Object.fromEntries(r.funnel.byChannel.map((x) => [x.channel, x]));
  assert.equal(by.email.leads, 1); assert.equal(by.email.meetings, 1); assert.equal(by.email.qualified, 1);
  assert.equal(by.whatsapp.leads, 1); assert.equal(by.whatsapp.customers, 1); assert.equal(by.whatsapp.meetings, 1);
  assert.equal(by.none.leads, 1);
  assert.deepEqual(r.funnel.total, { leads: 3, qualified: 2, meetings: 2, customers: 1 });
});

test("e-mail deliveries/opens come only from Brevo events; unavailable Brevo is not shown as zero", () => {
  const emails = [{ leadId: "a", at: at("2026-11-02"), messageId: "m1" }, { leadId: "b", at: at("2026-11-02"), messageId: "m2" }];
  const r = outboundChannels(base({ emails, emailEvents: { byMessage: new Map([["m1", new Set(["delivered", "opened"])], ["m2", new Set(["delivered", "loadedByProxy"])]]), failed: 0 } }), "2026-11-01", "2026-11-05");
  assert.equal(r.email.sent.value, 2); assert.equal(r.email.delivered.value, 2); assert.equal(r.email.opened.value, 1);
  const off = outboundChannels(base({ emails, emailEvents: null }), "2026-11-01", "2026-11-05");
  assert.equal(off.email.delivered.value, null); assert.equal(off.email.opened.state, "integration");
});

test("replies and forms count unique leads, only after that channel's first contact and inside the period", () => {
  const r = outboundChannels(base({
    emails: [{ leadId: "a", at: at("2026-11-02"), messageId: null }],
    waOut: [{ leadId: "b", at: at("2026-11-02"), delivered: true, read: false }],
    emailReplies: [{ leadId: "a", at: at("2026-11-03") }, { leadId: "a", at: at("2026-11-04") }, { leadId: "b", at: at("2026-11-03") }],
    waIn: [{ leadId: "b", at: at("2026-11-01") }, { leadId: "b", at: at("2026-11-03") }, { leadId: "b", at: at("2026-11-09") }],
    forms: [{ leadId: "a", at: at("2026-11-03") }, { leadId: "b", at: at("2026-11-04") }],
  }), "2026-11-01", "2026-11-05");
  assert.equal(r.email.replies.value, 1);
  assert.equal(r.whatsapp.replies.value, 1);
  assert.equal(r.email.forms.value, 1); assert.equal(r.whatsapp.forms.value, 1);
  assert.equal(r.whatsapp.delivered.value, 1); assert.equal(r.whatsapp.read.value, 0);
});
