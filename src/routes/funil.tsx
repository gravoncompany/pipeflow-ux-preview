import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CrmAuthGate, getStoredAccess, type CrmAccess } from "@/components/crm/CrmAuthGate";
import { CrmSidebar } from "@/components/crm/CrmSidebar";
import { FunnelAnalysis } from "@/components/crm/FunnelAnalysis";

// Rota preservada: a mesma análise também abre como aba "Análise de Funis" dentro do CRM (/).
export const Route = createFileRoute("/funil")({
  head: () => ({
    meta: [
      { title: "Análise de Funis — PipeFlow CRM" },
      {
        name: "description",
        content: "Taxas de conversão do funil de vendas por período selecionável.",
      },
      { property: "og:title", content: "Análise de Funis — PipeFlow CRM" },
      {
        property: "og:description",
        content: "Leads novos, resposta, qualificação, reunião e fechamento.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FunilPage,
});

function FunilPage() {
  const [access, setAccess] = useState<CrmAccess | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setAccess(getStoredAccess());
    setMounted(true);
  }, []);
  if (!mounted) return null;
  if (!access) return <CrmAuthGate onUnlock={setAccess} />;
  return (
    <div className="flex h-screen bg-background">
      <CrmSidebar onLogout={() => setAccess(null)} />
      <FunnelAnalysis />
    </div>
  );
}
