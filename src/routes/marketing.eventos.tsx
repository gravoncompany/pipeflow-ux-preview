import { createFileRoute } from "@tanstack/react-router";
import { MarketingEventsPage } from "@/components/crm/marketing/MarketingEvents";
import { parseDashboardSearch } from "@/lib/dashboard-search";

export const Route = createFileRoute("/marketing/eventos")({
  validateSearch: parseDashboardSearch,
  head: () => ({ meta: [
    { title: "Marketing · Eventos e Conversões — PipeFlow CRM" },
    { name: "description", content: "Mapeamento etapa do CRM para eventos Meta e Google, monitoramento de envios e reprocessamento controlado." },
    { property: "og:title", content: "Marketing · Eventos e Conversões — PipeFlow CRM" },
    { property: "og:description", content: "Eventos elegíveis, enviados, aceitos e com erro, sem duplicar conversões." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: function Page() { return <MarketingEventsPage search={Route.useSearch()} />; },
});
