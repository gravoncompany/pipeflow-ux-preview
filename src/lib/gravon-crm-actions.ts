import { z } from "zod";
import { DEFAULT_STAGES } from "./crm-types";
import { validateLookupInput, knownStageTitle } from "./gravon-crm-read";

export type MoveGrant = { instance: string; phone: string; readRevision: string; revision: string; inboundId: string };
export const proposeMoveInput = z.object({ field: z.enum(["name", "company", "phone", "id"]), query: z.string(), targetStage: z.string() }).strict();
export function validateMoveInput(raw: unknown) {
  const input = proposeMoveInput.parse(raw);
  validateLookupInput({ field: input.field, query: input.query });
  if (!DEFAULT_STAGES.some((s) => s.id === input.targetStage)) throw new Error("Etapa padrão não reconhecida.");
  return input;
}
export function parseMoveCommand(text: string): { code: string; cancel: boolean } | null {
  const match = /^(CONFIRMAR|CANCELAR)(?: ([A-F0-9]{32}))?$/i.exec(text.trim());
  return match ? { code: match[2]?.toUpperCase() ?? "", cancel: match[1].toUpperCase() === "CANCELAR" } : null;
}
export function moveReply(raw: unknown): string {
  if (!raw || typeof raw !== "object" || !("status" in raw)) throw new Error("Resultado de ação indisponível.");
  const result = raw as Record<string, unknown>;
  const fixed: Record<string, string> = {
    no_pending: "Não há movimentação aguardando confirmação dentro dos cinco minutos. Peça novamente para mover o lead e depois responda Confirmar ou Cancelar.",
    ambiguous_pending: "Há mais de uma movimentação aguardando confirmação. Nenhum lead foi movido. Aguarde cinco minutos e peça novamente uma movimentação por vez.",
    invalid: "Código de confirmação inválido ou indisponível. Nenhum lead foi movido.",
    cancelled: "Movimentação cancelada. Nenhum lead foi movido por esta ação.",
    expired: "Confirmação expirada após cinco minutos. Peça a movimentação novamente.",
    stale: "O lead foi alterado desde o pedido. Nenhuma mudança aplicada; peça uma nova movimentação.",
    unchanged: "O lead já está na etapa solicitada. Nenhuma mudança necessária.",
    custom: "Esta versão permite apenas etapas padrão. Nenhuma mudança aplicada.",
    unavailable: "Lead indisponível. Nenhuma mudança aplicada.",
    identify: "Não encontrei um único lead com essa identificação. Informe o nome/empresa exatos ou o ID do lead; nenhum lead foi movido.",
  };
  if (typeof result.status !== "string") throw new Error("Estado da ação inválido.");
  if (fixed[result.status]) return fixed[result.status];
  if (!["pending", "moved"].includes(result.status) || ["leadId", "leadName", "company", "sourceStage", "targetStage", "code"].some((k) => typeof result[k] !== "string")) throw new Error("Resultado de ação inválido.");
  const text = (key: string) => String(result[key]).replace(/[\r\n]/g, " ").slice(0, 120);
  const label = `${text("leadName")}${text("company") ? ` · ${text("company")}` : ""}`;
  if (result.status === "moved") return `Lead movido: ${label}\n${knownStageTitle(text("sourceStage"))} → ${knownStageTitle(text("targetStage"))}. Mudança registrada no CRM.`;
  if (!/^[A-F0-9]{32}$/.test(String(result.code))) throw new Error("Código inválido.");
  return `Mover ${label}\n${knownStageTitle(text("sourceStage"))} → ${knownStageTitle(text("targetStage"))}?\nNenhuma mudança feita ainda. Em até 5 minutos, responda apenas:\nConfirmar\nou Cancelar`;
}