import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LayoutDashboard, Columns3, LogOut, MessageCircle, Bot, Target, Settings, Building2, Send, PanelLeftClose, PanelLeftOpen, Megaphone, Search } from "lucide-react";
import { PipeflowSymbol } from "@/components/brand/PipeflowLogo";
import { clearStoredAccess } from "@/components/crm/CrmAuthGate";
import { WhatsAppStatusBox } from "@/components/crm/WhatsAppConnection";
import { Button } from "@/components/ui/button";
import { useServerFn } from "@tanstack/react-start";
import { logoutCrm } from "@/lib/crm-auth.functions";
import { CrmNotifications } from "./CrmNotifications";
import { ProfileMenu } from "./ProfileMenu";
import { GravonFloatingChat } from "./GravonFloatingChat";
import { mainAreaActive, MAIN_NAV_ITEMS } from "./crm-nav";
import { motion, useReducedMotion } from "motion/react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// Blocos visuais do menu (os mesmos nove itens, na mesma ordem; sem títulos de categoria).
const NAV_SECTIONS = [
  { label: "Operação", items: ["dashboard", "crm", "prospecting", "service"] },
  { label: "Crescimento", items: ["campaigns", "marketing"] },
  { label: "Gestão", items: ["management", "ai", "settings"] },
] as const;
import { CommandPalette, openCommandPalette } from "./ux/CommandPalette";

const ICONS = { dashboard: LayoutDashboard, crm: Columns3, prospecting: Building2, service: MessageCircle, campaigns: Send, marketing: Megaphone, management: Target, ai: Bot, settings: Settings };

const COLLAPSED_KEY = "crm.sidebar.collapsed.v1";


