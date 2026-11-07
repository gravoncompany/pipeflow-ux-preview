import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BarChart3, Building2, Wallet } from "lucide-react";
import { SettingsLayout } from "@/components/crm/SettingsLayout";
import { SETTINGS_GROUPS } from "@/components/crm/settings-nav";
import { CrmAuthGate } from "@/components/crm/CrmAuthGate";
import { getCrmAccess } from "@/lib/crm-access.functions";

export const Route = createFileRoute("/configuracoes/")({
  head: () => ({ meta: [{ title: "Configurações — PipeFlow CRM" }, { name: "description", content: "Todas as configurações e integrações do PipeFlow em um só lugar." }] }),
  component: SettingsIndex,
});

const DESCRIPTIONS: Record<string, string> = {
  "/configuracoes/integracoes/api": "Chaves de API, Zapier e integrações personalizadas.",
  "/configuracoes/notificacoes": "Avisos por push, e-mail e WhatsApp interno.",
  "/configuracoes/integracoes/meta": "Envio de eventos de conversão para a Meta.",
  "/configuracoes/integracoes/meta/historico": "Eventos enviados, aceitos e com erro.",
  "/configuracoes/integracoes/instagram": "Conta conectada, mensagens e webhooks.",
  "/configuracoes/integracoes/instagram-pesquisa": "Pesquisa de perfis para prospecção.",
  "/configuracoes/whatsapp": "Mensagens de referência por campanha e funil.",
  "/configuracoes/automacoes/primeiro-contato": "Formulário e mensagem do primeiro contato.",
};
const EXTRA = [
  { to: "/configuracoes/integracoes/google-ads", label: "Google Ads", description: "Contas e investimento do Google Ads.", icon: BarChart3 },
  { to: "/configuracoes/integracoes/meta-ads", label: "Meta Ads", description: "Contas e investimento de anúncios da Meta.", icon: BarChart3 },
  { to: "/configuracoes/integracoes/hypercash", label: "HyperCash", description: "Cobranças e recebimentos pelo HyperCash.", icon: Wallet },
  { to: "/configuracoes/integracoes/outras", label: "Outras integrações", description: "Receita Federal, Apify e APIs personalizadas.", icon: Building2 },
];

function Card({ to, label, description, Icon, group }: { to: string; label: string; description?: string; Icon: React.ComponentType<{ className?: string }>; group?: string }) {
  return (
    <Link to={to} className="group flex items-start gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-primary/60">
      <span className="rounded-md bg-primary/10 p-2 text-primary"><Icon className="size-5" /></span>
      <span className="min-w-0 flex-1">
        {group && <span className="block text-xs uppercase tracking-wide text-muted-foreground">{group}</span>}
        <span className="block font-medium">{label}</span>
        {description && <span className="mt-0.5 block text-sm text-muted-foreground">{description}</span>}
      </span>
      <ArrowRight className="mt-1 size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

function SettingsIndex() {
  const access = useServerFn(getCrmAccess);
  const q = useQuery({ queryKey: ["crm-access"], queryFn: () => access(), retry: false });
  if (q.data && !q.data.full) return <CrmAuthGate onUnlock={() => void q.refetch()} />;
  const items = SETTINGS_GROUPS.filter((g) => g.label !== "Início").flatMap((g) => g.items.map((i) => ({ ...i, group: g.label })));
  return (
    <SettingsLayout>
      <main className="min-w-0 flex-1 p-4 md:p-8">
        <header className="border-b pb-5">
          <h1 className="text-2xl font-semibold">Configurações</h1>
          <p className="mt-1 text-sm text-muted-foreground">Escolha o que deseja ajustar. Dica: use Ctrl+K para ir direto a qualquer tela.</p>
        </header>
        {!q.data ? <p role="status" className="py-12 text-sm text-muted-foreground">Carregando…</p> : (
          <>
            <section className="mt-6"><h2 className="mb-3 text-sm font-semibold text-muted-foreground">Canais e automações</h2>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{items.map((i) => <Card key={i.to} to={i.to} label={i.label} group={i.group} description={DESCRIPTIONS[i.to]} Icon={i.icon} />)}</div>
            </section>
            <section className="mt-8"><h2 className="mb-3 text-sm font-semibold text-muted-foreground">Anúncios, cobranças e dados externos</h2>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{EXTRA.map((i) => <Card key={i.to} to={i.to} label={i.label} description={i.description} Icon={i.icon} />)}</div>
            </section>
          </>
        )}
      </main>
    </SettingsLayout>
  );
}
