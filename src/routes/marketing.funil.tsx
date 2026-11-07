import { createFileRoute } from "@tanstack/react-router";
import { MarketingFunnelPage } from "@/components/crm/marketing/MarketingFunnel";
import { parseDashboardSearch } from "@/lib/dashboard-search";

export const Route = createFileRoute("/marketing/funil")({
  validateSearch: parseDashboardSearch,
  head: () => ({ meta: [
    { title: "Marketing · Funil de Conversão — PipeFlow CRM" },
    { name: "description", content: "Etapas reais do CRM com taxas de conversão, leads perdidos e conversão por fonte de aquisição." },
    { property: "og:title", content: "Marketing · Funil de Conversão — PipeFlow CRM" },
    { property: "og:description", content: "Lead, contato, qualificado, reunião e fechado com gargalos identificados." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: function Page() { return <MarketingFunnelPage search={Route.useSearch()} />; },
});
