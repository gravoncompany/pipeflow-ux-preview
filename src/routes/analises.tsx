import { createFileRoute, redirect } from "@tanstack/react-router";

// Análise de Conversas now lives inside Pipeflow IA; the old address keeps working.
export const Route = createFileRoute("/analises")({
  beforeLoad: () => {
    throw redirect({ to: "/gravon-ai", search: { tab: "analises" } });
  },
});
