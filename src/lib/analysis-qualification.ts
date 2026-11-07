import { type Stage, type Tag } from "./crm-types";
import { type Analysis } from "./whatsapp-analysis";
export const normalizeQualification = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
export function qualificationTargets(stages: Stage[], tags: Tag[]) {
  const tagMatches = tags.filter((tag) => normalizeQualification(tag.label) === "qualificado");
  const exact = stages.filter((stage) => ["qualificado", "qualificados"].includes(normalizeQualification(stage.title)));
  const matches = exact.length ? exact : stages.filter((stage) => normalizeQualification(stage.title) === "qualificacao");
  return { tag: tagMatches.length === 1 ? tagMatches[0] : null, stage: matches.length === 1 ? matches[0] : null };
}
export function canOfferQualification(result: Analysis) { return result.qualification === "qualified" && result.interestEvidence.length > 0; }
export function conversationNote(result: Analysis) {
  return [result.summary.trim(), ...result.interestEvidence.map((e) => `• Cliente: “${e.quote}”`), result.opportunityReason.trim() ? `Oportunidade: ${result.opportunityReason.trim()}` : "", result.nextAction.trim() ? `Próxima ação: ${result.nextAction.trim()}` : ""].filter(Boolean).join("\n").slice(0, 8000);
}