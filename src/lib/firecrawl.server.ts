// Busca pública na web via Firecrawl (conector gerenciado; credenciais só no servidor).
// Usada apenas quando falta o CNPJ ou para complementar a pesquisa de uma empresa antes da personalização.
const GATEWAY = "https://connector-gateway.lovable.dev/firecrawl/v2";

export type WebResult = { url: string; title: string; description: string };
export class FirecrawlError extends Error { constructor(public status: number, message: string) { super(message); } }

export function firecrawlConfigured(env: Record<string, string | undefined> = process.env) {
  return Boolean(env["LOVABLE_API_KEY"] && env["FIRECRAWL_API_KEY"]);
}

export async function firecrawlSearch(query: string, limit = 6, transport: typeof fetch = fetch, env: Record<string, string | undefined> = process.env): Promise<WebResult[]> {
  const lovable = env["LOVABLE_API_KEY"], key = env["FIRECRAWL_API_KEY"];
  if (!lovable || !key) throw new FirecrawlError(0, "Busca pública na web não configurada.");
  const res = await transport(`${GATEWAY}/search`, {
    method: "POST", redirect: "manual",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${lovable}`, "X-Connection-Api-Key": key },
    body: JSON.stringify({ query: query.slice(0, 300), limit: Math.min(Math.max(limit, 1), 10), lang: "pt", country: "BR" }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("firecrawl_search_failed", { status: res.status });
    throw new FirecrawlError(res.status, res.status === 402 || /credit/i.test(body) ? "Sem créditos para a busca pública na web." : `Busca pública indisponível (HTTP ${res.status}).`);
  }
  const data = await res.json() as { data?: { web?: unknown[] } | unknown[] };
  const rows = Array.isArray(data.data) ? data.data : (data.data?.web ?? []);
  return rows.flatMap((r) => {
    const x = r as { url?: unknown; title?: unknown; description?: unknown };
    return typeof x.url === "string" ? [{ url: x.url, title: String(x.title ?? "").slice(0, 300), description: String(x.description ?? "").slice(0, 600) }] : [];
  });
}
