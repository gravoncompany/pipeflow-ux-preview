// Per-request copy of the preview CRM token that arrived inside the server-function
// payload (TanStack sendContext). The editor preview proxy may drop custom request
// headers, so the payload is the transport that always reaches the server. Keyed by
// the live Request object, so it never leaks across requests and is garbage-collected.
const tokens = new WeakMap<Request, string>();

export function rememberPreviewToken(request: Request, token: unknown) {
  if (typeof token === "string" && token.length > 0 && token.length < 512) tokens.set(request, token);
}

export function previewTokenFor(request: Request): string | undefined {
  return tokens.get(request);
}
