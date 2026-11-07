import { createFileRoute } from "@tanstack/react-router";

// O conteúdo é desenhado pelo layout /financeiro (FinanceManagement), que lê a tela pela URL.
export const Route = createFileRoute("/financeiro/analise")({
  head: () => ({
    meta: [
      { title: "Análise · Financeiro — PipeFlow CRM" },
      { name: "description", content: "DRE gerencial e relatórios financeiros da Gravon." },
      { property: "og:title", content: "Análise · Financeiro — PipeFlow CRM" },
      { property: "og:description", content: "DRE gerencial e relatórios financeiros da Gravon." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => null,
});
