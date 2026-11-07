import { getRequest, setResponseHeader } from "@tanstack/react-start/server";
import { getCrmSessionLevel } from "./crm-session.server";

export async function requireCrmLeadSession(secret: string | undefined) {
  setResponseHeader("Cache-Control", "no-store");
  const request = getRequest();
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") throw new Error("Acesso negado.");
  const level = secret ? await getCrmSessionLevel(secret) : null;
  if (!level) throw new Error("Entre novamente no CRM.");
  return level;
}