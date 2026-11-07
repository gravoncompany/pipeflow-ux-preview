import { createFileRoute } from "@tanstack/react-router";
import { CustomerSuccessWorkspace } from "@/components/crm/CustomerSuccessWorkspace";
export const Route = createFileRoute("/pos-venda/saude")({
  head: () => ({ meta: [
    { title: "Central de Saúde dos Clientes — Pipeflow" }, { name: "description", content: "Avaliações de satisfação, risco e evidências das conversas da Gravon com seus próprios clientes." },
    { property: "og:title", content: "Saúde dos Clientes — Pipeflow" }, { property: "og:description", content: "Diagnósticos e histórico de Customer Success da Gravon." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }), component: () => <CustomerSuccessWorkspace view="saude" />,
});