import { Activity, BellRing, History, Instagram, MessageSquareQuote, Plug, Search, Send, LayoutGrid } from "lucide-react";

/** Grupos do menu branco de Configurações (mesmo padrão do menu interno da Pipeflow IA). */
export const SETTINGS_GROUPS = [
  { label: "Início", items: [
    { to: "/configuracoes", label: "Todas as configurações", icon: LayoutGrid },
  ] },
  { label: "API e Integrações", items: [
    { to: "/configuracoes/integracoes/api", label: "API e Integrações", icon: Plug },
  ] },
  { label: "Avisos", items: [
    { to: "/configuracoes/notificacoes", label: "Notificações", icon: BellRing },
  ] },
  { label: "Meta", items: [
    { to: "/configuracoes/integracoes/meta", label: "API de Conversões", icon: Activity },
    { to: "/configuracoes/integracoes/meta/historico", label: "Histórico de Conversões", icon: History },
  ] },
  { label: "Instagram", items: [
    { to: "/configuracoes/integracoes/instagram", label: "Conexão da conta", icon: Instagram },
    { to: "/configuracoes/integracoes/instagram-pesquisa", label: "Pesquisa de empresas", icon: Search },
  ] },
  { label: "WhatsApp", items: [
    { to: "/configuracoes/whatsapp", label: "Mensagens de Referência", icon: MessageSquareQuote },
  ] },
  { label: "Automações", items: [
    { to: "/configuracoes/automacoes/primeiro-contato", label: "Primeiro Contato", icon: Send },
  ] },
] as const;
