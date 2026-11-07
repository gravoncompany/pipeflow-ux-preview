import { createServerFn } from "@tanstack/react-start";

export const getGravonAiStatus = createServerFn({ method: "POST" }).handler(async () => {
  const secret = process.env["CRM_SESSION_SECRET"];
  const { hasFullCrmSession } = await import("./crm-session.server");
  if (!secret || !(await hasFullCrmSession(secret)))
    return { needsAuth: true, configured: false, automaticSending: false };
  return {
    needsAuth: false,
    configured: Boolean(process.env["OPENAI_API_KEY"]),
    automaticSending: false,
  };
});
