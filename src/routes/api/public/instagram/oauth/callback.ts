import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/public/instagram/oauth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { instagramOAuthCallback } = await import("@/lib/instagram-oauth.server");
        return instagramOAuthCallback(request);
      },
    },
  },
});
