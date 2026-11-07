import { test } from "node:test";
import assert from "node:assert/strict";
import { evolutionFailureCode, whatsAppCampaignLabel } from "./whatsapp-campaigns";
import { phoneDigits } from "./phone";
test("adds Brazil's 55 to saved 10/11-digit numbers before sending", () => {
    assert.equal(phoneDigits("51999986839"), "5551999986839");
    assert.equal(phoneDigits("4888453039"), "554888453039");
    assert.equal(phoneDigits("5551999986839"), "5551999986839");
  });
test("reads 'number not on WhatsApp' from the Evolution 400 body", () => {
    assert.equal(evolutionFailureCode(400, JSON.stringify({ status: 400, response: { message: [{ exists: false, jid: "x", number: "51999986839" }] } })), "not_on_whatsapp");
    assert.equal(evolutionFailureCode(400, "nope"), "http_400");
  });
test("labels completed campaigns with failures and interrupted ones", () => {
    const c = (o: Partial<Record<string, number>>) => ({ total: 1, queued: 0, sending: 0, accepted: 0, failed: 0, unknown: 0, cancelled: 0, ...o });
    assert.equal(whatsAppCampaignLabel("completed", c({ failed: 1 })), "Concluída sem envios (todas com erro)");
    assert.equal(whatsAppCampaignLabel("completed", c({ total: 2, accepted: 1, failed: 1 })), "Concluída com erros");
    assert.equal(whatsAppCampaignLabel("cancelled", c({ cancelled: 1 })), "Interrompida");
  });
