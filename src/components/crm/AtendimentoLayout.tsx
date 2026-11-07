import type { ReactNode } from "react";
import { Activity, Briefcase, CalendarClock, CalendarDays, ListTodo, MessageCircle, Users } from "lucide-react";
import { AreaLayout } from "@/components/crm/AreaLayout";

/** Área Atendimento: Conversas primeiro; Clientes e Agenda agrupados no mesmo submenu branco. */
export const ATENDIMENTO_GROUPS = [
  { items: [
    { to: "/whatsapp", label: "Conversas", icon: MessageCircle },
  ] },
  { label: "Clientes", items: [
    { to: "/clientes", label: "Clientes", icon: Briefcase, nested: true },
    { to: "/pos-venda", label: "Gestão de Clientes", icon: Activity, nested: true },
    { to: "/tarefas", label: "Tarefas", icon: ListTodo, nested: true },
    { to: "/contatos", label: "Todos os contatos", icon: Users },
  ] },
  { label: "Agenda", items: [
    { to: "/agenda", label: "Calendário", icon: CalendarDays },
    { to: "/agenda/reunioes", label: "Lista de reuniões", icon: CalendarClock },
  ] },
] as const;

export function AtendimentoLayout({ children, className }: { children: ReactNode; className?: string }) {
  return <AreaLayout title="Atendimento" groups={ATENDIMENTO_GROUPS} className={className}>{children}</AreaLayout>;
}
