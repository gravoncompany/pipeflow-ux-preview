import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifySend, emailReadiness, emailSettingsInput, emptyEmailSettings, providerIssues, providerStatusFrom, renderEmail,
  scheduleIssues, utcToZonedLocal, zonedLocalToUtc, type EmailSettings, type ProviderProbe,
} from "./email-campaigns";
import { campaignAudience } from "./campaigns";

const settings: EmailSettings = { ...emptyEmailSettings, sender_email: "contato@gravon.com.br", sender_name: "Gravon", revision: 1 };
const okProbe: ProviderProbe = {
  configured: true,
  account: { status: 200 },
  senders: { status: 200, body: { senders: [{ id: 1, email: "Contato@Gravon.com.br", active: true }] } },
  domains: { status: 200, body: { domains: [{ domain_name: "gravon.com.br", authenticated: true, verified: true }] } },
};
const ok = () => providerStatusFrom(okProbe, settings, "2026-11-03T12:00:00Z");
const now = Date.parse("2026-11-03T12:00:00Z");
const content = { subject: "Olá {{nome}}", body: "Mensagem para {{empresa}}", scheduledAt: null };

test("horário local é interpretado no fuso configurado, não no fuso do navegador", () => {
  assert.equal(zonedLocalToUtc("2026-11-03T09:30", "America/Sao_Paulo"), "2026-11-03T12:30:00.000Z");
  assert.equal(zonedLocalToUtc("2026-11-03T09:30", "UTC"), "2026-11-03T09:30:00.000Z");
  assert.equal(zonedLocalToUtc("2026-07-01T09:00", "Europe/Lisbon"), "2026-07-01T08:00:00.000Z");
  assert.equal(utcToZonedLocal("2026-11-03T12:30:00.000Z", "America/Sao_Paulo"), "2026-11-03T09:30");
  assert.equal(zonedLocalToUtc("2026-03-08T02:30", "America/New_York"), null, "horário inexistente no horário de verão");
  assert.equal(zonedLocalToUtc("2026-11-03 09:30", "America/Sao_Paulo"), null);
  assert.equal(zonedLocalToUtc("2026-11-03T09:30", "Fuso/Invalido"), null);
});

test("agendamento: futuro válido passa; passado, muito próximo e além de 72h bloqueiam com motivo", () => {
  assert.deepEqual(scheduleIssues(null, "America/Sao_Paulo", now), []);
  assert.deepEqual(scheduleIssues("2026-11-04T12:00:00Z", "America/Sao_Paulo", now), []);
  assert.equal(scheduleIssues("2026-11-03T11:00:00Z", "America/Sao_Paulo", now)[0].code, "schedule_past");
  assert.equal(scheduleIssues("2026-11-03T12:02:00Z", "America/Sao_Paulo", now)[0].code, "schedule_too_soon");
  assert.equal(scheduleIssues("2026-11-07T12:00:00Z", "America/Sao_Paulo", now)[0].code, "schedule_too_far");
  assert.match(scheduleIssues("2026-11-03T11:00:00Z", "America/Sao_Paulo", now)[0].message, /08:00.*America\/Sao_Paulo/);
});

test("com canal, remetente, domínio, destinatários e data válidos a campanha fica pronta", () => {
  const r = emailReadiness({ ...content, scheduledAt: "2026-11-04T12:00:00Z" }, ok(), settings, 3, now);
  assert.equal(r.ready, true);
  assert.deepEqual(r.issues, []);
});

test("cada bloqueio é categorizado separadamente com instrução", () => {
  const status = providerStatusFrom({ configured: false, account: null, senders: null, domains: null }, settings);
  const r = emailReadiness({ subject: "", body: "", scheduledAt: "2026-11-01T00:00:00Z" }, status, settings, 0, now);
  assert.equal(r.ready, false);
  const categories = new Set(r.issues.map(i => i.category));
  for (const c of ["content", "consent", "schedule", "provider"]) assert.ok(categories.has(c as never), c);
  assert.ok(r.issues.every(i => i.action.length > 10));
  assert.ok(r.reasons.includes("Nenhum destinatário com e-mail válido e sem bloqueio."));
});

test("remetente: não configurado, não cadastrado e aguardando validação são distinguidos", () => {
  assert.ok(emailReadiness(content, ok(), { ...settings, sender_email: "" }, 1, now).issues.some(i => i.code === "sender_not_configured"));
  const missing = providerStatusFrom({ ...okProbe, senders: { status: 200, body: { senders: [] } } }, settings);
  assert.match(missing.checks.find(c => c.id === "sender")!.detail, /não está cadastrado/);
  const inactive = providerStatusFrom({ ...okProbe, senders: { status: 200, body: { senders: [{ email: settings.sender_email, active: false }] } } }, settings);
  assert.equal(inactive.checks.find(c => c.id === "sender")!.state, "pending");
  assert.equal(inactive.senderActive, false);
  assert.equal(emailReadiness(content, inactive, settings, 1, now).ready, false);
});

