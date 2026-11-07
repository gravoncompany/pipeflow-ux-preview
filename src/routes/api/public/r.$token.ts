import { createFileRoute } from "@tanstack/react-router";

/**
 * Link rastreado dos e-mails das Automações. Público por natureza (o destinatário clica):
 * aceita só o identificador aleatório de 32 caracteres, registra o clique e redireciona
 * para a landing page configurada. Não devolve nenhum dado do card.
 */
export const Route = createFileRoute("/api/public/r/$token")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const { clickClassification } = await import('@/lib/outbound-clicks');
        if (clickClassification(request.headers) !== 'human') {
          const { b2bDb } = await import('@/lib/b2b-prospecting.server');
          const { landingWithUtms, safeLandingUrl } = await import('@/lib/automations');
          const token = String(params.token ?? '').toLowerCase();
          if (!/^[a-f0-9]{32}$/.test(token)) return new Response('Link indisponível.', { status: 404 });
          const db = await b2bDb();
          const run = await db.from('crm_automation_runs').select('automation_id').eq('token', token).maybeSingle();
          const a = run.data ? await db.from('crm_automations').select('landing_url,slug').eq('id', run.data.automation_id).single() : null;
          if (!a?.data?.landing_url || !safeLandingUrl(a.data.landing_url)) return new Response('Link indisponível.', { status: 404 });
          return new Response(null, { status: 302, headers: { Location: landingWithUtms(a.data.landing_url, a.data.slug, token), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
        }
        const { recordAutomationClick } = await import("@/lib/automations.server");
        const url = await recordAutomationClick(String(params.token ?? "").toLowerCase()).catch(() => null);
        if (!url) return new Response("Link indisponível.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
        return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
      },
    },
  },
});
