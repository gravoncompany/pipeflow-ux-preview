import { createFileRoute } from "@tanstack/react-router";
import { PORTAL_APPROVAL_ORIGIN } from "@/lib/portal-whatsapp-notify";
import { handlePortalNotification } from "@/lib/portal-whatsapp-notify-handler.server";

export const Route = createFileRoute("/api/public/portal/whatsapp-notify")({
  server: {
    handlers: {
      POST: async ({ request }) => handlePortalNotification(request, {
        token: process.env.PORTAL_WHATSAPP_SERVICE_TOKEN,
        signingSecret: process.env.PORTAL_WHATSAPP_HMAC_SECRET,
        approvalOrigin: process.env.PORTAL_WHATSAPP_APPROVAL_ORIGIN || PORTAL_APPROVAL_ORIGIN,
        enabled: process.env.PORTAL_WHATSAPP_NOTIFY_ENABLED === "true",
      }, async () => (await import("@/lib/portal-whatsapp-notify.server")).liveNotifyDependencies()),
    },
  },
});