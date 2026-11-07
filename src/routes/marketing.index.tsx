import { createFileRoute } from "@tanstack/react-router";
import { MarketingOverviewPage } from "@/components/crm/marketing/MarketingOverview";
import { parseDashboardSearch } from "@/lib/dashboard-search";

export const Route = createFileRoute("/marketing/")({
  validateSearch: parseDashboardSearch,
  head: () => ({ meta: [
    { title: "Marketing · Visão Geral — PipeFlow CRM" },
    { name: "description", content: "Investimento em anúncios, geração de leads, qualificação e vendas consolidados do Google Ads e Meta Ads." },
    { property: "og:title", content: "Marketing · Visão Geral — PipeFlow CRM" },
    { property: "og:description", content: "Indicadores reais de marketing e vendas com períodos e comparação entre plataformas." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: function Page() { return <MarketingOverviewPage search={Route.useSearch()} />; },
});
