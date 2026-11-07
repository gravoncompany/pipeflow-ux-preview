export type MainNavItem = { to: string; label: string; match?: readonly string[] };

export const MAIN_NAV_ITEMS = [
  { to: "/dashboard", label: "Visão Geral", icon: "dashboard" },
  { to: "/", label: "CRM", icon: "crm", match: ["/", "/funil"] },
  { to: "/prospeccao-b2b", label: "Prospecção B2B", icon: "prospecting" },
  { to: "/whatsapp", label: "Atendimento", icon: "service", match: ["/whatsapp", "/clientes", "/pos-venda", "/tarefas", "/contatos", "/agenda"] },
  { to: "/campanhas", label: "Campanhas", icon: "campaigns", match: ["/campanhas", "/fluxos-email", "/automacoes"] },
  { to: "/marketing", label: "Marketing", icon: "marketing" },
  { to: "/metas", label: "Gestão", icon: "management", match: ["/metas", "/financeiro", "/projetos", "/gravon-universe"] },
  { to: "/gravon-ai", label: "Pipeflow IA", icon: "ai" },
  { to: "/configuracoes", label: "Configurações", icon: "settings", match: ["/configuracoes"] },
] as const;

const normalize = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);

/** Uma área do menu principal fica ativa na própria tela e em todas as telas internas dela. */
export function mainAreaActive(item: MainNavItem, pathname: string) {
  const p = normalize(pathname);
  const prefixes = item.match ?? [item.to];
  return prefixes.some((pre) => (pre === "/" ? p === "/" : p === pre || p.startsWith(`${pre}/`)));
}
