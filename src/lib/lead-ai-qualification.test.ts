import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decideQualification } from "./lead-ai-qualification";
import { buildQualifiedLeadEvent } from "./meta-capi";

const messages = [
  { message_id: "a1", body: "Oi, quanto custa a gestão de tráfego pago para minha clínica?", from_me: false, sent_at: "2026-11-01T10:00:00Z", media_type: null },
  { message_id: "b1", body: "Temos um plano de tráfego pago ideal para você", from_me: true, sent_at: "2026-11-01T10:01:00Z", media_type: null },
];
const base = { summary: "Quer tráfego pago.", fitReason: "Clínica busca anúncios, serviço atendido.", decision: "qualified" as const };

describe("qualificação automática", () => {
  it("marca Qualificado com citação literal do cliente e adequação explicada", () => {
    const d = decideQualification({ ...base, interestEvidence: [{ messageId: "a1", quote: "quanto custa a gestão de tráfego pago" }] }, messages);
    assert.equal(d.outcome, "qualified");
    assert.equal(d.evidence.length, 1);
  });
  it("mantém Em análise quando a única evidência é fala do atendente", () => {
    assert.equal(decideQualification({ ...base, interestEvidence: [{ messageId: "b1", quote: "Temos um plano de tráfego pago" }] }, messages).outcome, "insufficient");
  });
  it("mantém Em análise quando a citação não existe na conversa", () => {
    assert.equal(decideQualification({ ...base, interestEvidence: [{ messageId: "a1", quote: "quero contratar hoje" }] }, messages).outcome, "insufficient");
  });
  it("mantém Em análise sem explicação de adequação ao serviço", () => {
    assert.equal(decideQualification({ ...base, fitReason: " ", interestEvidence: [{ messageId: "a1", quote: "quanto custa" }] }, messages).outcome, "insufficient");
  });
  it("mantém Em análise quando a IA diz que faltam informações", () => {
    assert.equal(decideQualification({ ...base, decision: "insufficient", interestEvidence: [{ messageId: "a1", quote: "quanto custa" }] }, messages).outcome, "insufficient");
  });
});

describe("evento de lead qualificado da Meta", () => {
  it("usa event_id fixo e envia e-mail/telefone apenas com hash", async () => {
    const body = await buildQualifiedLeadEvent({ eventId: "pipeflow-qualified-x", eventTime: "2026-11-04T00:00:00Z", leadId: "x", email: " Ana@Clinica.com ", phone: "(11) 98888-7777" });
    const ev = body.data[0];
    assert.equal(ev.event_id, "pipeflow-qualified-x");
    assert.equal(ev.event_name, "QualifiedLead");
    assert.ok(!JSON.stringify(body).includes("ana@clinica.com"));
    assert.ok(!JSON.stringify(body).includes("98888"));
    assert.match(ev.user_data.em?.[0] ?? "", /^[0-9a-f]{64}$/);
    assert.match(ev.user_data.ph?.[0] ?? "", /^[0-9a-f]{64}$/);
    assert.equal("test_event_code" in body, false);
  });
});
