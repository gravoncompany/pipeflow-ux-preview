export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
export type UtmData = Record<(typeof UTM_KEYS)[number], string>;

const keyOf = (key: string) => key.toLowerCase().replace(/[\s_-]/g, "");
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Explicit submitted fields take precedence over the submitted landing-page URL. */
export function extractUtms(payload: unknown): UtmData {
  const raw = record(payload);
  const inner = record(raw.data);
  const values: Record<string, string> = {};
  const nested: Record<string, string> = {};
  for (const source of [raw, inner]) {
    for (const [key, value] of Object.entries(source)) {
      if (typeof value !== "string" && typeof value !== "number") continue;
      const text = String(value).trim();
      if (text) values[keyOf(key)] = text;
    }
  }
  for (const utm of [record(raw.utm), record(inner.utm)]) {
    for (const [key, value] of Object.entries(utm)) {
      if (typeof value !== "string" && typeof value !== "number") continue;
      const text = String(value).trim();
      if (text) nested[keyOf(key).replace(/^utm/, "")] = text;
    }
  }
  let params = new URLSearchParams();
  const landingUrl = values.landingurl || values.pageurl || values.formurl || values.urlorigem;
  if (landingUrl) {
    try { params = new URL(landingUrl).searchParams; } catch { /* Invalid URLs contain no usable attribution. */ }
  }
  return Object.fromEntries(UTM_KEYS.map((key) => [
    key, (values[keyOf(key)] || nested[keyOf(key.slice(4))] || params.get(key) || "").trim().slice(0, 300),
  ])) as UtmData;
}

export function sourceFromUtms(utms: UtmData, fallback: string) {
  return utms.utm_source || fallback;
}

export function leadOrigin(lead: { source: string; utmSource?: string }) {
  return lead.utmSource?.trim() || lead.source || "Não informada";
}

export function matchesWebhookToken(expected: string | undefined, received: string | null) {
  if (!expected || !received || expected.length !== received.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  return difference === 0;
}