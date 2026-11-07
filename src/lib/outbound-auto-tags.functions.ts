import { createServerFn } from "@tanstack/react-start";

async function fullAccess() {
  const { requireCrmLeadSession } = await import("./crm-leads.server");
  const level = await requireCrmLeadSession(process.env.CRM_SESSION_SECRET).catch(() => null);
  return level === "full";
}

/** Somente leitura: etiquetas automáticas dos cards do Outbound. */
export const listOutboundAutoTags = createServerFn({ method: "GET" }).handler(async () => {
  if (!(await fullAccess())) return { authorized: false as const, tags: {} as Record<string, string[]> };
  const { loadOutboundAutoTags } = await import("./outbound-auto-tags.server");
  const tags = await loadOutboundAutoTags();
  return { authorized: true as const, tags };
});
