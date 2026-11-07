import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { extractUtms, leadOrigin, matchesWebhookToken, sourceFromUtms } from "./lead-attribution";
import { leadToRow, rowToLead } from "./lead-mapper";

describe("form UTM attribution", () => {
  it("captures all five UTM fields submitted through Zapier", () => {
    assert.deepEqual(extractUtms({ data: { UTM_Source: " instagram ", utm_medium: "paid_social", utm_campaign: "trafego", utm_content: "video1", utm_term: "empresarios" } }), {
      utm_source: "instagram", utm_medium: "paid_social", utm_campaign: "trafego", utm_content: "video1", utm_term: "empresarios",
    });
  });
  it("reads a landing URL without treating the company website as attribution", () => {
    assert.equal(extractUtms({ landing_url: "https://forms.gravoncompany.com/?utm_source=google&utm_campaign=Pesquisa%20Local" }).utm_campaign, "Pesquisa Local");
    assert.equal(extractUtms({ website: "https://example.com/?utm_source=wrong" }).utm_source, "");
  });
  it("prefers submitted fields and supports nested utm objects", () => {
    assert.equal(extractUtms({ utm: { source: "facebook" }, landing_url: "https://example.com/?utm_source=google" }).utm_source, "facebook");
    assert.equal(extractUtms({ source: "Site" }).utm_source, "");
  });
  it("shows the tracked origin and preserves the fallback when UTMs are missing", () => {
    assert.equal(sourceFromUtms(extractUtms({ utm_source: "instagram" }), "Zapier"), "instagram");
    assert.equal(sourceFromUtms(extractUtms({}), "Zapier"), "Zapier");
    assert.equal(leadOrigin({ source: "Formulário público", utmSource: "google" }), "google");
  });
  it("retains campaign data after editing and saving a lead", () => {
    const lead = rowToLead({ id: "test", source: "instagram", utm_source: "instagram", utm_medium: "paid_social", utm_campaign: "trafego", utm_content: "video1", utm_term: "empresarios" });
    const row = leadToRow({ ...lead, notes: "Contato realizado" });
    assert.equal(row.utm_campaign, "trafego");
    assert.equal(row.utm_source, "instagram");
    assert.equal(row.utm_medium, "paid_social");
    assert.equal(row.utm_content, "video1");
    assert.equal(row.utm_term, "empresarios");
  });
  it("rejects external writes without the configured matching token", () => {
    assert.equal(matchesWebhookToken(undefined, "anything"), false);
    assert.equal(matchesWebhookToken("test-secret", null), false);
    assert.equal(matchesWebhookToken("test-secret", "wrong-token"), false);
    assert.equal(matchesWebhookToken("test-secret", "test-secret"), true);
  });
});