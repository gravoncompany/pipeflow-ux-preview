import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canOfferQualification, qualificationTargets } from "./analysis-qualification";
import { analysisSchema } from "./whatsapp-analysis";
describe("confirmação de qualificação", () => {
  it("reutiliza etiqueta Qualificado e coluna Qualificação sem criar outra", () => {
    const result = qualificationTargets([{ id: "qualificacao", title: "Qualificação" }], [{ id: "qualificado", label: "Qualificado", color: "green" }]);
    assert.equal(result.stage?.id, "qualificacao"); assert.equal(result.tag?.id, "qualificado");
  });
  it("prefere coluna Qualificado e rejeita etiquetas ambíguas", () => {
    const result = qualificationTargets([{ id: "a", title: "Qualificação" }, { id: "b", title: "Qualificado" }], [{ id: "a", label: "Qualificado", color: "green" }, { id: "b", label: "Qualificado", color: "green" }]);
    assert.equal(result.stage?.id, "b"); assert.equal(result.tag, null);
  });
  it("oferece confirmação só com resultado qualificado e evidência", () => {
    const result = analysisSchema.parse({ qualification: "qualified", summary: "", interestEvidence: [{ messageId: "1", quote: "Quero tráfego pago" }], opportunity: "open", opportunityReason: "", serviceAssessment: "no_failure_observed", failures: [], nextAction: "", limitations: "" });
    assert.equal(canOfferQualification(result), true);
    assert.equal(canOfferQualification({ ...result, interestEvidence: [] }), false);
    assert.equal(canOfferQualification({ ...result, qualification: "inconclusive" }), false);
  });
});