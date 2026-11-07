import type { UIMessageChunk } from "ai";

/** For explicit writes, model text is withheld; only a validated DB result can confirm success. */
export function knowledgeConfirmationStream(source: ReadableStream<UIMessageChunk>) {
  let saved = false;
  let failed = false;
  let proposed = false;
  let title = "";
  const writes = new Set<string>();
  return source.pipeThrough(
    new TransformStream<UIMessageChunk, UIMessageChunk>({
      transform(chunk, controller) {
        if (
          chunk.type === "tool-input-start" &&
          ["criar_conhecimento", "atualizar_conhecimento"].includes(chunk.toolName)
        ) {
          writes.add(chunk.toolCallId);
          proposed = true;
        }
        if (chunk.type === "tool-output-available" && writes.has(chunk.toolCallId)) {
          const output = chunk.output;
          if (
            output &&
            typeof output === "object" &&
            "ok" in output &&
            output.ok === true &&
            "record" in output &&
            output.record &&
            typeof output.record === "object" &&
            "id" in output.record &&
            typeof output.record.id === "string" &&
            "title" in output.record &&
            typeof output.record.title === "string"
          ) {
            saved = true;
            title = output.record.title;
          } else failed = true;
        }
        if (
          (chunk.type === "tool-output-error" && writes.has(chunk.toolCallId)) ||
          chunk.type === "error"
        )
          failed = true;
        if (chunk.type === "text-delta") {
          return;
        }
        if (chunk.type === "text-start" || chunk.type === "text-end") return;
        if (chunk.type === "finish") return;
        controller.enqueue(chunk);
      },
      flush(controller) {
        const text = failed
          ? "Não confirmei o salvamento: a operação falhou. Confira o Conhecimento comercial antes de tentar novamente."
          : saved
            ? `Salvei no Conhecimento comercial: ${title}. A gravação foi confirmada pelo banco.`
            : proposed
              ? "Não salvei: a gravação não retornou sucesso."
              : "Não salvei: nenhuma função de gravação foi executada. Informe o conteúdo e o registro que deseja salvar; esclareça qual registro alterar se houver mais de um.";
        controller.enqueue({ type: "text-start", id: "knowledge-confirmation" });
        controller.enqueue({ type: "text-delta", id: "knowledge-confirmation", delta: text });
        controller.enqueue({ type: "text-end", id: "knowledge-confirmation" });
        controller.enqueue({ type: "finish" });
      },
    }),
  );
}
