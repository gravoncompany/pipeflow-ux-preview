import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CrmBoard } from "@/components/crm/CrmBoard";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { lead?: string; aba?: "funil" } => ({
    lead: typeof search.lead === "string" && /^[0-9a-f-]{36}$/i.test(search.lead) ? search.lead : undefined,
    aba: search.aba === "funil" ? "funil" : undefined,
  }),
  head: () => ({
    meta: [
      { title: "PipeFlow CRM — Gestão profissional de leads" },
      { name: "description", content: "CRM Kanban moderno para gestão de leads, oportunidades e pipeline comercial." },
      { property: "og:title", content: "PipeFlow CRM" },
      { property: "og:description", content: "CRM Kanban para times comerciais." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Index() {
  const { lead, aba } = Route.useSearch();
  const navigate = useNavigate({ from: "/" });
  return (
    <CrmBoard
      openLeadId={lead}
      onLeadOpened={() => void navigate({ to: "/", search: (prev) => ({ ...prev, lead: undefined }), replace: true })}
      analysisView={aba === "funil"}
      onAnalysisViewChange={(v) => void navigate({ to: "/", search: v ? { aba: "funil" } : {}, replace: true })}
    />
  );
}
