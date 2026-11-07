// Browser-safe transport for the signed CRM session inside the editor preview only.
// The editor shows the preview in a cross-site iframe, where browsers may drop or
// refuse the HttpOnly session cookie (third-party cookie blocking). The server
// issues this copy of the same signed, expiring token only to preview requests and
// accepts it back only from preview/development requests; the published site keeps
// HttpOnly cookies as its only session.
export const CRM_PREVIEW_SESSION_HEADER = "x-pipeflow-preview-session";
const KEY = "pipeflow-preview-session";

// In-memory copy: some browsers block sessionStorage inside third-party iframes
// (setItem throws), which would silently lose the token on the next request.
let memoryToken: string | null = null;

export function getPreviewSessionToken(): string | null {
  if (typeof window === "undefined") return null;
  if (memoryToken) return memoryToken;
  try { return window.sessionStorage.getItem(KEY); } catch { return null; }
}

export function setPreviewSessionToken(token: string | null | undefined) {
  if (typeof window === "undefined") return;
  memoryToken = token || null;
  try {
    if (token) window.sessionStorage.setItem(KEY, token);
    else window.sessionStorage.removeItem(KEY);
  } catch { /* Storage unavailable: the in-memory copy and cookie remain. */ }
}

export function previewSessionHeaders(): Record<string, string> {
  const token = getPreviewSessionToken();
  return token ? { [CRM_PREVIEW_SESSION_HEADER]: token } : {};
}
