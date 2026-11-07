import type { ReactNode } from "react";
import { Search, ClipboardCheck, Send } from "lucide-react";
import { AreaLayout } from "./AreaLayout";

/** Fontes de busca da etapa 1 (cada uma mantém o seu endereço). */
export const B2B_SOURCES = [
  { to: "/prospeccao-b2b", label: "Google Maps", hint: "Empresas por segmento e cidade" },
  { to: "/prospeccao-b2b/instagram", label: "Instagram", hint: "Perfis por hashtag ou nome" },
  { to: "/prospeccao-b2b/receita-federal", label: "Receita Federal", hint: "CNPJ por CNAE, cidade e porte" },
  { to: "/prospeccao-b2b/importar-listas", label: "Importar lista", hint: "Planilha ou lista de e-mails" },
] as const;

/** O menu mostra o fluxo em 3 etapas; as fontes viram abas dentro da etapa 1. */
export const B2B_GROUPS = [{ label: "Etapas", items: [
  { to: "/prospeccao-b2b", label: "1 · Encontrar empresas", icon: Search, also: ["/prospeccao-b2b/instagram", "/prospeccao-b2b/receita-federal", "/prospeccao-b2b/importar-listas"] },
  { to: "/prospeccao-b2b/revisar", label: "2 · Revisar e adicionar", icon: ClipboardCheck },
  { to: "/prospeccao-b2b/primeiro-contato", label: "3 · Primeiro contato", icon: Send },
] }] as const;

export function B2bLayout({ children }: { children: ReactNode }) {
  return <AreaLayout title="Prospecção B2B" groups={B2B_GROUPS}>{children}</AreaLayout>;
}
