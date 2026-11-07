import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AgendaWorkspace } from "@/components/crm/agenda/AgendaWorkspace";

export const Route = createFileRoute("/agenda")({
  validateSearch: (search: Record<string, unknown>): { reuniao?: string } => ({
    reuniao: typeof search.reuniao === "string" && /^[0-9a-f-]{36}$/i.test(search.reuniao) ? search.reuniao : undefined,
  }),
  head: () => ({ meta: [
    { title: "Agenda · Calendário — PipeFlow CRM" },
    { name: "description", content: "Calendário semanal das reuniões comerciais da Gravon, integrado ao Google Agenda." },
    { property: "og:title", content: "Agenda · Calendário — PipeFlow CRM" },
    { property: "og:description", content: "Reuniões no dia e horário certos, com agendamento e disponibilidade." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: AgendaCalendarPage,
});

function AgendaCalendarPage() {
  const { reuniao } = Route.useSearch();
  const navigate = useNavigate({ from: "/agenda" });
  return <AgendaWorkspace view="calendar" openMeetingId={reuniao} onMeetingOpened={() => void navigate({ search: {}, replace: true })} />;
}