test("serviço: chave ausente, chave recusada e falha de rede bloqueiam sem expor dados", () => {
  const noKey = providerStatusFrom({ configured: false, account: null, senders: null, domains: null }, settings);
  assert.match(noKey.checks[0].action, /BREVO_API_KEY/);
  const refused = providerStatusFrom({ ...okProbe, account: { status: 401 } }, settings);
  assert.equal(refused.reachable, false);
  assert.match(refused.checks.find(c => c.id === "account")!.detail, /401/);
  assert.equal(refused.checks.find(c => c.id === "sender")!.state, "pending");
  const offline = providerStatusFrom({ ...okProbe, account: { error: true } }, settings);
  assert.equal(emailReadiness(content, offline, settings, 1, now).ready, false);
  assert.equal(JSON.stringify([noKey, refused, offline]).includes("api-key"), false);
});

test("domínio sem autenticação bloqueia campanhas mas não testes; e-mail gratuito é sinalizado", () => {
  const unauth = providerStatusFrom({ ...okProbe, domains: { status: 200, body: { domains: [{ domain_name: "gravon.com.br", authenticated: false }] } } }, settings);
  assert.equal(emailReadiness(content, unauth, settings, 1, now).ready, false);
  assert.equal(providerIssues(unauth, settings, "test").some(i => i.blocking), false);
  const gmail = { ...settings, sender_email: "alguem@gmail.com" };
  const free = providerStatusFrom({ ...okProbe, senders: { status: 200, body: { senders: [{ email: gmail.sender_email, active: true }] } } }, gmail);
  assert.equal(free.freeMailDomain, true);
  assert.match(free.checks.find(c => c.id === "domain")!.action, /domínio próprio/);
});

test("conteúdo: só {{nome}} e {{empresa}} são aceitos e o HTML é escapado", () => {
  assert.ok(emailReadiness({ ...content, body: "Olá {{ params.x }}" }, ok(), settings, 1, now).issues.some(i => i.code === "template_syntax"));
  assert.ok(emailReadiness({ ...content, body: "{% if %}" }, ok(), settings, 1, now).issues.some(i => i.code === "template_syntax"));
  const r = renderEmail({ subject: "Oi {{nome}}", body: "<b>{{empresa}}</b>\nlinha" }, { name: "Ana $&", company: "A&B" }, true);
  assert.equal(r.subject, "[TESTE] Oi Ana $&");
  assert.ok(r.html.includes("&lt;b&gt;A&amp;B&lt;/b&gt;<br>linha"));
  assert.ok(r.text.includes("DESCADASTRAR"));
});

test("resposta do provedor: só recusa explícita conta como não enviado; o resto é desconhecido", () => {
  assert.deepEqual(classifySend(201, { messageId: "<abc@smtp>" }), { state: "accepted", messageId: "<abc@smtp>" });
  assert.equal(classifySend(201, {}).state, "unknown");
  assert.equal(classifySend(400, { code: "invalid_parameter", message: "x" }).state, "failed");
  assert.equal(classifySend(500, null).state, "unknown");
  assert.equal(classifySend(429, null).state, "unknown");
});

test("configuração valida e-mail, nome e fuso", () => {
  assert.equal(emailSettingsInput.safeParse({ senderEmail: "A@B.com", senderName: "Gravon", replyTo: "", timezone: "America/Sao_Paulo", revision: 0 }).success, true);
  assert.equal(emailSettingsInput.safeParse({ senderEmail: "x", senderName: "Gravon", replyTo: "", timezone: "America/Sao_Paulo", revision: 0 }).success, false);
  assert.equal(emailSettingsInput.safeParse({ senderEmail: "a@b.com", senderName: "G\r\nBcc: x", replyTo: "", timezone: "America/Sao_Paulo", revision: 0 }).success, false);
  assert.equal(emailSettingsInput.safeParse({ senderEmail: "a@b.com", senderName: "Gravon", replyTo: "", timezone: "Lua/Base", revision: 0 }).success, false);
});

test("revisão de destinatários expõe origem e data do consentimento e tolera contatos nulos", () => {
  const lead = { id: "00000000-0000-4000-8000-000000000001", name: "Ana", company: null, email: " Ana@Example.test ", whatsapp: null };
  const [row] = campaignAudience([lead], "email", [{ lead_id: lead.id, channel: "email", contact: "ana@example.test", withdrawn_at: null, evidence: "Formulário do site", granted_at: "2026-10-01T10:00:00Z", recorded_at: "2026-10-02T10:00:00Z" }], []);
  assert.equal(row.eligible, true);
  assert.deepEqual(row.consent, { evidence: "Formulário do site", grantedAt: "2026-10-01T10:00:00Z", recordedAt: "2026-10-02T10:00:00Z" });
  assert.equal(campaignAudience([lead], "whatsapp", [], [])[0].reason, "Contato ausente ou inválido");
});

test("falha ao consultar a lista de bloqueio da Brevo bloqueia o envio como restrição do provedor", () => {
  const r = emailReadiness({ ...content, scheduledAt: "2026-11-04T12:00:00Z" }, ok(), settings, 3, now, { checked: true, ok: false, code: "unavailable", blockedCount: 0 });
  assert.equal(r.ready, false);
  assert.ok(r.issues.some(i => i.category === "provider" && i.code === "blocklist_unavailable" && i.blocking));
  const info = emailReadiness({ ...content, scheduledAt: "2026-11-04T12:00:00Z" }, ok(), settings, 3, now, { checked: true, ok: true, code: "", blockedCount: 2 });
  assert.equal(info.ready, true);
  assert.ok(info.issues.some(i => i.code === "provider_blocked_recipients" && !i.blocking));
});
