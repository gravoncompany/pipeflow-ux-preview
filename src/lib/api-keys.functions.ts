import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const id = z.object({ id: z.string().uuid() });
const named = z.object({ name: z.string().max(200) });

export const getApiIntegrations = createServerFn({ method: "GET" }).handler(async () => {
  const { apiIntegrationsOverview } = await import("./api-keys.server");
  return apiIntegrationsOverview();
});
export const createApiKeyFn = createServerFn({ method: "POST" }).inputValidator((i) => named.parse(i)).handler(async ({ data }) => {
  const { createApiKey } = await import("./api-keys.server");
  return createApiKey(data.name);
});
export const renameApiKeyFn = createServerFn({ method: "POST" }).inputValidator((i) => id.extend(named.shape).parse(i)).handler(async ({ data }) => {
  const { renameApiKey } = await import("./api-keys.server");
  return renameApiKey(data.id, data.name);
});
export const revokeApiKeyFn = createServerFn({ method: "POST" }).inputValidator((i) => id.parse(i)).handler(async ({ data }) => {
  const { revokeApiKey } = await import("./api-keys.server");
  return revokeApiKey(data.id);
});
