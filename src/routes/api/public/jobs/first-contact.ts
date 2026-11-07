import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/public/jobs/first-contact")({ server: { handlers: {
  POST: async ({ request }) => {
    try { const { firstContactJob } = await import("@/lib/first-contact.server"); return await firstContactJob(request); }
    catch { console.error("first_contact_job_failed"); return Response.json({ error: "Processing unavailable" }, { status: 503 }); }
  },
} } });