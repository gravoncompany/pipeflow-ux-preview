// Telas do Financeiro (submenu branco). Cada tela agrupa as abas que já existiam; o estado do
// Financeiro fica no layout /financeiro, então trocar de tela não recarrega nem perde filtros.
export type FinanceSection = "overview" | "movimentacoes" | "recebimentos" | "custos" | "planejamento" | "analise" | "pessoal";

export const FINANCE_SECTIONS: readonly {
  key: FinanceSection;
  to: string;
  label: string;
  description: string;
  tabs: readonly (readonly [string, string])[];
}[] = [
  { key: "overview", to: "/financeiro", label: "Visão geral", description: "Banco, faturamento e resultado do período", tabs: [["overview", "Visão geral"]] },
  { key: "movimentacoes", to: "/financeiro/movimentacoes", label: "Movimentações", description: "Extrato do banco, caixa e contas", tabs: [["bank", "Extrato bancário"], ["cash", "Fluxo de Caixa"], ["payable", "Contas a Pagar"], ["receivable", "Contas a Receber"]] },
  { key: "recebimentos", to: "/financeiro/recebimentos", label: "Controle de Recebimentos", description: "Cobranças e recebimentos por cliente", tabs: [["receipts", "Controle de Recebimentos"]] },
  { key: "custos", to: "/financeiro/custos", label: "Custos", description: "Despesas, ferramentas e tráfego pago", tabs: [["expenses", "Despesas e Ferramentas"], ["traffic", "Tráfego pago"]] },
  { key: "planejamento", to: "/financeiro/planejamento", label: "Planejamento", description: "Metas de crescimento e reservas", tabs: [["growth", "Plano de Crescimento"], ["reserves", "Reservas Financeiras"]] },
  { key: "analise", to: "/financeiro/analise", label: "Análise", description: "DRE gerencial e relatórios", tabs: [["dre", "DRE Gerencial"], ["reports", "Relatórios"]] },
  { key: "pessoal", to: "/financeiro/pessoal", label: "Finanças Pessoais", description: "Despesas e reservas pessoais do administrador, separadas da Gravon", tabs: [["overview", "Visão geral pessoal"], ["expenses", "Despesas pessoais"], ["reserves", "Reserva pessoal"]] },
];

export function financeSection(pathname: string): FinanceSection {
  const p = pathname.replace(/\/+$/, "");
  return FINANCE_SECTIONS.find((s) => s.key !== "overview" && (p === s.to || p.startsWith(`${s.to}/`)))?.key ?? "overview";
}
