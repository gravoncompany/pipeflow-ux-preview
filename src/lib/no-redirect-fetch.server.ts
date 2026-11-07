/** workerd supports manual/follow, not error; reject redirects without forwarding credentials. */
export class UpstreamRedirectError extends Error {
  constructor(public status: number) {
    super("upstream_redirect_rejected");
    this.name = "UpstreamRedirectError";
  }
}

export async function fetchWithoutRedirects(url: string, init: RequestInit, transport: typeof fetch = fetch) {
  const response = await transport(url, { ...init, redirect: "manual" });
  if ((response.status >= 300 && response.status < 400) || response.type === "opaqueredirect") {
    await response.body?.cancel();
    throw new UpstreamRedirectError(response.status);
  }
  return response;
}