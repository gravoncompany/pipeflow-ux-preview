import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Rotina diária (desativada por padrão): exige POLP_TRANSACTIONS_SYNC_SECRET no ambiente e Bearer idêntico.
// Executa somente sincronização incremental de consentimentos já sincronizados; nunca importação inicial/histórica.
export const Route = createFileRoute("/api/public/jobs/polp-transactions-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizedJobRequest } = await import("@/lib/polp-bank-sync.server");
        if (!authorizedJobRequest(request.headers.get("authorization") ?? "", process.env.POLP_TRANSACTIONS_SYNC_SECRET))
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        if (!z.object({}).strict().safeParse(await request.json().catch(() => null)).success)
          return Response.json({ error: "Invalid input" }, { status: 400 });
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { runScheduledPolpSync } = await import("@/lib/polp-bank-sync-runner.server");
          const result = await runScheduledPolpSync(supabaseAdmin as unknown as import("@/lib/polp-bank-sync-runner.server").UntypedDb);
          return Response.json({ ok: true, ...result });
        } catch {
          console.warn("polp_transactions_scheduled_failed");
          return Response.json({ error: "Sync unavailable" }, { status: 503 });
        }
      },
    },
  },
});
