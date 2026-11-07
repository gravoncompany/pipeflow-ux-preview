import { createFileRoute } from "@tanstack/react-router";
import { AgendaWorkspace } from "@/components/crm/agenda/AgendaWorkspace";

export const Route = createFileRoute("/agenda_/reunioes")({
  head: () => ({ meta: [
    { title: "Agenda · Lista de reuniões — PipeFlow CRM" },
    { name: "description", content: "Reuniões agendadas e canceladas, com reagendamento e cancelamento." },
    { property: "og:title", content: "Agenda · Lista de reuniões — PipeFlow CRM" },
    { property: "og:description", content: "Todas as reuniões comerciais em lista, com acesso aos detalhes." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: () => <AgendaWorkspace view="list" />,
});
