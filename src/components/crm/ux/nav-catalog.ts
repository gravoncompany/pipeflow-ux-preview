// Catálogo único das telas do CRM para a busca global (Ctrl+K) e para o breadcrumb.
// Reaproveita os menus existentes; nada aqui concede acesso — cada tela mantém o próprio portão.
import { MAIN_NAV_ITEMS, mainAreaActive } from "../crm-nav";
import { FINANCE_SECTIONS } from "../finance-nav";
import { MANAGEMENT_GROUP } from "../management-nav";
import { SETTINGS_GROUPS } from "../settings-nav";
import { MARKETING_GROUPS } from "../marketing/marketing-nav";

export type CatalogPage = { to: string; label: string; area: string; keywords?: string };

const ATENDIMENTO = [
  { to: "/whatsapp", label: "Conversas" }, { to: "/clientes", label: "Clientes" }, { to: "/pos-venda", label: "Gestão de Clientes" },
  { to: "/pos-venda/saude", label: "Saúde dos Clientes" }, { to: "/pos-venda/risco", label: "Clientes em Risco" }, { to: "/pos-venda/renovacoes", label: "Renovações" },
  { to: "/pos-venda/indicadores", label: "Indicadores de CS" }, { to: "/pos-venda/pontuacao", label: "Pontuação" },
  { to: "/tarefas", label: "Tarefas" }, { to: "/contatos", label: "Todos os contatos" }, { to: "/agenda", label: "Calendário" }, { to: "/agenda/reunioes", label: "Lista de reuniões" },
];
const B2B = [
  { to: "/prospeccao-b2b", label: "Google Maps" }, { to: "/prospeccao-b2b/instagram", label: "Instagram" }, { to: "/prospeccao-b2b/receita-federal", label: "Receita Federal" },
  { to: "/prospeccao-b2b/importar-listas", label: "Importar Listas" }, { to: "/prospeccao-b2b/revisar", label: "Revisar Selecionadas" }, { to: "/prospeccao-b2b/primeiro-contato", label: "Primeiro Contato" },
];
const CAMPANHAS = [{ to: "/campanhas", label: "Campanhas de E-mail" }, { to: "/campanhas/whatsapp", label: "Campanhas de WhatsApp" }, { to: "/fluxos-email", label: "Fluxos de E-mail" }, { to: "/automacoes", label: "Automações" }];
const OUTRAS = [
  { to: "/dashboard", label: "Visão Geral", area: "Início" }, { to: "/dashboard/insights", label: "Insights", area: "Visão Geral" },
  { to: "/", label: "Pipeline", area: "CRM", keywords: "funil kanban leads" }, { to: "/funil", label: "Análise de Funis", area: "CRM" },
  { to: "/gravon-ai", label: "Pipeflow IA", area: "IA" }, { to: "/conhecimento", label: "Conhecimento", area: "IA" },
  { to: "/projetos/em-andamento", label: "Projetos em andamento", area: "Gestão" }, { to: "/projetos/concluidas", label: "Projetos concluídos", area: "Gestão" },
  { to: "/configuracoes", label: "Todas as configurações", area: "Configurações" },
  { to: "/configuracoes/integracoes/google-ads", label: "Google Ads", area: "Configurações" }, { to: "/configuracoes/integracoes/meta-ads", label: "Meta Ads", area: "Configurações" },
  { to: "/configuracoes/integracoes/hypercash", label: "HyperCash", area: "Configurações" }, { to: "/configuracoes/integracoes/outras", label: "Outras integrações", area: "Configurações" },
];

export const PAGE_CATALOG: CatalogPage[] = (() => {
  const list: CatalogPage[] = [
    ...OUTRAS,
    ...ATENDIMENTO.map((p) => ({ ...p, area: "Atendimento" })),
    ...B2B.map((p) => ({ ...p, area: "Prospecção B2B" })),
    ...CAMPANHAS.map((p) => ({ ...p, area: "Campanhas" })),
    ...MARKETING_GROUPS.flatMap((g) => g.items.map((i) => ({ to: i.to, label: i.label, area: "Marketing" }))),
    ...MANAGEMENT_GROUP.items.map((i) => ({ to: i.to, label: i.label, area: "Gestão" })),
    ...FINANCE_SECTIONS.map((s) => ({ to: s.to, label: s.label, area: "Financeiro", keywords: `${s.description} ${s.tabs.map((t) => t[1]).join(" ")}` })),
    ...SETTINGS_GROUPS.flatMap((g) => g.items.map((i) => ({ to: i.to, label: i.label, area: "Configurações", keywords: g.label }))),
  ];
  const seen = new Set<string>();
  return list.filter((p) => (seen.has(`${p.to}|${p.label}`) ? false : (seen.add(`${p.to}|${p.label}`), true)));
})();

const normalize = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);

/** Trilha "Área › Seção › Tela" para o caminho atual (vazia quando a tela não é conhecida). */
export function breadcrumbFor(pathname: string): { label: string; to?: string }[] {
  const p = normalize(pathname);
  const main = MAIN_NAV_ITEMS.find((i) => mainAreaActive(i as never, p));
  const trail: { label: string; to?: string }[] = main ? [{ label: main.label, to: main.to }] : [];
  if (p.startsWith("/financeiro")) trail.push({ label: "Financeiro", to: "/financeiro" });
  if (p.startsWith("/clientes/")) {
    trail.push({ label: "Clientes", to: "/clientes" }, { label: "Ficha do cliente" });
    return trail;
  }
  const page = [...PAGE_CATALOG].sort((a, b) => b.to.length - a.to.length).find((x) => x.to === p) ?? [...PAGE_CATALOG].sort((a, b) => b.to.length - a.to.length).find((x) => x.to !== "/" && p.startsWith(`${x.to}/`));
  if (page && trail.at(-1)?.label !== page.label) trail.push({ label: page.label });
  return trail;
}
