import { createServerFn } from "@tanstack/react-start";
import { firstContactSettingsSchema, firstContactTestSchema } from "./first-contact";

export const getFirstContact = createServerFn({ method: "GET" }).handler(async () => {
  const { firstContactOverview } = await import("./first-contact.server");
  return firstContactOverview();
});
export const saveFirstContact = createServerFn({ method: "POST" }).inputValidator(input => firstContactSettingsSchema.parse(input)).handler(async ({ data }) => {
  const { updateFirstContactSettings } = await import("./first-contact.server");
  return updateFirstContactSettings(data);
});
export const runFirstContactTest = createServerFn({ method: "POST" }).inputValidator(input => firstContactTestSchema.parse(input)).handler(async ({ data }) => {
  const { controlledFirstContactTest } = await import("./first-contact.server");
  return controlledFirstContactTest(data);
});
export const runFullFirstContactTest = createServerFn({ method: "POST" }).inputValidator(input => firstContactTestSchema.parse(input)).handler(async ({ data }) => {
  const { controlledFullFirstContactTest } = await import("./first-contact.server");
  return controlledFullFirstContactTest(data);
});