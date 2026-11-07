import { z } from "zod";
import { fetchWithoutRedirects } from "./no-redirect-fetch.server";

export const INSTAGRAM_GRAPH = "https://graph.instagram.com/v25.0";
export class InstagramApiError extends Error {
  constructor(public status: number, public code: number | null, public subcode: number | null) {
    super(`Meta: HTTP ${status}${code === null ? "" : ` · código ${code}`}${subcode === null ? "" : `/${subcode}`}`);
  }
}
export async function readBounded(response: Response, max = 262144) {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); throw new Error("instagram_payload_too_large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const c of chunks) { bytes.set(c, offset); offset += c.byteLength; }
  return bytes;
}
export async function instagramApi(path: string, token: string, method: "GET" | "POST" = "GET", body?: unknown, transport: typeof fetch = fetch) {
  const response = await fetchWithoutRedirects(`${INSTAGRAM_GRAPH}/${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000),
  }, transport);
  const bytes = await readBounded(response);
  let json: unknown;
  try { json = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new InstagramApiError(response.status, null, null); }
  const failure = z.object({ error: z.object({ code: z.number().int().optional(), error_subcode: z.number().int().optional() }) }).safeParse(json);
  if (!response.ok || failure.success) throw new InstagramApiError(response.status, failure.success ? failure.data.error.code ?? null : null, failure.success ? failure.data.error.error_subcode ?? null : null);
  return json;
}