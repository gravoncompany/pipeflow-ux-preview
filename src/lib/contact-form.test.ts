import { test } from "node:test";
import assert from "node:assert/strict";
import { contactFormPayload, contactFormSchema, WHATSAPP_CONSENT_VERSION } from "./contact-form";
const input = { submissionId: "00000000-0000-4000-8000-000000000001", name: "João Silva", company: "", email: "", whatsapp: "11988887777", service: "", notes: "", whatsappConsent: false, landingUrl: "https://crm.gravoncompany.com/captura?utm_source=meta" };
test("unchecked consent persists no permission and keeps main pipeline", () => {
  const row = contactFormPayload(input, "https://crm.gravoncompany.com", new Date("2026-10-28T18:39:00Z"));
  assert.equal(row.first_contact_consent_at, null); assert.equal(row.first_contact_consent_version, null);
  assert.equal(row.pipeline_id, null); assert.equal(row.stage, "lead-novo");
});
test("explicit WhatsApp consent persists server timestamp, version, identity and stable submission", () => {
  const row = contactFormPayload({ ...input, whatsappConsent: true }, "https://crm.gravoncompany.com", new Date("2026-10-28T18:39:00Z"));
  assert.equal(row.first_contact_consent_at, "2026-10-28T18:39:00.000Z"); assert.equal(row.first_contact_consent_version, WHATSAPP_CONSENT_VERSION);
  assert.equal(row.first_contact_phone, "5511988887777"); assert.equal(row.first_contact_first_name, "João");
  assert.equal(row.first_contact_submission_id, `capture:${input.submissionId}`); assert.equal(row.utm_source, "meta");
});
test("invalid WhatsApp or coercible consent cannot authorize contact", () => {
  assert.equal(contactFormSchema.safeParse({ ...input, whatsappConsent: "true" }).success, false);
  assert.equal(contactFormSchema.safeParse({ ...input, whatsappConsent: true, whatsapp: "123" }).success, false);
});