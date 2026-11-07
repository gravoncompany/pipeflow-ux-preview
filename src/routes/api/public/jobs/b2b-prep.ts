import { createFileRoute } from "@tanstack/react-router";

// Executor da fila de preparação do Outbound: acordado pelo banco quando um card entra em Lead Novo
// (e uma vez por hora se sobrar fila). Exige o token privado guardado no banco; a resposta traz só contagens.
export const Route = createFileRoute("/api/public/jobs/b2b-prep")({ server: { handlers: {
  POST: async ({ request }) => {
    const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!bearer) return Response.json({ error: "Unauthorized" }, { status: 401 });
    try {
      const { runB2bPrepScheduled } = await import("@/lib/b2b-email-ai.server");
      const result = await runB2bPrepScheduled(bearer);
      if (!result) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return Response.json({ processed: result.processed, drafts: result.drafts });
    } catch {
      console.error("b2b_prep_job_failed");
      return Response.json({ error: "Processing unavailable" }, { status: 503 });
    }
  },
} } });
