import { createFileRoute } from "@tanstack/react-router";
import { AdsPlatformPage } from "@/components/crm/integrations/AdsPlatformPage";
import logo from "@/assets/meta-logo.png.asset.json";
export const Route = createFileRoute("/configuracoes/integracoes/meta-ads")({
  head: () => ({ meta: [
    { title: "Meta Ads · Integrações — PipeFlow CRM" }, { name: "description", content: "Conexão somente leitura com a Meta Marketing API: contas autorizadas, teste e métricas." },
    { property: "og:title", content: "Meta Ads · Integrações — PipeFlow CRM" }, { property: "og:description", content: "Conexão somente leitura com a Meta Marketing API: contas autorizadas, teste e métricas." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: () => <AdsPlatformPage platform="meta_ads" logo={logo.url} />,
});
