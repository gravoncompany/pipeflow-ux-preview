import { createFileRoute } from "@tanstack/react-router";
import { WhatsAppCampaignStudio } from "@/components/crm/whatsapp-campaign/WhatsAppCampaignStudio";

export const Route = createFileRoute("/campanhas_/whatsapp")({
  head: () => ({ meta: [
    { title: "Campanhas de WhatsApp — PipeFlow CRM" },
    { name: "description", content: "Campanhas de WhatsApp para contatos ou grupos, com envio gradual e acompanhamento." },
    { property: "og:title", content: "Campanhas de WhatsApp — PipeFlow CRM" },
    { property: "og:description", content: "Campanhas de WhatsApp separadas do e-mail, com status do canal e destinatários revisados." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: WhatsAppCampaignStudio,
});
