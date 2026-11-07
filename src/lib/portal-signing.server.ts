/** Exact Portal contract: sign the bytes sent, without adding identity fields. */
export async function signPortalBody(
  body: string,
  serviceToken: string,
  signingSecret: string,
  timestamp = String(Date.now()),
  requestId = crypto.randomUUID(),
) {
  if (!/^\d{13}$/.test(timestamp) || !/^[a-f0-9-]{36}$/i.test(requestId))
    throw new Error("Invalid signing metadata");
  const encoder = new TextEncoder();
  if (encoder.encode(body).byteLength > 8192) throw new Error("Body limit");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${timestamp}\n${requestId}\nPOST\n/api/public/gravon-ia/query\n${body}`),
  );
  return {
    body,
    headers: {
      Authorization: `Bearer ${serviceToken}`,
      "Content-Type": "application/json",
      "X-Gravon-Timestamp": timestamp,
      "X-Gravon-Request-Id": requestId,
      "X-Gravon-Signature": Array.from(new Uint8Array(mac), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join(""),
    },
  };
}
