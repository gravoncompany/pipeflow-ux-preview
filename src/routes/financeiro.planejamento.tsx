import { createFileRoute } from "@tanstack/react-router";

// O conteúdo é desenhado pelo layout /financeiro (FinanceManagement), que lê a tela pela URL.
export const Route = createFileRoute("/financeiro/planejamento")({
  head: () => ({
    meta: [
      { title: "Planejamento · Financeiro — PipeFlow CRM" },
      { name: "description", content: "Plano de crescimento e reservas financeiras da Gravon." },
      { property: "og:title", content: "Planejamento · Financeiro — PipeFlow CRM" },
      { property: "og:description", content: "Plano de crescimento e reservas financeiras da Gravon." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => null,
});
