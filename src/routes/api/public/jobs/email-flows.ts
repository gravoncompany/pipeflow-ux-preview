import { createFileRoute } from "@tanstack/react-router";

// Executor agendado dos Fluxos de E-mail (pg_cron a cada 10 min). Exige o token privado guardado no banco;
// sem ele nada roda. A resposta traz só contagens, nunca conteúdo de e-mails.
export const Route = createFileRoute("/api/public/jobs/email-flows")({ server: { handlers: {
  POST: async ({ request }) => {
    const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!bearer) return Response.json({ error: "Unauthorized" }, { status: 401 });
    try {
      const { runEmailFlowsScheduled } = await import("@/lib/email-flows.server");
      const result = await runEmailFlowsScheduled(bearer);
      if (!result) return Response.json({ error: "Unauthorized" }, { status: 401 });
      const { notes: _notes, ...counts } = result;
      return Response.json(counts);
    } catch {
      console.error("email_flows_job_failed");
      return Response.json({ error: "Processing unavailable" }, { status: 503 });
    }
  },
} } });
