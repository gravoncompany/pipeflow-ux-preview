const PREVIEW_HOST = /^(?:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.lovableproject\.com|id-preview--[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.lovable\.app)$/;

export function crmSessionCookieOptions(request: Request, production: boolean) {
  const url = new URL(request.url);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  // The development preview proxy terminates HTTPS before forwarding to Vite.
  // Only the platform's preview hosts may select an embedded cookie policy.
  let embeddedPreview = url.protocol === "https:" && PREVIEW_HOST.test(url.hostname);
  // In development the proxy may forward the preview host over plain HTTP; the
  // browser still sees HTTPS inside the editor iframe, so Strict would drop it.
  if (!production && !embeddedPreview && PREVIEW_HOST.test(url.hostname)) embeddedPreview = true;
  if (!production && !embeddedPreview && local) {
    try {
      const origin = new URL(request.headers.get("origin") || "");
      embeddedPreview = origin.protocol === "https:" && PREVIEW_HOST.test(origin.hostname);
    } catch { /* Local top-level requests retain Strict cookies. */ }
  }
  return {
    httpOnly: true,
    secure: production || url.protocol === "https:" || embeddedPreview,
    sameSite: embeddedPreview ? "none" as const : "strict" as const,
    ...(embeddedPreview ? { partitioned: true } : {}),
    path: "/",
  };
}

/** The header copy of the session is only issued/accepted outside the published site. */
export function allowsPreviewSessionHeader(request: Request, production: boolean) {
  if (!production) return true;
  return PREVIEW_HOST.test(new URL(request.url).hostname);
}