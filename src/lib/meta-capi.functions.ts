import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { saveCapiInput, testEventCodeSchema } from "./meta-capi";

export const getMetaCapi = createServerFn({ method: "POST" }).handler(async () => {
  const { capiOverview } = await import("./meta-capi.server");
  return capiOverview();
});
export const saveMetaCapi = createServerFn({ method: "POST" }).inputValidator((i) => saveCapiInput.parse(i)).handler(async ({ data }) => {
  const { saveCapi } = await import("./meta-capi.server");
  return saveCapi(data);
});
export const checkMetaCapi = createServerFn({ method: "POST" }).handler(async () => {
  const { checkCapi } = await import("./meta-capi.server");
  return checkCapi();
});
export const testMetaCapiEvent = createServerFn({ method: "POST" }).inputValidator((i) => z.object({ testEventCode: testEventCodeSchema }).strict().parse(i)).handler(async ({ data }) => {
  const { sendCapiTestEvent } = await import("./meta-capi.server");
  return sendCapiTestEvent(data.testEventCode);
});
export const toggleMetaCapi = createServerFn({ method: "POST" }).inputValidator((i) => z.object({ enabled: z.boolean(), revision: z.number().int().positive() }).strict().parse(i)).handler(async ({ data }) => {
  const { setCapiEnabled } = await import("./meta-capi.server");
  return setCapiEnabled(data.enabled, data.revision);
});
export const removeMetaCapi = createServerFn({ method: "POST" }).inputValidator((i) => z.object({ revision: z.number().int().positive() }).strict().parse(i)).handler(async ({ data }) => {
  const { removeCapi } = await import("./meta-capi.server");
  return removeCapi(data.revision);
});
