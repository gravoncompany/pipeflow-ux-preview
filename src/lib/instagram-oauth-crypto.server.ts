const encoder = new TextEncoder();
export async function oauthHash(value: string) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export function oauthNonce() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
async function encryptionKey(secret: string) {
  if (secret.length < 64) throw new Error("instagram_oauth_encryption_missing");
  return crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest("SHA-256", encoder.encode(secret)),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}
export async function encryptInstagramToken(token: string, secret: string, context: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: encoder.encode(context) },
      await encryptionKey(secret),
      encoder.encode(token),
    ),
  );
  return `v1.${btoa(String.fromCharCode(...iv))}.${btoa(String.fromCharCode(...encrypted))}`;
}
export async function decryptInstagramToken(value: string, secret: string, context: string) {
  const [version, iv, data] = value.split(".");
  if (version !== "v1" || !iv || !data || value.length > 20000)
    throw new Error("instagram_oauth_credentials_invalid");
  const bytes = (v: string) => Uint8Array.from(atob(v), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes(iv), additionalData: encoder.encode(context) },
      await encryptionKey(secret),
      bytes(data),
    ),
  );
}
