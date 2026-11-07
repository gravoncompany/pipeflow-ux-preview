import { EVOLUTION_BASE_URL } from "./evolution.functions";
import { fetchWithoutRedirects } from "./no-redirect-fetch.server";

/** Transport only; caller must authorize and durably claim a reviewed send first. */
export async function evolutionSendText(apiKey: string, instance: string, number: string, text: string) {
  return fetchWithoutRedirects(`${EVOLUTION_BASE_URL}/message/sendText/${encodeURIComponent(instance)}`, {
    method: "POST", headers: { apikey: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ number, text }), signal: AbortSignal.timeout(10000),
  });
}