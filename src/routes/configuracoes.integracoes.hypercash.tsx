import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { SettingsLayout } from "@/components/crm/SettingsLayout";
import { HypercashPanel } from "@/components/crm/HypercashPanel";
import logo from "@/assets/hypercash-logo.png.asset.json";
export const Route = createFileRoute("/configuracoes/integracoes/hypercash")({
  head: () => ({ meta: [
    { title: "HyperCash · Integrações — PipeFlow CRM" }, { name: "description", content: "Configurações da integração HyperCash: credenciais, teste, sincronização e cobranças." },
    { property: "og:title", content: "HyperCash · Integrações — PipeFlow CRM" }, { property: "og:description", content: "Configurações da integração HyperCash: credenciais, teste, sincronização e cobranças." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: HypercashPage,
});
function HypercashPage() {
  return <SettingsLayout><div className="mx-auto max-w-5xl px-4 py-8 md:px-8">
    <Link to="/configuracoes/integracoes/api" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"><ArrowLeft className="size-4" />Integrações Externas</Link>
    <div className="mb-6 flex items-center gap-3 border-b pb-5"><img src={logo.url} alt="Logotipo HyperCash" className="size-10 rounded" /><h1 className="text-2xl font-semibold">HyperCash</h1></div>
    <HypercashPanel />
  </div></SettingsLayout>;
}
