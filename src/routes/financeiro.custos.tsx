import { createFileRoute } from "@tanstack/react-router";

// O conteúdo é desenhado pelo layout /financeiro (FinanceManagement), que lê a tela pela URL.
export const Route = createFileRoute("/financeiro/custos")({
  head: () => ({
    meta: [
      { title: "Custos · Financeiro — PipeFlow CRM" },
      { name: "description", content: "Despesas, ferramentas e investimento em tráfego pago da Gravon." },
      { property: "og:title", content: "Custos · Financeiro — PipeFlow CRM" },
      { property: "og:description", content: "Despesas, ferramentas e investimento em tráfego pago da Gravon." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => null,
});
