import type { Analysis } from "./whatsapp-analysis";
import type { KnowledgeGeneration } from "./ai-knowledge";

export const LEARNING_SYNTHESIS_BATCH = 20;
export type LearningWork =
  | { kind: "analysis"; itemId: number; messages: unknown }
  | { kind: "synthesis"; analyses: Analysis[]; offset: number }
  | { kind: "publish" };

/** Exactly one provider call per invocation; publication is a separate atomic step. */
export async function executeLearningWork(work: LearningWork, deps: {
  analyze: (messages: unknown) => Promise<Analysis>;
  synthesize: (analyses: Analysis[]) => Promise<KnowledgeGeneration>;
  saveAnalysis: (id: number, result: Analysis) => Promise<void>;
  saveInsights: (result: KnowledgeGeneration, offset: number) => Promise<void>;
  publish: () => Promise<void>;
}) {
  if (work.kind === "analysis") {
    const result = await deps.analyze(work.messages);
    await deps.saveAnalysis(work.itemId, result);
  } else if (work.kind === "synthesis") {
    if (!work.analyses.length || work.analyses.length > LEARNING_SYNTHESIS_BATCH)
      throw new Error("Lote de aprendizado inválido.");
    const result = await deps.synthesize(work.analyses);
    if (!result.insights.length) throw new Error("A IA não encontrou aprendizados suficientes.");
    await deps.saveInsights(result, work.offset + work.analyses.length);
  } else await deps.publish();
}