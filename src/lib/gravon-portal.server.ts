import { tool } from "ai";
import { z } from "zod";
import { fetchWithoutRedirects } from "./no-redirect-fetch.server";
import { signPortalBody } from "./portal-signing.server";
import {
  portalInput,
  PORTAL_ENDPOINT,
  PORTAL_RESULT_LIMIT,
  portalErrorMessages,
  type PortalInput,
} from "./gravon-portal";

export type PortalIdentity = { subject: string; authorize: () => Promise<void> };
export type PortalOutcome = {
  status: number;
  result?: Record<string, unknown>;
  error?: string;
  retryAfter?: number;
};

export async function signPortalRequest(
  input: PortalInput,
  subject: string,
  serviceToken: string,
  signingSecret: string,
  timestamp = String(Date.now()),
  requestId = crypto.randomUUID(),
) {
  const args = portalInput.parse(input);
  z.string().min(1).max(160).parse(subject);
  if (!/^\d{13}$/.test(timestamp) || !z.string().uuid().safeParse(requestId).success)
    throw new Error("Invalid signing metadata");
  const body = JSON.stringify({
    subject,
    operation: args.operation,
    project_id: args.project_id,
    search: args.search,
    period: args.period,
    platform: args.platform,
    status: args.status,
    limit: args.limit,
    offset: args.offset,
  });
  return signPortalBody(body, serviceToken, signingSecret, timestamp, requestId);
}

/** Bounded streaming read: never buffer an unbounded external response or truncate totals. */
export async function boundedJson(
  response: Response,
  maximum = PORTAL_RESULT_LIMIT,
): Promise<unknown> {
  if (!response.body) throw new Error("Invalid response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new Error("response_too_large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

const resultSchema = z
  .object({
    version: z.literal("1"),
    operation: portalInput.shape.operation,
    result: z.enum(["ok", "list", "clarification_required", "not_found"]),
    queried_at: z.string().datetime(),
    content_policy: z.string(),
    requested_period: z.record(z.unknown()),
    project: z.record(z.unknown()).nullable(),
    data: z.unknown(),
    sources: z.array(z.string()),
    source_updated_at: z.string().nullable(),
    missing_fields: z.array(z.string()),
    limitations: z.array(z.string()),
    effective_coverage: z.unknown().optional(),
    pagination: z.record(z.unknown()).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.result === "ok" && !("effective_coverage" in value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Missing coverage" });
    }
    if (["list", "clarification_required", "not_found"].includes(value.result)) {
      const options = z.array(
        z.object({ id: z.string().uuid(), company_name: z.string(), status: z.string() }),
      );
      if (
        value.project !== null ||
        !options.safeParse(value.data).success ||
        (value.result === "not_found" && Array.isArray(value.data) && value.data.length !== 0)
      ) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid project options" });
      }
    }
    if (
      value.result === "list" &&
      (value.operation !== "projects" ||
        !z
          .object({
            offset: z.number().int().min(0).max(1000),
            limit: z.number().int().min(1).max(50),
            has_more: z.boolean(),
          })
          .safeParse(value.pagination).success)
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid list pagination" });
    }
  });

export async function queryPortal(
  raw: unknown,
  identity: PortalIdentity,
  secrets: { serviceToken: string; signingSecret: string },
  transport: typeof fetch = fetch,
): Promise<PortalOutcome> {
  const args = portalInput.parse(raw);
  await identity.authorize();
  const signed = await signPortalRequest(
    args,
    identity.subject,
    secrets.serviceToken,
    secrets.signingSecret,
  );
  try {
    const response = await fetchWithoutRedirects(
      PORTAL_ENDPOINT,
      {
        method: "POST",
        ...signed,
        signal: AbortSignal.timeout(15000),
      },
      transport,
    );
    const rawResult = await boundedJson(response);
    if (!response.ok) {
      const parsed = z.object({ error: z.string().max(80) }).safeParse(rawResult);
      const error =
        parsed.success && /^[a-z_]+$/.test(parsed.data.error)
          ? parsed.data.error
          : "integration_unavailable";
      const retry = Number(response.headers.get("Retry-After"));
      return {
        status: response.status,
        error,
        ...(response.status === 429
          ? { retryAfter: Number.isFinite(retry) && retry > 0 ? retry : 60 }
          : {}),
      };
    }
    const result = resultSchema.parse(rawResult);
    if (result.operation !== args.operation) throw new Error("Mismatched operation");
    await identity.authorize();
    return { status: response.status, result };
  } catch (error) {
    return {
      status: 503,
      error:
        error instanceof Error && error.message === "response_too_large"
          ? "response_too_large"
          : "integration_unavailable",
    };
  }
}

export function createPortalTools(resolveIdentity: () => Promise<PortalIdentity>) {
  let calls = 0;
  let failure: string | null = null;
  return {
    tools: {
      consultar_portal_gravon: tool({
        description:
          "Consulta somente leitura aos projetos reais autorizados do Portal Gravon: projetos, andamento, dashboard, tráfego, otimizações, estratégia, onboarding e histórico. Para nomes ambíguos, devolve opções autorizadas; peça seleção explícita. Nunca altera dados.",
        inputSchema: portalInput,
        execute: async (raw) => {
          if (failure || ++calls > 4) {
            failure ??= "Limite de quatro consultas ao Portal por mensagem atingido.";
            return { error: "query_limit", message: failure };
          }
          try {
            // Defense in depth: direct execution cannot bypass the model-visible strict schema.
            const validated = portalInput.safeParse(raw);
            if (!validated.success) {
              failure = portalErrorMessages.invalid_input;
              return { error: "invalid_input", message: failure };
            }
            const identity = await resolveIdentity();
            const serviceToken = process.env.GRAVON_IA_SERVICE_TOKEN;
            const signingSecret = process.env.GRAVON_IA_IDENTITY_SIGNING_SECRET;
            if (!serviceToken || !signingSecret) {
              failure = portalErrorMessages.integration_not_configured;
              return { error: "integration_not_configured", message: failure };
            }
            const outcome = await queryPortal(validated.data, identity, {
              serviceToken,
              signingSecret,
            });
            if (outcome.error) {
              failure =
                portalErrorMessages[outcome.error] ??
                "Portal indisponível; nenhuma consulta autorizada disponível.";
              return {
                error: outcome.error,
                http_status: outcome.status,
                message: failure,
                ...(outcome.retryAfter ? { retry_after: outcome.retryAfter } : {}),
              };
            }
            return outcome.result;
          } catch {
            failure = portalErrorMessages.identity_unverified;
            return { error: "identity_unverified", message: failure };
          }
        },
      }),
    },
    finalFailure: () => failure,
  };
}
