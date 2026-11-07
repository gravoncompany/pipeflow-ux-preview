import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { validateEvidence, type Analysis } from "./whatsapp-analysis";
const base: Analysis = { qualification: "qualified", summary: "", interestEvidence: [{ messageId: "1", quote: "Quero contratar tráfego pago" }], opportunity: "open", opportunityReason: "", serviceAssessment: "no_failure_observed", failures: [], nextAction: "", limitations: "" };
describe("qualificação por interesse do cliente em tráfego pago", () => {
  it("preserva qualificado com interesse expresso pelo cliente sem orçamento ou faturamento", () => {
    assert.equal(validateEvidence(base, [{ message_id: "1", body: "Quero contratar tráfego pago", from_me: false, sent_at: "", media_type: "" }]).qualification, "qualified");
  });
  it("oferta do atendente não qualifica o cliente", () => {
    assert.equal(validateEvidence(base, [{ message_id: "1", body: "Quero contratar tráfego pago", from_me: true, sent_at: "", media_type: "" }]).qualification, "inconclusive");
  });
  it("silêncio ou falta de evidência não vira desqualificação", () => {
    assert.equal(validateEvidence(base, []).qualification, "inconclusive");
  });
  it("descarta falha atribuída sem citação real", () => {
    assert.equal(validateEvidence({ ...base, serviceAssessment: "possible_failure", failures: [{ messageId: "inexistente", quote: "não respondo", reason: "" }] }, []).serviceAssessment, "insufficient_data");
  });
});