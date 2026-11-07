import { createFileRoute } from '@tanstack/react-router';
export const Route = createFileRoute('/api/public/email-click/$token')({
  server: { handlers: {
    OPTIONS: () => new Response(null, { status: 204, headers: { 'X-Pipeflow-Click-Tracking': 'v1', 'Cache-Control': 'no-store' } }),
    GET: async ({ request, params }) => { const { redirectEmailClick } = await import('@/lib/outbound-clicks.server'); return redirectEmailClick(request, params.token); },
    HEAD: async ({ request, params }) => { const { redirectEmailClick } = await import('@/lib/outbound-clicks.server'); return redirectEmailClick(request, params.token, false); },
  } },
});