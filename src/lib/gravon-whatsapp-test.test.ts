import { describe, it as test } from "node:test";
import { strict as assert } from "node:assert";
import {
  AI_REPLY_PREFIX,
  isAiGeneratedBody,
  isAuthorizedTestPhone,
  isSelfChatMessage,
} from "./gravon-whatsapp-test";

const OWN = "5511999998888@s.whatsapp.net";

describe("isSelfChatMessage", () => {
  test("aceita mensagem própria na conversa consigo mesmo", () => {
    assert.equal(
      isSelfChatMessage({ fromMe: true, remoteJid: OWN, ownNumber: "5511999998888" }),
      true,
    );
  });

  test("recusa mensagem de outro contato", () => {
    assert.equal(
      isSelfChatMessage({
        fromMe: false,
        remoteJid: "5511888776655@s.whatsapp.net",
        ownNumber: "5511999998888",
      }),
      false,
    );
  });

  test("recusa mensagem própria enviada a outro contato", () => {
    assert.equal(
      isSelfChatMessage({
        fromMe: true,
        remoteJid: "5511888776655@s.whatsapp.net",
        ownNumber: "5511999998888",
      }),
      false,
    );
  });

  test("recusa quando o número conectado é desconhecido", () => {
    assert.equal(isSelfChatMessage({ fromMe: true, remoteJid: OWN, ownNumber: "" }), false);
  });
});

describe("isAuthorizedTestPhone", () => {
  test("aceita o número autorizado mesmo sem nono dígito", () => {
    assert.equal(isAuthorizedTestPhone({ remoteJid: OWN, authorizedPhone: "551199998888" }), true);
  });

  test("recusa número diferente do autorizado", () => {
    assert.equal(isAuthorizedTestPhone({ remoteJid: OWN, authorizedPhone: "5511888776655" }), false);
  });

  test("recusa autorização vazia", () => {
    assert.equal(isAuthorizedTestPhone({ remoteJid: OWN, authorizedPhone: "" }), false);
  });
});

describe("isAiGeneratedBody", () => {
  test("identifica resposta da IA pelo prefixo", () => {
    assert.equal(isAiGeneratedBody(`${AI_REPLY_PREFIX}Olá!`), true);
  });

  test("não confunde mensagem humana", () => {
    assert.equal(isAiGeneratedBody("Olá, Gravon AI!"), false);
  });
});

