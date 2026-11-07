import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyAttempt, requestSummary, responseSummary, statusBucket, summarizeEvents } from "./meta-capi-monitor";
import { buildQualifiedLeadEvent } from "./meta-capi";

const accepted = (b: unknown) => typeof (b as { events_received?: unknown })?.events_received === "number";

describe("Histórico de Conversões", () => {
  it("indicadores: enviados, aceitos, pendentes e com erro", () => {
    const s = summarizeEvents([
      { status: "sent", attempts: 1 }, { status: "ready", attempts: 0 }, { status: "retry_scheduled", attempts: 1 },
      { status: "failed", attempts: 2 }, { status: "unknown", attempts: 1 }, { status: "waiting_settings", attempts: 0 },
    ]);
    assert.deepEqual(s, { sent: 4, accepted: 1, pending: 3, error: 2, total: 6 });
    assert.equal(statusBucket("pixel_changed"), "error");
  });

  it("timeout, rede, 5xx e limite da Meta são falhas recuperáveis", () => {
    assert.equal(classifyAttempt({ ok: false, http: null, code: "timeout" }, accepted), "recoverable");
    assert.equal(classifyAttempt({ ok: false, http: null, code: "network" }, accepted), "recoverable");
    assert.equal(classifyAttempt({ ok: false, http: 503, code: "2" }, accepted), "recoverable");
    assert.equal(classifyAttempt({ ok: false, http: 400, code: "17" }, accepted), "recoverable");
  });
  it("token inválido ou parâmetro recusado não é recuperável; redirecionamento é incerto", () => {
    assert.equal(classifyAttempt({ ok: false, http: 400, code: "190" }, accepted), "rejected");
    assert.equal(classifyAttempt({ ok: false, http: 400, code: "100" }, accepted), "rejected");
    assert.equal(classifyAttempt({ ok: false, http: 302, code: "redirect" }, accepted), "unknown");
    assert.equal(classifyAttempt({ ok: true, body: { events_received: 1 } }, accepted), "accepted");
    assert.equal(classifyAttempt({ ok: true, body: {} }, accepted), "unknown");
  });

  it("registro técnico não guarda e-mail, telefone, hashes nem token", async () => {
    const body = await buildQualifiedLeadEvent({ eventId: "pipeflow-qualified-x", eventTime: "2026-11-04T00:00:00Z", leadId: "x", email: "ana@clinica.com", phone: "11988887777" });
    const req = JSON.stringify(requestSummary(body, "700246889593303"));
    assert.ok(!req.includes("ana@") && !req.includes("98888"));
    for (const h of [...(body.data[0].user_data.em ?? []), ...(body.data[0].user_data.ph ?? [])]) assert.ok(!req.includes(h));
    assert.match(req, /"user_data_fields":\["em","external_id","ph"\]/);
    const res = JSON.stringify(responseSummary(400, { error: { message: "Invalid email ana@clinica.com", code: 100, type: "OAuthException", fbtrace_id: "Abc123" } }));
    assert.ok(!res.includes("ana@") && !res.includes("Invalid"));
    assert.match(res, /"error_code":100/);
  });
});
