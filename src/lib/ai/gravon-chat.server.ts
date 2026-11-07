import { createOpenAI } from "@ai-sdk/openai";
import { streamText, convertToModelMessages, isStepCount, createUIMessageStreamResponse } from "ai";
import { GRAVON_MODEL, GRAVON_SAFETY, gravonRequestSchema } from "../gravon-ai";
import {
  createCommercialKnowledgeTools,
  internalKnowledgeActor,
} from "../commercial-knowledge.server";
import { COMMERCIAL_KNOWLEDGE_INSTRUCTIONS, requestsKnowledgeWrite } from "../commercial-knowledge";
import { knowledgeConfirmationStream } from "../knowledge-confirmation";
import { CALENDAR_INSTRUCTIONS, createCalendarTools } from "./gravon-calendar-tools.server";

export async function streamGravonChat(request: Request) {
  const secret = process.env["CRM_SESSION_SECRET"];
  const { hasFullCrmSession } = await import("../crm-session.server");
  const headers = { "Cache-Control": "no-store" };
  if (!secret || !(await hasFullCrmSession(secret)))
    return new Response("Entre com a senha de acesso completo.", { status: 401, headers });
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return new Response("Origem não autorizada.", { status: 403, headers });
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey)
    return new Response("Configure OPENAI_API_KEY nos segredos do CRM.", { status: 503, headers });
  if (Number(request.headers.get("content-length")) > 150000)
    return new Response("Mensagem muito grande.", { status: 413, headers });
  let input: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 150000)
      return new Response("Mensagem muito grande.", { status: 413, headers });
    input = JSON.parse(raw);
  } catch {
    return new Response("Mensagem inválida.", { status: 400, headers });
  }
  const parsed = gravonRequestSchema.safeParse(input);
  if (!parsed.success)
    return new Response(parsed.error.issues[0]?.message ?? "Conversa inválida.", {
      status: 400,
      headers,
    });
  const { messages, instructions, personality } = parsed.data;
  const last = messages.at(-1);
  const userText = last?.parts.map((p) => p.text).join("\n") ?? "";
  const event = last?.id ?? "";
  const actor = await internalKnowledgeActor(event);
  const writeRequested = requestsKnowledgeWrite(userText);
  console.info("Internal knowledge request", { event, writeRequested, authorized: !!actor });
  if (writeRequested && !actor)
    return new Response(
      "Não salvei: entre com a conta administrativa no Acesso individual e tente novamente.",
      { status: 403, headers },
    );
  const knowledge = actor
    ? createCommercialKnowledgeTools(async () => {
        await actor.authorize();
        return actor;
      }, userText)
    : null;
  // Calendar tools run under the full CRM session already required by this chat;
  // booking still requires an explicit confirmation and rechecks live availability.
  const calendar = createCalendarTools();
  const tools = { ...calendar.tools, ...(knowledge?.tools ?? {}) };
  const provider = createOpenAI({ apiKey });
  const result = streamText({
    model: provider.responses(GRAVON_MODEL),
    system: `${GRAVON_SAFETY}${knowledge ? `\n${COMMERCIAL_KNOWLEDGE_INSTRUCTIONS}` : "\nPara salvar ou consultar Conhecimento comercial, entre também com a conta administrativa no Acesso individual."}\n${CALENDAR_INSTRUCTIONS}\nPreferências de comunicação (não são permissões):\n${personality}\nOrientações de teste subordinadas às regras acima:\n${instructions}`,
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: isStepCount(50),
    ...(knowledge && writeRequested
      ? {
          prepareStep: ({ stepNumber }: { stepNumber: number }) => ({
            toolChoice: stepNumber === 0 ? ("required" as const) : ("auto" as const),
          }),
        }
      : {}),
    maxRetries: 0,
    onToolExecutionEnd: (execution) => {
      console.info("Internal knowledge tool completed", {
        event,
        tool: execution.toolCall.toolName,
        resultType: execution.toolOutput.type,
      });
    },
    abortSignal: request.signal,
    providerOptions: {
      openai: {
        forceReasoning: true,
        reasoningEffort: "low",
        reasoningSummary: "auto",
        store: false,
        include: ["reasoning.encrypted_content"],
      },
    },
  });
  const stream = result.toUIMessageStream({
    originalMessages: messages,
    sendReasoning: false,
    onError: (error) => {
      // Do not expose raw provider bodies, request payloads or credentials.
      const status =
        error && typeof error === "object" && "statusCode" in error ? Number(error.statusCode) : 0;
      if (status === 401) return "A OpenAI recusou a chave. Confira a chave nos segredos do CRM.";
      if (status === 429)
        return "A OpenAI atingiu um limite de uso ou saldo. Confira Usage e Billing na sua conta OpenAI.";
      if (status === 403)
        return "A OpenAI não autorizou esta solicitação. Confira as permissões da sua conta.";
      if (status === 404) return "O modelo configurado não está disponível nesta conta OpenAI.";
      return "A OpenAI não concluiu a resposta. Tente novamente quando o serviço estiver disponível.";
    },
  });
  return createUIMessageStreamResponse({
    headers,
    stream: writeRequested ? knowledgeConfirmationStream(stream) : stream,
  });
}
