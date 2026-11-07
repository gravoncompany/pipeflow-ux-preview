import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

export const Route = createFileRoute("/api/public/jobs/portal-ads-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.PORTAL_ADS_SYNC_SECRET;
        const received = request.headers.get("authorization") ?? "";
        const expected = secret ? `Bearer ${secret}` : "";
        let diff = received.length ^ expected.length;
        for (let i = 0; i < expected.length; i++)
          diff |= received.charCodeAt(i) ^ expected.charCodeAt(i);
        if (!secret || diff !== 0) return Response.json({ error: "Unauthorized" }, { status: 401 });
        if (
          !z
            .object({})
            .strict()
            .safeParse(await request.json().catch(() => null)).success
        )
          return Response.json({ error: "Invalid input" }, { status: 400 });
        try {
          const { runScheduledAdsSync } = await import("@/lib/portal-ads.server");
          await runScheduledAdsSync();
          return Response.json({ ok: true });
        } catch {
          console.warn("portal_ads_scheduled_failed");
          return Response.json({ error: "Sync unavailable" }, { status: 503 });
        }
      },
    },
  },
});
