import { createFileRoute } from "@tanstack/react-router";

// O conteúdo é desenhado pelo layout /financeiro (FinanceManagement), que lê a tela pela URL.
export const Route = createFileRoute("/financeiro/movimentacoes")({
  head: () => ({
    meta: [
      { title: "Movimentações · Financeiro — PipeFlow CRM" },
      { name: "description", content: "Extrato do Nubank, fluxo de caixa e contas a pagar e a receber da Gravon." },
      { property: "og:title", content: "Movimentações · Financeiro — PipeFlow CRM" },
      { property: "og:description", content: "Extrato do Nubank, fluxo de caixa e contas a pagar e a receber da Gravon." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => null,
});
