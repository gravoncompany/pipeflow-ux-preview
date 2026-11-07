import { createFileRoute } from "@tanstack/react-router";
import { MarketingSourcesPage } from "@/components/crm/marketing/MarketingSources";
import { parseDashboardSearch } from "@/lib/dashboard-search";

export const Route = createFileRoute("/marketing/fontes")({
  validateSearch: parseDashboardSearch,
  head: () => ({ meta: [
    { title: "Marketing · Fontes de Aquisição — PipeFlow CRM" },
    { name: "description", content: "Origem dos leads por UTMs preservadas: quantos cada fonte gerou, qualificou e converteu em clientes." },
    { property: "og:title", content: "Marketing · Fontes de Aquisição — PipeFlow CRM" },
    { property: "og:description", content: "Leads, qualificados, reuniões e clientes por fonte de aquisição." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: function Page() { return <MarketingSourcesPage search={Route.useSearch()} />; },
});
