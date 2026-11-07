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
import { CommandPalette, openCommandPalette } from "./ux/CommandPalette";

const ICONS = { dashboard: LayoutDashboard, crm: Columns3, prospecting: Building2, service: MessageCircle, campaigns: Send, marketing: Megaphone, management: Target, ai: Bot, settings: Settings };

const COLLAPSED_KEY = "crm.sidebar.collapsed.v1";

const linkClass = (active: boolean) =>
  `flex h-10 items-center gap-3 rounded-lg px-2.5 text-sm transition-colors ${active
    ? "bg-sidebar-primary font-medium text-sidebar-primary-foreground shadow-sm"
    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"}`;

export function CrmSidebar({ onLogout }: { onLogout?: () => void }) {
  const path = useRouterState({ select: (r) => r.location.pathname });
  const logout = useServerFn(logoutCrm);
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
    <aside className={`crm-sidebar flex w-16 shrink-0 flex-col gap-2 overflow-y-auto border-r border-sidebar-border bg-sidebar p-3 text-sidebar-foreground transition-[width] duration-200 ease-in-out motion-reduce:transition-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${collapsed ? "md:w-16" : "md:w-56"}`}>
      {/* No Pipeline o sino fica no cabeçalho, ao lado de "Atualizar pipeline". */}
      {path !== "/" && <CrmNotifications />}
      <ProfileMenu />
      {/* Na própria Pipeflow IA o chat já ocupa a tela; o botão flutuante cobriria o envio. */}
      {path !== "/gravon-ai" && <GravonFloatingChat />}
      <div className="mb-2 flex items-center gap-2">
        <PipeflowSymbol className="h-10 w-10 rounded-lg bg-sidebar-foreground p-1" />
        <span className={`hidden font-semibold ${collapsed ? "" : "md:block"}`}>PipeFlow CRM</span>
      </div>
      <CommandPalette />
      <button type="button" onClick={openCommandPalette} title="Buscar (Ctrl+K)" aria-label="Buscar telas e clientes (Ctrl+K)"
        className="flex h-10 items-center gap-3 rounded-lg border border-sidebar-border px-2.5 text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground">
        <Search className="h-5 w-5 shrink-0" />
        <span className={`hidden flex-1 text-left ${collapsed ? "" : "md:inline"}`}>Buscar…</span>
        <kbd className={`hidden rounded border border-sidebar-border px-1 text-[10px] ${collapsed ? "" : "md:inline"}`}>Ctrl K</kbd>
      </button>
      <nav className="flex flex-1 flex-col gap-1" aria-label="Menu principal">
        {MAIN_NAV_ITEMS.map((it) => {
              const active = mainAreaActive(it, path);
              const Icon = ICONS[it.icon];
              return (
                <Link key={it.to} to={it.to} title={it.label} aria-label={it.label} aria-current={active ? "page" : undefined} className={linkClass(active)}>
                  <Icon className="h-5 w-5 shrink-0" />
                  <span className={`hidden ${collapsed ? "" : "md:inline"}`}>{it.label}</span>
                </Link>
              );
            })}
      </nav>
      {/* Tokens escuros só neste quadro, para manter o contraste sobre o azul-marinho. */}
      <div className={`dark hidden ${collapsed ? "" : "md:block"}`}><WhatsAppStatusBox /></div>
      <Button variant="ghost" title={collapsed ? "Expandir menu" : "Recolher menu"} aria-label={collapsed ? "Expandir menu" : "Recolher menu"} aria-pressed={collapsed}
        onClick={toggleCollapsed}
        className="hidden h-10 justify-start gap-3 px-2.5 text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground md:flex">
        {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
        <span className={collapsed ? "hidden" : ""}>Recolher menu</span>
      </Button>
      <Button variant="ghost" title="Sair" aria-label="Sair"
        onClick={async () => { await logout(); clearStoredAccess(); if (onLogout) onLogout(); else window.location.href = "/"; }}
        className="flex h-10 justify-start gap-3 px-2.5 text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground">
        <LogOut className="h-5 w-5" /><span className={`hidden ${collapsed ? "" : "md:inline"}`}>Sair</span>
      </Button>
    </aside>
  );
}
