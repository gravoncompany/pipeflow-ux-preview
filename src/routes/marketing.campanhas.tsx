import { createFileRoute } from "@tanstack/react-router";
import { MarketingCampaignsPage } from "@/components/crm/marketing/MarketingCampaigns";
import { parseDashboardSearch } from "@/lib/dashboard-search";

export const Route = createFileRoute("/marketing/campanhas")({
  validateSearch: parseDashboardSearch,
  head: () => ({ meta: [
    { title: "Marketing · Campanhas — PipeFlow CRM" },
    { name: "description", content: "Desempenho das campanhas de Google Ads e Meta Ads com filtros por plataforma, campanha e período." },
    { property: "og:title", content: "Marketing · Campanhas — PipeFlow CRM" },
    { property: "og:description", content: "Investimento, impressões, cliques, conversões e custo por resultado das campanhas." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: function Page() { return <MarketingCampaignsPage search={Route.useSearch()} />; },
});
