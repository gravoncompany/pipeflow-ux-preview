import { createFileRoute } from "@tanstack/react-router";

// Executor agendado da qualificação automática (pg_cron a cada 5 min). Exige o token privado guardado no banco.
// A resposta traz só contagens, nunca conteúdo de conversas.
export const Route = createFileRoute("/api/public/jobs/lead-qualification")({ server: { handlers: {
  POST: async ({ request }) => {
    const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!bearer) return Response.json({ error: "Unauthorized" }, { status: 401 });
    try {
      const { runLeadQualificationScheduled } = await import("@/lib/lead-ai-qualification.server");
      const result = await runLeadQualificationScheduled(bearer);
      if (!result) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return Response.json(result);
    } catch {
      console.error("lead_qualification_job_failed");
      return Response.json({ error: "Processing unavailable" }, { status: 503 });
    }
  },
} } });
