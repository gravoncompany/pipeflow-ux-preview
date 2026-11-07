import { createFileRoute, Link } from "@tanstack/react-router";
import { PipeflowLogo } from "@/components/brand/PipeflowLogo";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPortalAdminStatus } from "@/lib/gravon-portal.functions";
import { PortalAccountForm } from "@/components/crm/PortalAccountForm";
import { Button } from "@/components/ui/button";
import { safeReturnPath } from "@/lib/crm-agent-access";

export const Route = createFileRoute("/auth")({
  // Pages that need the admin account send people here and get them back afterwards (internal paths only).
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({ redirect: safeReturnPath(search.redirect) }),
  head: () => ({
    meta: [
      { title: "Acesso individual — Gravon AI" },
      {
        name: "description",
        content: "Acesso individual confirmado para administração da integração Portal Gravon.",
      },
      { property: "og:title", content: "Acesso individual — Gravon AI" },
      { property: "og:description", content: "Conta individual e confirmação segura de acesso." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AccountPage,
});
function AccountPage() {
  const getStatus = useServerFn(getPortalAdminStatus);
  const { redirect } = Route.useSearch();
  const status = useQuery({
    queryKey: ["portal-admin-access"],
    queryFn: () => getStatus(),
    retry: false,
  });
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-6 py-12">
      <PipeflowLogo symbolClassName="h-11 w-11" textClassName="text-xl" />
      <header>
        <h1 className="text-3xl font-bold">Gravon AI · Acesso individual</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Conta administrativa preparada para gravoncompany@gmail.com. Confirme o e-mail antes de
          solicitar a liberação.
        </p>
      </header>
      {status.data?.signedIn ? (
        <div className="space-y-4">
          <p>Conta conectada: {status.data.email}</p>
          <p className="text-sm text-muted-foreground">
            {status.data.authorized
              ? "Permissão administrativa confirmada."
              : "E-mail confirmado. Permissão administrativa ainda pendente de liberação controlada."}
          </p>
          <div className="flex flex-wrap gap-2">
            {redirect && status.data.authorized && (
              <Button asChild>
                <a href={redirect}>Voltar para a página anterior</a>
              </Button>
            )}
            <Button asChild variant={redirect && status.data.authorized ? "outline" : "default"}>
              <Link to="/gravon-ai" search={{ tab: "portal" }}>
                Abrir Portal Gravon
              </Link>
            </Button>
          </div>
        </div>
      ) : (
        <PortalAccountForm />
      )}
      <Link to="/" className="text-sm text-primary">
        Voltar ao CRM
      </Link>
    </main>
  );
}
