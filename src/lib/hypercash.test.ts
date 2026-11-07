import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chargeDescription, isHypercashPayout, mapCharge, mapSubscription, matchClientByEmail, pagedData,
} from "./hypercash";

test("mapSubscription normaliza uma assinatura válida", () => {
  const sub = mapSubscription({
    id: "9b1d", status: "active", customerName: "Clínica Sorriso", customerEmail: "CONTATO@CLINICA.com ",
    productName: "Tráfego mensal", amount: 150000, frequency: "monthly",
    nextBillingDate: "2026-12-01T00:00:00Z", lastPaymentAt: "2026-11-01T10:00:00Z",
  });
  assert.deepEqual(sub, {
    subscriptionId: "9b1d", paymentMethod:null, customerName: "Clínica Sorriso", customerEmail: "contato@clinica.com",
    productName: "Tráfego mensal", amountCents: 150000, frequency: "monthly", status: "active",
    nextBillingDate: "2026-12-01T00:00:00Z", lastPaymentAt: "2026-11-01T10:00:00Z",
  });
});

test("mapSubscription rejeita status fora do contrato e payloads sem id", () => {
  assert.equal(mapSubscription({ id: "x", status: "weird" }), null);
  assert.equal(mapSubscription({ status: "active" }), null);
  assert.equal(mapSubscription(null), null);
  assert.equal(mapSubscription("active"), null);
});

test("mapSubscription descarta valores inválidos sem quebrar", () => {
  const sub = mapSubscription({ id: "a", status: "paused", amount: -5, nextBillingDate: "não é data" });
  assert.equal(sub?.amountCents, null);
  assert.equal(sub?.nextBillingDate, null);
});

test("mapCharge normaliza cobrança paga com transaction_id e paid_at", () => {
  const charge = mapCharge({
    id: "c1", subscriptionId: "s1", transactionId: "t1", orderId: "o1", amount: 150000,
    status: "paid", billingDate: "2026-11-01", paidAt: "2026-11-01T12:00:00Z", attemptNumber: 1,
  });
  assert.equal(charge?.chargeId, "c1");
  assert.equal(charge?.subscriptionId, "s1");
  assert.equal(charge?.transactionId, "t1");
  assert.equal(charge?.amountCents, 150000);
  assert.equal(charge?.status, "paid");
});

test("mapCharge usa a assinatura do contexto quando o payload não a repete", () => {
  const charge = mapCharge({ id: "c2", amount: 100, status: "pending" }, "s9");
  assert.equal(charge?.subscriptionId, "s9");
});

test("mapCharge rejeita cobrança sem valor íntegro ou com status desconhecido", () => {
  assert.equal(mapCharge({ id: "c", amount: 10.5, status: "paid" }), null);
  assert.equal(mapCharge({ id: "c", amount: 100, status: "PAID" }), null);
  assert.equal(mapCharge({ id: "c", status: "paid" }), null);
});

test("pagedData lê data/total, limita a quantidade e tolera formatos inválidos", () => {
  const body = { success: true, data: Array.from({ length: 150 }, (_, i) => i), total: 150 };
  const { items, total } = pagedData(body, 100);
  assert.equal(items.length, 100);
  assert.equal(total, 150);
  assert.deepEqual(pagedData(null), { items: [], total: null });
  assert.deepEqual(pagedData({ data: "não" }), { items: [], total: null });
});

test("matchClientByEmail vincula somente e-mail exato e único", () => {
  const clients = [
    { id: "1", tradeName: "Clínica A", legalName: null, email: "contato@a.com" },
    { id: "2", tradeName: "Clínica B", legalName: null, email: "contato@b.com" },
    { id: "3", tradeName: "Clínica C", legalName: null, email: "contato@a.com" },
  ];
  assert.equal(matchClientByEmail("CONTATO@b.com", clients)?.id, "2");
  assert.equal(matchClientByEmail("contato@a.com", clients), null); // ambíguo
  assert.equal(matchClientByEmail("ninguem@x.com", clients), null);
  assert.equal(matchClientByEmail(null, clients), null);
  assert.equal(matchClientByEmail("sem-arroba", clients), null);
});

test("isHypercashPayout reconhece repasses da plataforma no extrato", () => {
  assert.equal(isHypercashPayout("Transferência recebida HYPERCASH PAGAMENTOS"), true);
  assert.equal(isHypercashPayout("Hyper Cash ltda"), true);
  assert.equal(isHypercashPayout("Pix recebido de Maria"), false);
});

test("chargeDescription inclui o identificador da transação para rastreio e deduplicação", () => {
  const desc = chargeDescription(
    { chargeId: "c1", subscriptionId: null, transactionId: "t-123", orderId: null, amountCents: 0, status: "paid", billingDate: null, paidAt: null },
    "Tráfego mensal",
  );
  assert.equal(desc, "Tráfego mensal · HyperCash t-123");
});
