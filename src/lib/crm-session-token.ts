export type CrmSessionLevel = "full" | "limited";

export async function signCrmSession(payload: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyCrmSession(token: string | undefined, secret: string, now = Date.now()): Promise<CrmSessionLevel | null> {
  if (!secret || !token) return null;
  const parts = token.split(":");
  if (parts.length !== 3) return null;
  const [level, expiry, signed] = parts;
  if ((level !== "full" && level !== "limited") || !/^\d+$/.test(expiry) || !Number.isSafeInteger(Number(expiry)) || Number(expiry) <= now) return null;
  const expected = await signCrmSession(`${level}:${expiry}`, secret);
  if (signed.length !== expected.length) return null;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= signed.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0 ? level : null;
}