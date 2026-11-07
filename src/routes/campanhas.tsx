import { createFileRoute } from "@tanstack/react-router";
import { CampaignPage } from "@/components/crm/CampaignPage";

export const Route = createFileRoute("/campanhas")({
  head: () => ({ meta: [
    { title: "Campanhas de E-mail — PipeFlow CRM" },
    { name: "description", content: "Prepare, revise e agende campanhas de e-mail marketing por lead, com acesso aos Fluxos de E-mail." },
    { property: "og:title", content: "Campanhas de E-mail — PipeFlow CRM" },
    { property: "og:description", content: "Destinatários revisados, envio pela Brevo e caminho direto para os Fluxos de E-mail." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: () => <CampaignPage channel="email" />,
});
