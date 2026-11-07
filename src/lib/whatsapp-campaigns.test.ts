import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeDeliveries } from "./whatsapp-campaigns";
import { confirmBlocker } from "./campaign-confirm";
test("delivery summary counts each state", () => { const c = summarizeDeliveries(["queued","reserved","accepted","accepted","failed","unknown","cancelled"]); assert.deepEqual(c, { total: 7, queued: 1, sending: 1, accepted: 2, failed: 1, unknown: 1, cancelled: 1 }); });
const draft = { name: "Campanha", channel: "whatsapp" as const, leadIds: [], clientIds: ["c1"], subject: "", body: "Olá {{nome}}" };
test("Iniciar campanha requires the acknowledgement checkbox", () => { assert.equal(confirmBlocker({ draft, validation: { ready: true }, busy: false, acknowledged: false }), "Marque a caixa de ciência das orientações de envio."); });
test("Iniciar campanha unlocks with clients selected, validation ready and acknowledgement", () => { assert.equal(confirmBlocker({ draft, validation: { ready: true }, busy: false, acknowledged: true }), null); });

