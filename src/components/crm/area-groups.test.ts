import { test } from "node:test";
import assert from "node:assert/strict";
import { ATENDIMENTO_GROUPS } from "./AtendimentoLayout";
import { CAMPAIGN_GROUPS } from "./CampaignsLayout";

const paths = (groups: readonly { items: readonly { to: string }[] }[]) =>
  groups.flatMap((g) => g.items.map((i) => i.to));

test("Atendimento agrupa Conversas, Clientes, Todos os contatos e Agenda", () => {
  const all = paths(ATENDIMENTO_GROUPS);
  assert.deepEqual(all, ["/whatsapp", "/clientes", "/contatos", "/agenda", "/agenda/reunioes"]);
  // Conversas é a primeira opção do submenu.
  assert.equal(ATENDIMENTO_GROUPS[0].items[0].to, "/whatsapp");
});

test("Campanhas agrupa e-mail, WhatsApp, Fluxos de E-mail e Automações", () => {
  const all = paths(CAMPAIGN_GROUPS);
  assert.deepEqual(all, ["/campanhas", "/campanhas/whatsapp", "/fluxos-email", "/automacoes"]);
});
