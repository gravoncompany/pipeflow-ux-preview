import { createFileRoute } from "@tanstack/react-router";

// O conteúdo é desenhado pelo layout /financeiro (FinanceManagement), que lê a tela pela URL.
export const Route = createFileRoute("/financeiro/pessoal")({
  head: () => ({
    meta: [
      { title: "Finanças Pessoais · Financeiro — PipeFlow CRM" },
      { name: "description", content: "Despesas e reservas pessoais do administrador, separadas das finanças da Gravon." },
      { property: "og:title", content: "Finanças Pessoais · Financeiro — PipeFlow CRM" },
      { property: "og:description", content: "Despesas e reservas pessoais do administrador, separadas das finanças da Gravon." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => null,
});