export function CrmSidebar({ onLogout }: { onLogout?: () => void }) {
  const path = useRouterState({ select: (r) => r.location.pathname });
  const logout = useServerFn(logoutCrm);
  const reduce = useReducedMotion();
  // Recolhido só no computador; no celular o menu continua só com ícones, como antes.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try { setCollapsed(window.localStorage.getItem(COLLAPSED_KEY) === "1"); } catch { /* sem armazenamento */ }
  }, []);
  const toggleCollapsed = () => {
    setCollapsed((v) => {
      try { window.localStorage.setItem(COLLAPSED_KEY, v ? "0" : "1"); } catch { /* sem armazenamento */ }
      return !v;
    });
  };
  return (
    <TooltipProvider delayDuration={120}>
    <aside className={`crm-sidebar lab-sidebar sticky top-0 flex h-dvh max-h-dvh self-start w-16 shrink-0 flex-col gap-2 overflow-y-auto overflow-x-hidden border-r border-white/5 p-3 text-sidebar-foreground transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${collapsed ? "md:w-[4.5rem]" : "md:w-60"}`}>
      {/* No Pipeline o sino fica no cabeçalho, ao lado de "Atualizar pipeline". */}
      {path !== "/" && <CrmNotifications />}
      <ProfileMenu />
      {/* Na própria Pipeflow IA o chat já ocupa a tela; o botão flutuante cobriria o envio. */}
      {path !== "/gravon-ai" && <GravonFloatingChat />}
      <div className="mb-3 flex items-center gap-2.5 px-0.5">
        <span className="relative shrink-0">
          <span className="absolute -inset-1 rounded-xl bg-sidebar-primary/40 blur-md" aria-hidden />
          <PipeflowSymbol className="relative h-10 w-10 rounded-xl bg-sidebar-foreground p-1 shadow-lg" />
        </span>
        <span className={`hidden min-w-0 leading-tight ${collapsed ? "" : "md:block"}`}>
          <span className="block font-semibold tracking-tight">PipeFlow</span>
          <span className="block text-[10px] font-medium uppercase tracking-[0.18em] text-sidebar-highlight/80">CRM · Gravon</span>
        </span>
      </div>
      {import.meta.env.VITE_UX_DEMO === "1" && <span role="status" title="Modo demonstração: dados fictícios, nada é salvo" className="-mt-1 mb-1 inline-flex items-center justify-center gap-1.5 rounded-full border border-sidebar-highlight/30 bg-sidebar-primary/20 px-2 py-0.5 text-[10px] font-medium text-sidebar-highlight"><span className="lab-pulse size-1.5 rounded-full bg-sidebar-highlight" /><span className={`hidden ${collapsed ? "" : "md:inline"}`}>Demonstração · dados fictícios</span></span>}
      <CommandPalette />
      <button type="button" onClick={openCommandPalette} title="Buscar (Ctrl+K)" aria-label="Buscar telas e clientes (Ctrl+K)"
        className="group flex h-10 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-2.5 text-sm text-sidebar-foreground/70 transition-all duration-200 hover:border-white/20 hover:bg-white/[0.08] hover:text-sidebar-foreground">
        <Search className="h-[18px] w-[18px] shrink-0 transition-transform duration-300 group-hover:scale-110" />
        <span className={`hidden flex-1 text-left ${collapsed ? "" : "md:inline"}`}>Buscar…</span>
        <kbd className={`hidden rounded-md border border-white/15 bg-white/5 px-1.5 py-0.5 font-sans text-[10px] ${collapsed ? "" : "md:inline"}`}>Ctrl K</kbd>
      </button>
      <nav className="mt-1 flex flex-1 flex-col gap-0.5" aria-label="Menu principal">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} className="mb-1">
            {/* Regra do projeto: sem títulos de categoria no menu principal; só um separador discreto entre blocos. */}
            {section.label !== "Operação" && <span className="mx-3 mb-2 block h-px bg-white/[0.08]" aria-hidden />}
            {MAIN_NAV_ITEMS.filter((it) => (section.items as readonly string[]).includes(it.icon)).map((it) => {
              const active = mainAreaActive(it, path);
              const Icon = ICONS[it.icon];
              return (
                <Tooltip key={it.to}>
                  <TooltipTrigger asChild>
                    <Link to={it.to} aria-label={it.label} aria-current={active ? "page" : undefined}
                      className={`group relative flex h-10 items-center gap-3 rounded-xl px-2.5 text-sm outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-sidebar-ring ${active ? "font-medium text-sidebar-primary-foreground" : "text-sidebar-foreground/70 hover:text-sidebar-foreground"}`}>
                      {active
                        ? <motion.span layoutId="lab-nav-active" className="lab-nav-active absolute inset-0 rounded-xl" transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }} aria-hidden />
                        : <span className="absolute inset-0 rounded-xl bg-white/0 transition-colors duration-200 group-hover:bg-white/[0.06]" aria-hidden />}
                      <Icon className={`relative h-5 w-5 shrink-0 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${active ? "" : "group-hover:-translate-y-px group-hover:scale-110"}`} />
                      <span className={`relative hidden truncate ${collapsed ? "" : "md:inline"}`}>{it.label}</span>
                      {active && !collapsed && <span className="relative ml-auto hidden size-1.5 rounded-full bg-white/90 shadow-[0_0_8px_white] md:block" aria-hidden />}
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right" className={collapsed ? "" : "md:hidden"}>{it.label}</TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        ))}
      </nav>
      {/* Tokens escuros só neste quadro, para manter o contraste sobre o azul-marinho. */}
      <div className={`dark hidden ${collapsed ? "" : "md:block"}`}><WhatsAppStatusBox /></div>
      <div className="mt-1 flex flex-col gap-0.5 border-t border-white/10 pt-2">
        <Button variant="ghost" title={collapsed ? "Expandir menu" : "Recolher menu"} aria-label={collapsed ? "Expandir menu" : "Recolher menu"} aria-pressed={collapsed}
          onClick={toggleCollapsed}
          className="hidden h-10 justify-start gap-3 rounded-xl px-2.5 text-sidebar-foreground/70 hover:bg-white/[0.06] hover:text-sidebar-foreground md:flex">
          {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
          <span className={collapsed ? "hidden" : ""}>Recolher menu</span>
        </Button>
        <Button variant="ghost" title="Sair" aria-label="Sair"
          onClick={async () => { await logout(); clearStoredAccess(); if (onLogout) onLogout(); else window.location.href = "/"; }}
          className="flex h-10 justify-start gap-3 rounded-xl px-2.5 text-sidebar-foreground/70 hover:bg-white/[0.06] hover:text-sidebar-foreground">
          <LogOut className="h-5 w-5" /><span className={`hidden ${collapsed ? "" : "md:inline"}`}>Sair</span>
        </Button>
      </div>
    </aside>
    </TooltipProvider>
  );
}
