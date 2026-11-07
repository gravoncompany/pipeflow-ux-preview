import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/gravon-ai")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { streamGravonChat } = await import("@/lib/ai/gravon-chat.server");
        return streamGravonChat(request);
      },
    },
  },
});
