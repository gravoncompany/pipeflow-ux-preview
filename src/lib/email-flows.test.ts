import { test } from "node:test";
import assert from "node:assert/strict";
import { flowInput, gmailReplyQuery, gmailText, headerAddress, isOptOut, remainingDailyQuota, stripQuoted, aiApproved, FLOW_DAILY_LIMIT, effectiveReplyTo, replyAddressMonitored, matchReplies } from "./email-flows";

test("pedido de não contato é detectado; resposta comum não", () => {
  for (const t of ["DESCADASTRAR", "Por favor, me remova da sua lista", "Não quero mais receber esses e-mails", "pare de enviar", "Unsubscribe"]) assert.equal(isOptOut(t), true, t);
  for (const t of ["Tenho interesse, me liga amanhã", "Pode mandar a proposta?", "Agora não, mas no mês que vem sim"]) assert.equal(isOptOut(t), false, t);
});

test("texto citado do e-mail anterior é removido da resposta", () => {
  const raw = "Tenho interesse!\n\nEm seg., 3 de nov. de 2026 às 10:00, Gravon <x@y.com> escreveu:\n> Olá, Ana\n> Podemos conversar?";
  assert.equal(stripQuoted(raw), "Tenho interesse!");
});

test("remetente e consulta do Gmail", () => {
  assert.equal(headerAddress("Ana Souza <Ana@Clinica.com.br>"), "ana@clinica.com.br");
  assert.equal(headerAddress("bia@ex.com"), "bia@ex.com");
  assert.equal(gmailReplyQuery(["A@x.com", "a@x.com", "b@y.com"], 1700000000.7), "in:anywhere -in:drafts -in:sent after:1700000000 from:(a@x.com OR b@y.com)");
  assert.equal(gmailText({ mimeType: "multipart/alternative", parts: [{ mimeType: "text/html", body: { data: btoa("<p>x</p>") } }, { mimeType: "text/plain", body: { data: btoa(unescape(encodeURIComponent("Olá, tudo bem"))) } }] }), "Olá, tudo bem");
});

test("respostas vão para contato@gravoncompany.com e só são lidas se ele chegar à caixa conectada", () => {
  const mailbox = { address: "gravoncompany@gmail.com", aliases: ["contato@gravoncompany.com"] };
  assert.equal(effectiveReplyTo({ reply_to: "contato@gravoncompany.com", sender_email: "x@y.com" }), "contato@gravoncompany.com");
  assert.equal(effectiveReplyTo({ reply_to: "", sender_email: "Contato@GravonCompany.com" }), "contato@gravoncompany.com");
  assert.equal(replyAddressMonitored("contato@gravoncompany.com", mailbox), true);
  assert.equal(replyAddressMonitored("gravoncompany@gmail.com", mailbox), true);
  assert.equal(replyAddressMonitored("vendas@gravoncompany.com", mailbox), false, "endereço fora da caixa suspende os envios");
  assert.equal(replyAddressMonitored("", mailbox), false);
});

test("resposta conta só do contato inscrito, depois do início e nunca de um endereço da Gravon", () => {
  const start = "2026-11-01T12:00:00Z", t = Date.parse(start);
  const byContact = new Map([["ana@cliente.com", { id: "e1", started_at: start }], ["contato@gravoncompany.com", { id: "e2", started_at: start }]]);
  const replies = [
    { id: "m1", from: "Ana@Cliente.com", internalDate: t + 1000 },
    { id: "m2", from: "ana@cliente.com", internalDate: t - 1000 },
    { id: "m3", from: "contato@gravoncompany.com", internalDate: t + 1000 },
    { id: "m4", from: "outro@x.com", internalDate: t + 1000 },
    { id: "m5", from: "ana@cliente.com", internalDate: t + 2000 },
  ];
  const got = matchReplies(replies, byContact, ["gravoncompany@gmail.com", "contato@gravoncompany.com"], new Set(["m5"]));
  assert.deepEqual(got.map((g) => [g.reply.id, g.enrollment.id]), [["m1", "e1"]]);
});

test("limite diário de 250 envios inclui campanhas", () => {
  assert.equal(FLOW_DAILY_LIMIT, 250);
  assert.equal(remainingDailyQuota(240), 10);
  assert.equal(remainingDailyQuota(300), 0);
});

