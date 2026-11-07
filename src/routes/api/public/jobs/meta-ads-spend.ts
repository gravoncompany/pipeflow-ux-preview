import { createFileRoute } from "@tanstack/react-router";

// Importação diária do investimento da Meta (pg_cron 1x/dia). Exige o token privado guardado no banco; responde só contagens.
export const Route = createFileRoute("/api/public/jobs/meta-ads-spend")({ server: { handlers: {
  POST: async ({ request }) => {
    const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!bearer) return Response.json({ error: "Unauthorized" }, { status: 401 });
    try {
      const { runMetaAdsSpendScheduled } = await import("@/lib/meta-ads-spend.server");
      const result = await runMetaAdsSpendScheduled(bearer);
      if (!result) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return Response.json(result);
    } catch {
      console.error("meta_ads_spend_job_failed");
      return Response.json({ error: "Processing unavailable" }, { status: 503 });
    }
  },
} } });
