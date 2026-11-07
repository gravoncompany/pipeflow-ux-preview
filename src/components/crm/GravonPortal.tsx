import { useState, useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Copy, RefreshCw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PortalIdentityDiagnostic } from "@/lib/portal-identity-diagnostics";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getPortalAdminStatus,
  listPortalIdentityCandidates,
  verifyPortalIdentityCandidate,
} from "@/lib/gravon-portal.functions";

export function GravonPortal() {
  const queries = useQueryClient();
  const navigate = useNavigate();
  const status = useServerFn(getPortalAdminStatus);
  const list = useServerFn(listPortalIdentityCandidates);
  const verify = useServerFn(verifyPortalIdentityCandidate);
  const permission = useQuery({
    queryKey: ["portal-admin-access"],
    queryFn: () => status(),
    retry: false,
  });
  const contacts = useQuery({
    queryKey: ["portal-identity-candidates"],
    queryFn: () => list(),
    enabled: permission.data?.authorized === true,
    retry: false,
  });
  const [selected, setSelected] = useState("");
  type Verification = Extract<Awaited<ReturnType<typeof verify>>, { ok: true }>;
  const [verified, setVerified] = useState<Verification["identity"] | null>(null);
  const [diagnostic, setDiagnostic] = useState<PortalIdentityDiagnostic | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const epoch = useRef(0);
  const account = permission.data?.email ?? "";
  useEffect(() => {
    epoch.current++;
    setVerified(null);
    setDiagnostic(null);
    setError("");
    setSelected("");
    setCopied(false);
    return () => {
      epoch.current++;
    };
  }, [account]);
  return (
    <section className="max-w-3xl space-y-6">
      <header>
        <h2 className="text-xl font-semibold">Portal Gravon · Identidade do WhatsApp</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Vínculo no Portal ainda depende da confirmação do identificador e de habilitação lá.
        </p>
      </header>
      {permission.data?.signedIn && (
        <div className="flex flex-wrap items-center gap-3 border-b border-border pb-4 text-sm">
          <span>Conta: {permission.data.email}</span>
          <Button
            variant="outline"
            onClick={async () => {
              epoch.current++;
              setVerified(null);
              setDiagnostic(null);
              setSelected("");
              await queries.cancelQueries();
              queries.clear();
              await supabase.auth.signOut();
              await navigate({ to: "/auth", replace: true });
            }}
          >
            Sair da conta individual
          </Button>
        </div>
      )}
      {permission.isPending ? (
        <p className="text-muted-foreground">Verificando acesso administrativo...</p>
      ) : !permission.data?.authorized ? (
        <div className="flex items-start gap-3 border-l-4 border-destructive bg-muted p-4">
          <ShieldAlert className="mt-1 size-5 shrink-0 text-destructive" />
          <div className="space-y-2">
            <h3 className="font-semibold">
              {permission.data?.signedIn
                ? "Permissão administrativa pendente"
                : "Acesso individual necessário"}
            </h3>
            <p className="text-sm">
              {permission.data?.signedIn
                ? "Seu e-mail está confirmado, mas a permissão administrativa ainda exige liberação controlada. O cadastro não concede acesso a contatos ou identificadores."
                : "A senha compartilhada não identifica um administrador individual. Entre com sua conta confirmada para verificar a permissão."}
            </p>
            <Button variant="outline" onClick={() => void permission.refetch()}>
              <RefreshCw className="size-4" />
              Verificar acesso
            </Button>
            {!permission.data?.signedIn && (
              <Button asChild>
                <Link to="/auth">Entrar ou criar conta individual</Link>
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {!permission.data?.channelReady && (
            <p role="status" className="text-sm text-muted-foreground">
              Conta administrativa confirmada, mas nenhum canal pessoal foi autorizado para esta
              conta. Solicite o vínculo controlado do seu WhatsApp antes de verificar o contato.
            </p>
          )}
          <Select
            value={selected}
            onValueChange={(id) => {
              setSelected(id);
              setVerified(null);
              setDiagnostic(null);
              setCopied(false);
              setError("");
            }}
          >
            <SelectTrigger aria-label="Contato recebido no WhatsApp">
              <SelectValue placeholder="Selecionar evento recebido" />
            </SelectTrigger>
            <SelectContent>
              {contacts.data?.map((row) => (
                <SelectItem key={row.id} value={row.id}>
                  {row.contact} · {row.instance} ·{" "}
                  {new Date(row.receivedAt).toLocaleString("pt-BR")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!contacts.isPending && !contacts.data?.length && (
            <p className="text-sm text-muted-foreground">
              Nenhuma mensagem pessoal disponível. Envie uma mensagem no seu WhatsApp autorizado.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void contacts.refetch()}>
              <RefreshCw className="size-4" />
              Atualizar eventos
            </Button>
            <Button
              disabled={!selected || busy}
              onClick={async () => {
                const currentEpoch = epoch.current;
                setBusy(true);
                setError("");
                setDiagnostic(null);
                setVerified(null);
                try {
                  const result = await verify({ data: { id: selected } });
                  if (epoch.current !== currentEpoch) return;
                  if (result.ok) setVerified(result.identity);
                  else setDiagnostic(result.diagnostic);
                } catch {
                  setError(
                    "Não foi possível verificar este evento na Evolution. Nenhum identificador liberado.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Verificando..." : "Verificar identidade"}
            </Button>
          </div>
          {(error || contacts.isError) && (
            <p role="alert" className="text-sm text-destructive">
              {error || "Não foi possível carregar os eventos."}
            </p>
          )}
          {diagnostic && (
            <div role="alert" className="space-y-3 border-l-4 border-destructive pl-4 text-sm">
              <p className="text-destructive">{diagnostic.message} Nenhum identificador liberado.</p>
              <dl className="space-y-1 break-words">
                <div><dt className="inline font-medium">Etapa: </dt><dd className="inline">{diagnostic.stage} · {diagnostic.code}</dd></div>
                {diagnostic.instance && <div><dt className="inline font-medium">Instância: </dt><dd className="inline">{diagnostic.instance}</dd></div>}
                {diagnostic.messageId && <div><dt className="inline font-medium">ID solicitado: </dt><dd className="inline">{diagnostic.messageId}</dd></div>}
                {diagnostic.expectedPhone && <div><dt className="inline font-medium">Número esperado: </dt><dd className="inline">{diagnostic.expectedPhone}</dd></div>}
                {diagnostic.httpStatus !== undefined && <div>Evolution HTTP: {diagnostic.httpStatus}</div>}
                {diagnostic.records !== undefined && <div>Registros retornados: {diagnostic.records}</div>}
                {Object.entries(diagnostic.checks ?? {}).map(([key, value]) => <div key={key}>{key}: {String(value)}</div>)}
              </dl>
            </div>
          )}
          {verified && (
            <dl className="space-y-4 border-t border-border pt-4 text-sm">
              <div>
                <dt className="text-muted-foreground">Contato · canal</dt>
                <dd>
                  {verified.contact} · {verified.instance}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Identificador exato · subject</dt>
                <dd className="mt-2 flex items-start gap-2">
                  <code className="min-w-0 flex-1 break-all bg-muted p-3">{verified.subject}</code>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Copiar identificador"
                    title={copied ? "Copiado" : "Copiar identificador"}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(verified.subject);
                        setCopied(true);
                      } catch {
                        setError("Não foi possível copiar o identificador.");
                      }
                    }}
                  >
                    <Copy className="size-4" />
                  </Button>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Origem verificada</dt>
                <dd className="break-words">{verified.source}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Mensagem · verificação</dt>
                <dd>
                  {verified.eventAt} · {verified.verifiedAt}
                </dd>
              </div>
            </dl>
          )}
        </div>
      )}
    </section>
  );
}
