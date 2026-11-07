import { createFileRoute } from "@tanstack/react-router";
import { AdsPlatformPage } from "@/components/crm/integrations/AdsPlatformPage";
import logo from "@/assets/google-ads-logo.svg.asset.json";
export const Route = createFileRoute("/configuracoes/integracoes/google-ads")({
  head: () => ({ meta: [
    { title: "Google Ads · Integrações — PipeFlow CRM" }, { name: "description", content: "Conexão somente leitura com a Google Ads API: contas autorizadas, teste e métricas." },
    { property: "og:title", content: "Google Ads · Integrações — PipeFlow CRM" }, { property: "og:description", content: "Conexão somente leitura com a Google Ads API: contas autorizadas, teste e métricas." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: () => <AdsPlatformPage platform="google_ads" logo={logo.url} />,
});
