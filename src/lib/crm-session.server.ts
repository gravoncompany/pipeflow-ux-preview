import { getCookie, setCookie, deleteCookie, getRequest } from "@tanstack/react-start/server";
import { signCrmSession, verifyCrmSession } from "./crm-session-token";
import { allowsPreviewSessionHeader, crmSessionCookieOptions } from "./crm-session-cookie";
import { CRM_PREVIEW_SESSION_HEADER } from "./crm-preview-session";
import { previewTokenFor } from "./crm-preview-request.server";

const COOKIE = "pipeflow-session";
const MAX_AGE = 60 * 60 * 12;

/** Sets the HttpOnly cookie; returns the same signed token only for preview requests. */
export async function createCrmSession(level: "full" | "limited", secret: string): Promise<string | null> {
  const payload = `${level}:${Date.now() + MAX_AGE * 1000}`;
  const token = `${payload}:${await signCrmSession(payload, secret)}`;
  const request = getRequest();
  setCookie(COOKIE, token, { ...crmSessionCookieOptions(request, import.meta.env.PROD), maxAge: MAX_AGE });
  return allowsPreviewSessionHeader(request, import.meta.env.PROD) ? token : null;
}

export async function getCrmSessionLevel(secret: string) {
  const fromCookie = await verifyCrmSession(getCookie(COOKIE), secret);
  if (fromCookie) return fromCookie;
  const request = getRequest();
  if (!allowsPreviewSessionHeader(request, import.meta.env.PROD)) return null;
  const fromHeader = await verifyCrmSession(request.headers.get(CRM_PREVIEW_SESSION_HEADER) ?? undefined, secret);
  if (fromHeader) return fromHeader;
  // Same signed token carried in the server-function payload, for proxies that strip custom headers.
  return verifyCrmSession(previewTokenFor(request), secret);
}

export async function hasFullCrmSession(secret: string) {
  return (await getCrmSessionLevel(secret)) === "full";
}

export function deleteCrmSession() { deleteCookie(COOKIE, crmSessionCookieOptions(getRequest(), import.meta.env.PROD)); }
