import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/public/instagram/webhook")({ server: { handlers: {
  GET: async ({ request }) => { const { instagramWebhookGet } = await import("@/lib/instagram.server"); return instagramWebhookGet(request); },
  POST: async ({ request }) => { const { instagramWebhookPost } = await import("@/lib/instagram.server"); return instagramWebhookPost(request); },
} } });