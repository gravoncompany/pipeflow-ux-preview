import { Link } from "@tanstack/react-router";
import { Activity, Building2 } from "lucide-react";
import { motion } from "motion/react";

/** Liga a lista de clientes e o pós-venda como uma única área (mesmos endereços de sempre). */
export function ClientsHubTabs({ active }: { active: "carteira" | "posvenda" }) {
  const tabs = [
    { key: "carteira", label: "Carteira de clientes", to: "/clientes", icon: Building2 },
    { key: "posvenda", label: "Pós-venda", to: "/pos-venda", icon: Activity },
  ] as const;
  return (
    <nav aria-label="Área de clientes" className="flex gap-6 border-b">
      {tabs.map((t) => (
        <Link key={t.key} to={t.to} aria-current={active === t.key ? "page" : undefined}
          className={`relative -mb-px flex items-center gap-2 pb-2.5 text-sm font-medium transition-colors ${active === t.key ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}>
          <t.icon className="size-4" />{t.label}
          {active === t.key && <motion.span layoutId="clients-hub" className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary" />}
        </Link>
      ))}
    </nav>
  );
}
