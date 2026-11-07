import { createFileRoute } from "@tanstack/react-router";
import { CustomerSuccessWorkspace } from "@/components/crm/CustomerSuccessWorkspace";
export const Route = createFileRoute("/pos-venda/")({
  head: () => ({ meta: [
    { title: "Gestão de Clientes — Pipeflow" }, { name: "description", content: "Gestão operacional da Gravon: contas, saúde, contratos e acompanhamento dos clientes cadastrados." },
    { property: "og:title", content: "Gestão de Clientes — Pipeflow" }, { property: "og:description", content: "Central de Customer Success com status independentes e análises revisáveis." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }), component: () => <CustomerSuccessWorkspace />,
});