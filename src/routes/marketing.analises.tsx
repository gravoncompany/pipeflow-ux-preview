import { createFileRoute } from "@tanstack/react-router";
import { MarketingAnalysisPage } from "@/components/crm/marketing/MarketingAnalysis";
import { parseDashboardSearch } from "@/lib/dashboard-search";

export const Route = createFileRoute("/marketing/analises")({
  validateSearch: parseDashboardSearch,
  head: () => ({ meta: [
    { title: "Marketing · Análises IA — PipeFlow CRM" },
    { name: "description", content: "A Pipeflow IA identifica gargalos, campanhas caras, melhores fontes e oportunidades com números reais." },
    { property: "og:title", content: "Marketing · Análises IA — PipeFlow CRM" },
    { property: "og:description", content: "Recomendações práticas justificadas pelos indicadores, sem conclusões com dados insuficientes." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: function Page() { return <MarketingAnalysisPage search={Route.useSearch()} />; },
});
