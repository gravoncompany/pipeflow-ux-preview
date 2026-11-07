import type { CampaignInput } from "./campaigns";

/** Why "Confirmar envio / agendamento" is unavailable right now, or null when it can be clicked. */
export function confirmBlocker(input: {
  draft: Pick<CampaignInput, "name" | "channel" | "leadIds" | "subject" | "body"> & { clientIds?: string[] };
  validation: { ready: boolean } | null;
  busy: boolean;
  acknowledged?: boolean;
}): string | null {
  const { draft, validation, busy } = input;
  if (busy) return "Aguarde a ação em andamento.";
  if (draft.name.trim().length < 2) return "Dê um nome à campanha.";
  if (!draft.leadIds.length && !(draft.channel === "whatsapp" && draft.clientIds?.length)) return "Selecione ao menos um destinatário.";
  if (draft.channel === "whatsapp" && !draft.body.trim()) return "Escreva ou prepare a mensagem.";
  if (draft.channel === "email" && (!draft.subject.trim() || !draft.body.trim())) return "Preencha o assunto e a mensagem.";
  if (!validation) return "Clique em \"Validar canal\" primeiro.";
  if (!validation.ready) return "A validação encontrou impedimentos; veja os itens acima.";
  if (draft.channel === "whatsapp" && !input.acknowledged) return "Marque a caixa de ciência das orientações de envio.";
  return null;
}



/**
 * Save the current form, then send/schedule exactly that saved revision.
 * A failed save stops before any send; the dispatch step re-validates the saved
 * campaign, so edits made after the last validation are checked automatically.
 */
export async function saveThenStart<C extends { id: string; revision: number }, R extends { ok: boolean; message: string }>(
  input: CampaignInput,
  deps: { save: (input: CampaignInput) => Promise<C>; start: (id: string, revision: number) => Promise<R> },
): Promise<{ saved: C; result: R } | { saved: null; result: { ok: false; message: string; issues: [] } }> {
  let saved: C;
  try {
    saved = await deps.save(input);
  } catch (e) {
    const reason = e instanceof Error ? e.message : "Não foi possível salvar a campanha.";
    return { saved: null, result: { ok: false as const, message: `${reason} Nada foi enviado nem agendado.`, issues: [] as [] } };
  }
  const result = await deps.start(saved.id, saved.revision);
  return { saved, result };
}
