import { Link, useRouterState } from "@tanstack/react-router";
import { useState, type ComponentType, type ReactNode } from "react";
import { Menu } from "lucide-react";
import { motion } from "motion/react";
import { CrmSidebar } from "@/components/crm/CrmSidebar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { isAreaItemActive } from "@/components/crm/area-nav";
import { useQuery } from "@tanstack/react-query";
import { projectsAllowed } from "@/lib/crm-projects.functions";
import { MANAGEMENT_GROUP, isManagementPath } from "./management-nav";
import { breadcrumbFor } from "./ux/nav-catalog";
import { ChevronRight } from "lucide-react";

export type AreaMenuItem = {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Também marca o item nas páginas internas (ex.: /clientes/$id). */
  nested?: boolean;
  /** Outros caminhos em que o item também fica ativo (ex.: fontes de busca da etapa 1 da Prospecção B2B). */
  also?: readonly string[];
};
export type AreaMenuGroup = { label?: string; items: readonly AreaMenuItem[] };

const normalize = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);

export { isAreaItemActive };

function AreaMenu({ title, groups, path, onNavigate }: { title: string; groups: readonly AreaMenuGroup[]; path: string; onNavigate?: () => void }) {
  return (
    <nav className="flex min-h-0 flex-1 flex-col" aria-label={`Menu de ${title}`}>
      <p className="mb-4 px-2.5 text-base font-semibold tracking-tight">{title}</p>
      <div className="space-y-4">
        {groups.map((group, gi) => (
          <div key={group.label ?? gi}>
            {group.label && <p className="mb-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">{group.label}</p>}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isAreaItemActive(item, path);
                return (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      activeOptions={{ exact: !item.nested, includeSearch: false }}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors duration-200",
                        active ? "font-medium text-primary" : "text-foreground/70 hover:text-foreground",
                      )}
                    >
                      {active
                        ? <motion.span layoutId={`lab-subnav-${title}`} className="lab-subnav-active absolute inset-0 rounded-lg" transition={{ type: "spring", stiffness: 480, damping: 38 }} aria-hidden />
                        : <span className="absolute inset-0 rounded-lg transition-colors duration-200 group-hover:bg-muted/70" aria-hidden />}
                      {active && <motion.span layoutId={`lab-subnav-bar-${title}`} className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-primary" aria-hidden />}
                      <item.icon className={cn("relative size-4 shrink-0 transition-transform duration-300", !active && "group-hover:scale-110")} />
                      <span className="relative min-w-0 truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

/**
 * Casca padrão das áreas com várias telas: menu principal azul + menu branco
 * lateral (gaveta no celular, aberta pelo ☰ da barra superior) + conteúdo.
 */
export function AreaLayout({ title, groups, children, onLogout, className }: { title: string; groups: readonly AreaMenuGroup[]; children: ReactNode; onLogout?: () => void; className?: string }) {
  const path = normalize(useRouterState({ select: (r) => r.location.pathname }));
  const management = isManagementPath(path);
  const projectAccess = useQuery({ queryKey: ["projects-access"], queryFn: () => projectsAllowed(), enabled: management, retry: false, staleTime: 30_000 });
  const menuTitle = management ? "Gestão" : title;
  const menuGroups: readonly AreaMenuGroup[] = management ? [
    { items: MANAGEMENT_GROUP.items.filter((i) => i.to !== "/projetos" || projectAccess.data?.allowed) },
    ...groups.map((g) => ({ ...g, label: g.label ?? title })),
  ] : groups;
  const [menuOpen, setMenuOpen] = useState(false);
  const current = groups.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label }))).find((i) => isAreaItemActive(i, path));
  const trail = breadcrumbFor(path);
  const currentLabel = current ? [current.group ?? title, current.label].join(" · ") : title;
  return (
    <div className={cn("flex min-h-screen bg-background", className)}>
      <CrmSidebar onLogout={onLogout} />
      <aside className="glass sticky top-0 hidden h-dvh max-h-dvh w-60 shrink-0 flex-col self-start overflow-y-auto border-r px-3 py-6 lg:flex" aria-label={`Menu de ${menuTitle}`}>
        <AreaMenu title={menuTitle} groups={menuGroups} path={path} />
      </aside>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="flex w-72 flex-col overflow-y-auto px-3">
          <SheetHeader className="sr-only"><SheetTitle>Menu de {menuTitle}</SheetTitle></SheetHeader>
          <AreaMenu title={menuTitle} groups={menuGroups} path={path} onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b bg-card py-2 pl-4 pr-16 lg:hidden">
          <Button variant="ghost" size="icon" aria-label={`Abrir menu de ${menuTitle}`} onClick={() => setMenuOpen(true)}><Menu /></Button>
          <span className="min-w-0 truncate font-semibold">{currentLabel}</span>
        </div>
        {trail.length > 1 && (
          <nav aria-label="Você está em" className="glass finance-no-print sticky top-0 z-30 hidden shrink-0 items-center gap-1 border-b border-border/60 px-8 py-2.5 pr-48 text-xs text-muted-foreground lg:flex">
            {trail.map((t, i) => (
              <span key={`${t.label}-${i}`} className="inline-flex items-center gap-1">
                {i > 0 && <ChevronRight className="size-3" aria-hidden />}
                {t.to && i < trail.length - 1 ? <Link to={t.to} className="hover:text-foreground hover:underline">{t.label}</Link> : <span className={i === trail.length - 1 ? "font-medium text-foreground" : undefined} aria-current={i === trail.length - 1 ? "page" : undefined}>{t.label}</span>}
              </span>
            ))}
          </nav>
        )}
        {/* Transição suave a cada troca de tela. */}
        <div key={path} className="lab-rise flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}