test("etapas com dias crescentes e IA aprovada só na revisão atual", () => {
  const base = { id: null, revision: 0, name: "Fluxo", aiEnabled: false, approveAi: false };
  assert.equal(flowInput.safeParse({ ...base, steps: [{ day: 1, subject: "a", body: "b" }, { day: 3, subject: "a", body: "b" }] }).success, true);
  assert.equal(flowInput.safeParse({ ...base, steps: [{ day: 3, subject: "a", body: "b" }, { day: 3, subject: "a", body: "b" }] }).success, false);
  assert.equal(aiApproved({ ai_enabled: true, ai_approved_revision: 4, revision: 4 }), true);
  assert.equal(aiApproved({ ai_enabled: true, ai_approved_revision: 3, revision: 4 }), false);
});

import { inSendWindow, referencedIds, shouldImportInbound, businessInboxQuery, flowScheduleInput } from "./email-flows";

test("janela de envio usa o horário de Brasília", () => {
  const f = { send_days: [1, 2, 3, 4, 5], send_start: "08:00:00", send_end: "18:00:00" };
  assert.equal(inSendWindow(f, new Date("2026-11-04T12:00:00Z")), true, "quarta 09:00 em Brasília");
  assert.equal(inSendWindow(f, new Date("2026-11-04T10:30:00Z")), false, "quarta 07:30 em Brasília");
  assert.equal(inSendWindow(f, new Date("2026-11-04T21:00:00Z")), false, "quarta 18:00 já fora");
  assert.equal(inSendWindow(f, new Date("2026-11-08T13:00:00Z")), false, "domingo fora");
  assert.equal(inSendWindow({ send_days: [0, 1, 2, 3, 4, 5, 6], send_start: "00:00", send_end: "24:00" }, new Date("2026-11-08T02:59:00Z")), true);
  assert.equal(flowScheduleInput.safeParse({ id: "00000000-0000-4000-8000-000000000001", revision: 1, days: [1], start: "18:00", end: "08:00", maxMessages: 3 }).success, false);
  assert.equal(flowScheduleInput.safeParse({ id: "00000000-0000-4000-8000-000000000001", revision: 1, days: [1], start: "08:00", end: "18:00", maxMessages: 11 }).success, false);
});

test("importa e-mails de pessoas; ignora automáticos de desconhecidos e mensagens da própria Gravon", () => {
  const h = (from: string, extra: Partial<{ listUnsubscribe: string; precedence: string; autoSubmitted: string }> = {}) => ({ from, listUnsubscribe: "", precedence: "", autoSubmitted: "", ...extra });
  const own = ["gravoncompany@gmail.com", "contato@gravoncompany.com"];
  assert.equal(shouldImportInbound(h("cliente@empresa.com.br"), false, own), true);
  assert.equal(shouldImportInbound(h("contato@gravoncompany.com"), true, own), false);
  assert.equal(shouldImportInbound(h("no-reply@banco.com"), false, own), false);
  assert.equal(shouldImportInbound(h("naoresponda@cakto.com.br"), false, own), false);
  assert.equal(shouldImportInbound(h("ofertas@loja.com", { listUnsubscribe: "<mailto:x>" }), false, own), false);
  assert.equal(shouldImportInbound(h("robo@site.com", { autoSubmitted: "auto-replied" }), false, own), false);
  assert.equal(shouldImportInbound(h("ana@cliente.com", { listUnsubscribe: "<mailto:x>" }), true, own), true, "contato com card sempre entra");
  assert.equal(shouldImportInbound(h("mailer-daemon@googlemail.com"), true, own), false);
});

test("identificadores de conversa e consulta do endereço comercial", () => {
  assert.deepEqual(referencedIds("<a@x>", "<b@y> <a@x>"), ["<a@x>", "<b@y>"]);
  assert.match(businessInboxQuery("Contato@GravonCompany.com", 100), /\{to:contato@gravoncompany\.com cc:contato@gravoncompany\.com deliveredto:contato@gravoncompany\.com\}/);
  assert.match(businessInboxQuery("contato@gravoncompany.com", 100), /-in:spam -in:trash/);
});
