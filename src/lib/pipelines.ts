import { z } from "zod";
import { DEFAULT_STAGES, type Lead, type Stage } from "./crm-types";

export const MAIN_PIPELINE = "main";
export type Pipeline = { id: string; name: string; stages: Stage[] };
export const pipelineName = z.string().trim().min(1).max(80);
export const pipelineStages = z.array(z.object({ id: z.string().min(1).max(80), title: z.string().trim().min(1).max(80) })).min(1).max(100)
  .refine((stages) => new Set(stages.map((s) => s.id)).size === stages.length, "Etapas duplicadas");
export function leadPipeline(lead: Pick<Lead, "pipelineId">) { return lead.pipelineId || MAIN_PIPELINE; }
export function freshPipelineStages() { return DEFAULT_STAGES.map((s) => ({ ...s })); }
export function filterPipelineLeads(leads: Lead[], id: string) { return leads.filter((lead) => leadPipeline(lead) === id); }
// Etapas sugeridas para o funil Outbound, criado somente se ainda não existir (reaproveita a arquitetura de funis).
export const OUTBOUND_STAGES: Stage[] = [
  { id: "outbound-novo", title: "Novo" }, { id: "outbound-primeiro-contato", title: "Primeiro contato" },
  { id: "outbound-follow-up-1", title: "Follow-up 1" }, { id: "outbound-follow-up-2", title: "Follow-up 2" },
  { id: "outbound-reuniao", title: "Reunião agendada" }, { id: "outbound-sem-interesse", title: "Sem interesse" },
];
