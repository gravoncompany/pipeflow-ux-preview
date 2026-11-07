import { z } from "zod";
import { fetchWithoutRedirects } from "./no-redirect-fetch.server";

/** Server-only DeskData access-token management: cache, renewal and fail-closed errors. */

export class DeskDataAuthError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "DeskDataAuthError";
  }
}

export const DESKDATA_API_BASE = "https://api.deskdata.com.br";
/** Requested validity in hours; the API accepts 1..87600. */
const REQUESTED_HOURS = 24;
/** Renew this long before the token actually expires. */
const RENEWAL_BUFFER_MS = 10 * 60_000;
/** Fallback when the API's expires_at is missing or unreadable. */
const CONSERVATIVE_TTL_MS = 45 * 60_000;
const TRANSPORT_TIMEOUT_MS = 12_000;

const authResponse = z
  .object({
    status: z.object({ code: z.number().int() }),
    data: z
      .object({
        access_token: z.string().min(20).max(4000),
        expires_at: z.string().min(10).max(64).optional(),
      })
      .partial()
      .passthrough()
      .optional(),
  })
  .passthrough();

type CachedToken = { token: string; expiresAt: number };
let cached: CachedToken | null = null;

export function resetDeskDataToken() {
  cached = null;
}

export function deskDataTokenExpiresAt(): number | null {
  if (!cached) return null;
  return Number.isFinite(cached.expiresAt) ? cached.expiresAt : null;
}

function credentials(env: Record<string, string | undefined> = process.env) {
  const username = env.DESKDATA_USERNAME?.trim();
  const password = env.DESKDATA_PASSWORD;
  if (!username || !password)
    throw new DeskDataAuthError(
      "missing_credentials",
      "Credenciais da DeskData ausentes no backend.",
    );
  return { username, password };
}

export function deskDataCredentialMode(
  env: Record<string, string | undefined> = process.env,
): "static_token" | "username_password" | "none" {
  if (env.B2B_DESKDATA_TOKEN?.trim()) return "static_token";
  if (env.DESKDATA_USERNAME?.trim() && env.DESKDATA_PASSWORD) return "username_password";
  return "none";
}

async function requestToken(
  { username, password }: { username: string; password: string },
  transport: typeof fetch,
): Promise<CachedToken> {
  let response: Response;
  try {
    response = await fetchWithoutRedirects(
      `${DESKDATA_API_BASE}/auth`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          expires_in: REQUESTED_HOURS,
        }),
        signal: AbortSignal.timeout(TRANSPORT_TIMEOUT_MS),
      },
      transport,
    );
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError")
      throw new DeskDataAuthError(
        "timeout",
        "A autenticação na DeskData excedeu o tempo limite. Tente novamente.",
      );
    if (e instanceof Error && e.name === "UpstreamRedirectError")
      throw new DeskDataAuthError(
        "redirect_rejected",
        "A DeskData redirecionou a autenticação. Nada foi repetido.",
      );
    throw new DeskDataAuthError(
      "transport",
      "Não foi possível conectar à DeskData para autenticar. Tente novamente.",
    );
  }
  if (!response.ok) {
    const status = response.status;
    await response.body?.cancel().catch(() => {});
    if (status === 401 || status === 403)
      throw new DeskDataAuthError(
        `http_${status}`,
        "A DeskData recusou o usuário ou a senha. Confira as credenciais do backend.",
      );
    if (status === 429)
      throw new DeskDataAuthError(
        "rate_limited",
        "A DeskData limitou as autenticações. Aguarde antes de tentar novamente.",
      );
    throw new DeskDataAuthError(
      `http_${status}`,
      "A DeskData não concluiu a autenticação. Nada foi repetido automaticamente.",
    );
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new DeskDataAuthError(
      "invalid_response",
      "Resposta inválida da autenticação da DeskData.",
    );
  }
  const parsed = authResponse.safeParse(raw);
  const token = parsed.success ? parsed.data.data?.access_token : undefined;
  if (!parsed.success || parsed.data.status.code !== 2000 || !token)
    throw new DeskDataAuthError(
      "auth_rejected",
      "A DeskData não emitiu um access token. Confira as credenciais e a conta.",
    );
  const parsedExpiry = parsed.data.data?.expires_at
    ? Date.parse(parsed.data.data.expires_at)
    : Number.NaN;
  // An unreadable expiry must never lock the provider out: fall back to a short
  // conservative lifetime instead of trusting an unknown-duration token.
  const expiresAt = Number.isFinite(parsedExpiry)
    ? parsedExpiry
    : Date.now() + CONSERVATIVE_TTL_MS;
  return { token, expiresAt };
}

/**
 * Returns a valid DeskData bearer token, renewing it automatically before
 * expiry. Credentials and tokens never leave the server module.
 */
export async function getDeskDataToken(
  env: Record<string, string | undefined> = process.env,
  transport: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<string> {
  const staticToken = env.B2B_DESKDATA_TOKEN?.trim();
  if (staticToken) return staticToken;
  if (cached && cached.expiresAt - now() > RENEWAL_BUFFER_MS) return cached.token;
  cached = await requestToken(credentials(env), transport);
  return cached.token;
}
