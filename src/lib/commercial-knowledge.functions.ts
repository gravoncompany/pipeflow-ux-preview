import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

async function hasFullKnowledgeSession() {
  const secret = process.env.CRM_SESSION_SECRET;
  const { hasFullCrmSession } = await import("./crm-session.server");
  return Boolean(secret && (await hasFullCrmSession(secret)));
}

export const getCommercialKnowledge = createServerFn({ method: "POST" }).handler(async () => {
  if (!(await hasFullKnowledgeSession()))
    return { authorized: false, records: [], hasMore: false, company: null };
  const { internalKnowledgeActor, searchCommercialKnowledge } =
    await import("./commercial-knowledge.server");
  const actor = await internalKnowledgeActor("menu-read", "menu");
  if (!actor) return { authorized: false, records: [], hasMore: false, company: null };
  return {
    authorized: true,
    company: actor.company,
    ...(await searchCommercialKnowledge(actor, "")),
  };
});
export const saveCommercialKnowledge = createServerFn({ method: "POST" })
  .inputValidator((i) =>
    z
      .object({
        event: z.string().uuid(),
        id: z.string().uuid().nullable(),
        revision: z.number().int().nullable(),
        title: z.string().min(1).max(160),
        content: z.string().min(1).max(8000),
      })
      .strict()
      .parse(i),
  )
  .handler(async ({ data }) => {
    if (!(await hasFullKnowledgeSession()))
      throw new Error("Entre com acesso completo e sua conta administrativa.");
    const { internalKnowledgeActor, writeCommercialKnowledge } =
      await import("./commercial-knowledge.server");
    const actor = await internalKnowledgeActor(data.event, "menu");
    if (!actor) throw new Error("Entre com sua conta administrativa para salvar conhecimento.");
    return writeCommercialKnowledge(actor, {
      operation: data.id ? "replace" : "create",
      id: data.id,
      revision: data.revision,
      title: data.title,
      content: data.content,
    });
  });
