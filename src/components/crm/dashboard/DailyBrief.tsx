import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlarmClock, AlertTriangle, CalendarClock, MessageCircle } from "lucide-react";
import { getReceiptControl } from "@/lib/receipt-control.functions";
import { getCsOverview } from "@/lib/customer-success.functions";
import { receiptRows } from "@/lib/receipt-control";
import { receiptActionQueue } from "@/lib/receipt-insights";
import { todaySP } from "@/lib/finance-management";
import { daysBetween } from "@/lib/ux-format";
import { currency } from "@/lib/revenue";
import { KpiCard } from "@/components/crm/ux/KpiCard";

/**
 * Resumo de abertura ("o que fazer hoje"): junta os números que pedem ação em várias áreas,
 * cada um levando para a tela onde se resolve. Leituras opcionais: sem acesso, o cartão mostra "—".
 */
export function DailyBrief({ awaiting, overdueReturns }: { awaiting: number | null; overdueReturns: number | null }) {
  const today = todaySP();
  const readReceipts = useServerFn(getReceiptControl);
  const receipts = useQuery({ queryKey: ["receipt-control"], queryFn: () => readReceipts(), retry: false, staleTime: 60_000, refetchOnWindowFocus: false });
  const cs = useQuery({ queryKey: ["customer-success"], queryFn: () => getCsOverview(), retry: false, staleTime: 60_000 });
  const queue = receipts.data ? receiptActionQueue(receiptRows(receipts.data.charges, receipts.data.payments, new Set(receipts.data.bank.map((b) => b.clientId))), today) : null;
  const renewals = (cs.data as { clients?: { management?: { contracts?: { renewal: string | null; status: string }[] } }[] } | undefined)?.clients
    ?.flatMap((c) => c.management?.contracts ?? []).filter((x) => x.status !== "encerrado" && x.renewal && daysBetween(today, x.renewal) <= 30 && daysBetween(today, x.renewal) >= -30).length ?? null;
  const hour = Number(new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "numeric", hour12: false }).format(new Date()));
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  return (
    <section aria-labelledby="brief" className="space-y-3">
      <h2 id="brief" className="text-lg font-semibold">{greeting}! Isto pede atenção hoje</h2>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Link to="/whatsapp" className="block"><KpiCard icon={<MessageCircle className="size-3.5" />} label="Leads aguardando resposta" value={awaiting ?? "—"} tone={awaiting ? "warning" : "success"} hint="Abrir conversas" /></Link>
        <Link to="/" className="block"><KpiCard icon={<AlarmClock className="size-3.5" />} label="Retornos atrasados" value={overdueReturns ?? "—"} tone={overdueReturns ? "danger" : "success"} hint="Abrir pipeline" /></Link>
        <Link to="/financeiro/recebimentos" search={{ situacao: "atrasado" }} className="block"><KpiCard icon={<AlertTriangle className="size-3.5" />} label="Cobranças atrasadas" value={queue ? currency(queue.totals.overdue / 100) : "—"} tone={queue?.overdue.length ? "danger" : "success"} hint={queue ? `${queue.overdue.length} cobrança(s) · ${queue.dueSoon.length} vencem em 7 dias` : "Requer acesso ao financeiro"} /></Link>
        <Link to="/pos-venda/renovacoes" className="block"><KpiCard icon={<CalendarClock className="size-3.5" />} label="Renovações em 30 dias" value={renewals ?? "—"} tone={renewals ? "warning" : "default"} hint="Contratos a renovar" /></Link>
      </div>
    </section>
  );
}
