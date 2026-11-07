// Envio de Web Push compatível com o runtime do servidor (somente WebCrypto, sem pacotes Node).
// Implementa VAPID (RFC 8292, ES256) e criptografia de payload aes128gcm (RFC 8291/8188).

const b64uToBytes = (s: string): Uint8Array => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const bytesToB64u = (b: Uint8Array): string => {
  let bin = "";
  for (const byte of b) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
};
const text = (s: string) => new TextEncoder().encode(s);

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm as BufferSource, { name: "HKDF" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

/** JWT VAPID assinado com ES256 a partir das chaves públicas/privada em base64url. */
async function vapidJwt(audience: string, subject: string, publicKeyB64u: string, privateKeyB64u: string): Promise<string> {
  const pub = b64uToBytes(publicKeyB64u); // ponto não comprimido: 0x04 || x || y
  const jwk: JsonWebKey = {
    kty: "EC", crv: "P-256",
    x: bytesToB64u(pub.slice(1, 33)),
    y: bytesToB64u(pub.slice(33, 65)),
    d: privateKeyB64u,
  };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = bytesToB64u(text(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = bytesToB64u(text(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: subject,
  })));
  const unsigned = `${header}.${payload}`;
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    text(unsigned) as BufferSource,
  ));
  return `${unsigned}.${bytesToB64u(sig)}`;
}

/** Criptografa o payload no formato aes128gcm para a inscrição informada. */
async function encryptPayload(
  payload: string,
  p256dhB64u: string,
  authB64u: string,
): Promise<Uint8Array> {
  const uaPublic = b64uToBytes(p256dhB64u);
  const authSecret = b64uToBytes(authB64u);

  const uaKey = await crypto.subtle.importKey(
    "raw", uaPublic as BufferSource, { name: "ECDH", namedCurve: "P-256" }, false, [],
  );
  const asKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const sharedBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: uaKey }, asKeys.privateKey, 256,
  );
  const sharedSecret = new Uint8Array(sharedBits);
  const asPublicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", asKeys.publicKey));

  const salt = crypto.getRandomValues(new Uint8Array(16));
  // RFC 8291: PRK = HKDF(auth, ecdh, "WebPush: info\0" || ua_pub || as_pub)
  const keyInfo = concat(text("WebPush: info\0"), uaPublic, asPublicRaw);
  const prk = await hkdf(authSecret, sharedSecret, keyInfo, 32);
  const cek = await hkdf(salt, prk, concat(text("Content-Encoding: aes128gcm\0"), text("P-256\0")), 16);
  const nonce = await hkdf(salt, prk, text("Content-Encoding: nonce\0"), 12);

  // Registro: payload || 0x02 (delimitador de último registro)
  const record = concat(text(payload), new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey("raw", cek as BufferSource, { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce as BufferSource }, aesKey, record as BufferSource,
  ));

  // Cabeçalho aes128gcm: salt(16) || rs(4) || idlen(1) || chave pública do servidor(65)
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096, false);
  return concat(salt, rs, new Uint8Array([asPublicRaw.length]), asPublicRaw, ciphertext);
}

export type PushSubscriptionKeys = { p256dh: string; auth: string };
export type PushMessage = { title: string; body: string; url?: string; tag?: string };
export type PushSendResult = { ok: boolean; status: number; gone: boolean };

/** Envia uma notificação push para uma inscrição. `gone` indica inscrição expirada (404/410). */
export async function sendWebPush(
  endpoint: string,
  keys: PushSubscriptionKeys,
  message: PushMessage,
): Promise<PushSendResult> {
  const publicKey = process.env["VAPID_PUBLIC_KEY"];
  const privateKey = process.env["VAPID_PRIVATE_KEY"];
  const subject = process.env["VAPID_SUBJECT"] || "mailto:contato@gravoncompany.com";
  if (!publicKey || !privateKey) throw new Error("Chaves de notificação push não configuradas");

  const audience = new URL(endpoint).origin;
  const jwt = await vapidJwt(audience, subject, publicKey, privateKey);
  const body = await encryptPayload(JSON.stringify(message), keys.p256dh, keys.auth);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `vapid t=${jwt}, k=${publicKey}`,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
      Urgency: "high",
    },
    body: body as BodyInit,
  });
  return { ok: response.status === 201, status: response.status, gone: response.status === 404 || response.status === 410 };
}

/** Chave pública VAPID para o navegador assinar as notificações. */
export function vapidPublicKey(): string {
  const key = process.env["VAPID_PUBLIC_KEY"];
  if (!key) throw new Error("Chaves de notificação push não configuradas");
  return key;
}
