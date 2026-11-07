import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clientDraftIssues, leadToClientDraft } from "./lead-to-client";

const lead = { id: "11111111-1111-4111-8111-111111111111", name: "Renata Souza", company: "Clínica Bella", whatsapp: "62999990000", email: "renata@bella.com", website: "https://bella.com", service: "Tráfego pago" };

describe("leadToClientDraft", () => {
  it("usa a empresa como nome da ficha e a pessoa como contato responsável, vinculado ao lead", () => {
    const d = leadToClientDraft(lead);
    assert.equal(d.tradeName, "Clínica Bella");
    assert.equal(d.contactName, "Renata Souza");
    assert.equal(d.leadId, lead.id);
    assert.equal(d.whatsapp, "62999990000");
    assert.equal(d.website, "https://bella.com");
  });
  it("lead sem empresa precisa de revisão", () => {
    assert.ok(clientDraftIssues(leadToClientDraft({ ...lead, company: "" })).includes("Informe o nome da empresa."));
    assert.deepEqual(clientDraftIssues(leadToClientDraft(lead)), []);
  });
});
