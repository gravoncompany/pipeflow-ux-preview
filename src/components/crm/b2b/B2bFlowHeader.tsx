import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, ClipboardCheck, Search, Send } from "lucide-react";
import { motion } from "motion/react";
import { B2B_SOURCES } from "../B2bLayout";
import type { B2bStep } from "@/lib/b2b-flow";

type Counts = { selected: number; ready: number; toContact: number; approached: number };

/**
 * Cabeçalho do fluxo de prospecção: 3 etapas com contadores e a próxima ação sugerida.
 * Não muda nenhuma regra: só organiza a navegação entre telas que já existem.
 */
export function B2bFlowHeader({ step, path, counts }: { step: B2bStep; path: string; counts: Counts }) {
  const steps = [
    { id: "buscar", n: 1, label: "Encontrar empresas", to: "/prospeccao-b2b", icon: Search, badge: counts.selected ? `${counts.selected} selecionada(s)` : "Escolha a fonte" },
    { id: "revisar", n: 2, label: "Revisar e adicionar ao CRM", to: "/prospeccao-b2b/revisar", icon: ClipboardCheck, badge: counts.selected ? `${counts.ready} de ${counts.selected} prontas` : "Nada selecionado" },
    { id: "contato", n: 3, label: "Primeiro contato", to: "/prospeccao-b2b/primeiro-contato", icon: Send, badge: `${counts.toContact} a abordar · ${counts.approached} abordadas` },
  ] as const;
  return (
    <div className="space-y-4">
      <ol className="grid gap-2 md:grid-cols-3" aria-label="Etapas da prospecção">
        {steps.map((s, i) => {
          const active = s.id === step;
          // Concluída só com resultado real: empresas selecionadas (1) ou empresas já no CRM (2).
          const done = !active && (s.id === "buscar" ? counts.selected > 0 : s.id === "revisar" ? counts.toContact + counts.approached > 0 : false);
          return (
            <li key={s.id}>
              <Link to={s.to} aria-current={active ? "step" : undefined}
                className={`group relative flex items-center gap-3 overflow-hidden rounded-2xl border p-3 transition-all duration-300 ${active ? "border-primary/40 shadow-[0_10px_30px_-14px_var(--brand-glow)]" : "bg-card hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"}`}>
                {active && <motion.span layoutId="b2b-step" className="absolute inset-0 bg-gradient-to-br from-primary/[0.12] via-card to-card" transition={{ type: "spring", stiffness: 420, damping: 36 }} aria-hidden />}
                <span className={`relative flex size-9 shrink-0 items-center justify-center rounded-xl text-sm font-semibold transition-colors ${active ? "btn-brand text-primary-foreground shadow" : done ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
                  {done ? <Check className="size-4" /> : s.n}
                </span>
                <span className="relative min-w-0">
                  <span className={`block truncate text-sm font-semibold ${active ? "text-foreground" : "text-foreground/80"}`}>{s.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{s.badge}</span>
                </span>
                {i < steps.length - 1 && <ArrowRight className="relative ml-auto hidden size-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 md:block" aria-hidden />}
              </Link>
            </li>
          );
        })}
      </ol>
      {step === "buscar" && (
        <div className="space-y-2">
          <div role="tablist" aria-label="Fonte de busca" className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-full border bg-card/80 p-1 shadow-sm backdrop-blur">
            {B2B_SOURCES.map((src) => {
              const on = path === src.to;
              return (
                <Link key={src.to} to={src.to} role="tab" aria-selected={on} className={`relative shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${on ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  {on && <motion.span layoutId="b2b-source" className="btn-brand absolute inset-0 rounded-full shadow" transition={{ type: "spring", stiffness: 480, damping: 38 }} aria-hidden />}
                  <span className="relative">{src.label}</span>
                </Link>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">{B2B_SOURCES.find((s) => s.to === path)?.hint ?? ""} · selecione as empresas e siga para a etapa 2. Os selecionados continuam guardados ao trocar de fonte.</p>
        </div>
      )}
    </div>
  );
}
