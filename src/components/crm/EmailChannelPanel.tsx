import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  Mail,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  getEmailChannel,
  registerEmailTestRecipient,
  revokeEmailTestRecipient,
  saveEmailSettings,
  verifyEmailChannel,
} from "@/lib/campaigns.functions";
import {
  DEFAULT_CAMPAIGN_TIMEZONE,
  formatInZone,
  issueCategoryLabels,
  type ProviderCheck,
  type ReadinessIssue,
} from "@/lib/email-campaigns";

export type EmailChannelData = Awaited<ReturnType<typeof getEmailChannel>>;
type Verification = Awaited<ReturnType<typeof verifyEmailChannel>>;
const TIMEZONES = [
  DEFAULT_CAMPAIGN_TIMEZONE,
  "America/Manaus",
  "America/Cuiaba",
  "America/Belem",
  "America/Fortaleza",
  "America/Recife",
  "America/Noronha",
  "America/Rio_Branco",
  "Europe/Lisbon",
  "UTC",
];

export function CheckIcon({ state }: { state: ProviderCheck["state"] }) {
  if (state === "ok")
    return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-label="OK" />;
  if (state === "pending")
    return <CircleDashed className="mt-0.5 size-4 shrink-0 text-amber-600" aria-label="Pendente" />;
  return <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-label="Erro" />;
}

/** Lista de bloqueios agrupada por categoria, sempre com motivo e instrução. */
export function IssueList({ issues }: { issues: ReadinessIssue[] }) {
  const groups = (Object.keys(issueCategoryLabels) as (keyof typeof issueCategoryLabels)[])
    .map((category) => ({ category, items: issues.filter((i) => i.category === category) }))
    .filter((g) => g.items.length);
  if (!groups.length) return null;
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.category}>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {issueCategoryLabels[g.category]}
          </p>
          <ul className="mt-1 space-y-2">
            {g.items.map((i) => (
              <li key={i.code + i.message} className="flex items-start gap-2 text-sm">
                <CheckIcon state={i.blocking ? "error" : "pending"} />
                <span className="min-w-0 break-words">
                  <span className="font-medium">{i.message}</span>
                  {!i.blocking && <span className="text-muted-foreground"> (aviso)</span>}
                  {i.action && (
                    <span className="block text-muted-foreground">Como resolver: {i.action}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function EmailChannelPanel({
  data,
  leads,
  onChanged,
}: {
  data: EmailChannelData;
  leads: { id: string; name: string; company: string }[];
  onChanged: () => Promise<unknown>;
}) {
  const save = useServerFn(saveEmailSettings),
    verify = useServerFn(verifyEmailChannel),
    addTest = useServerFn(registerEmailTestRecipient),
    revokeTest = useServerFn(revokeEmailTestRecipient);
  const [form, setForm] = useState({
    senderEmail: data.settings.sender_email,
    senderName: data.settings.sender_name,
    replyTo: data.settings.reply_to,
    timezone: data.settings.timezone || DEFAULT_CAMPAIGN_TIMEZONE,
  });
  const [verification, setVerification] = useState<Verification | null>(null);
  const [test, setTest] = useState({ email: "", label: "", confirmed: false });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ação indisponível.");
    } finally {
      setBusy(false);
    }
  }
  const dirty =
    form.senderEmail !== data.settings.sender_email ||
    form.senderName !== data.settings.sender_name ||
    form.replyTo !== data.settings.reply_to ||
    form.timezone !== data.settings.timezone;
  const leadName = new Map(
    leads.map((l) => [l.id, `${l.name}${l.company ? ` · ${l.company}` : ""}`]),
  );
  const emailConsents = data.permissions.filter((p) => p.channel === "email");

  return (
    <section className="space-y-6 border-b py-5 text-sm" aria-labelledby="email-channel-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="email-channel-title" className="flex items-center gap-2 text-base font-semibold">
          <Mail className="size-4" />
          Canal de e-mail (Brevo)
        </h2>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || !data.migrationReady}
          onClick={() => void run(async () => setVerification(await verify()))}
        >
          <ShieldCheck className="size-4" />
          Verificar canal
        </Button>
      </div>
      {!data.migrationReady && (
        <p role="alert" className="text-destructive">
          A migração 0086 (configuração de e-mail) ainda não foi aplicada no banco. O canal
          permanece bloqueado até a aplicação.
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-primary">
          {notice}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="sender-email">E-mail do remetente (cadastrado na Brevo)</Label>
          <Input
            id="sender-email"
            type="email"
            value={form.senderEmail}
            onChange={(e) => setForm({ ...form, senderEmail: e.target.value })}
            placeholder="contato@suaempresa.com.br"
            maxLength={254}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="sender-name">Nome do remetente</Label>
          <Input
            id="sender-name"
            value={form.senderName}
            onChange={(e) => setForm({ ...form, senderName: e.target.value })}
            placeholder="Gravon Company"
            maxLength={70}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="reply-to">Responder para (opcional)</Label>
          <Input
            id="reply-to"
            type="email"
            value={form.replyTo}
            onChange={(e) => setForm({ ...form, replyTo: e.target.value })}
            maxLength={254}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="timezone">Fuso horário dos agendamentos</Label>
          <select
            id="timezone"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            value={form.timezone}
            onChange={(e) => setForm({ ...form, timezone: e.target.value })}
          >
            {[...new Set([form.timezone, ...TIMEZONES])].map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </div>
      </div>
      <Button
        size="sm"
        disabled={busy || !dirty || !data.migrationReady}
        onClick={() =>
          void run(async () => {
            await save({ data: { ...form, revision: data.settings.revision } });
            await onChanged();
            setVerification(null);
            setNotice('Remetente salvo. Clique em "Verificar canal" para validar na Brevo.');
          })
        }
      >
        <Save className="size-4" />
        Salvar remetente
      </Button>

      {verification && (
        <div role="status" className="space-y-2 rounded-md border p-4">
          <p className="font-semibold">
            {verification.issues.some((i) => i.blocking)
              ? "Validação do canal pendente"
              : "Canal de e-mail validado"}{" "}
            <span className="font-normal text-muted-foreground">
              · verificado em{" "}
              {formatInZone(verification.status.checkedAt, verification.settings.timezone)}
            </span>
          </p>
          <ul className="space-y-2">
            {verification.status.checks.map((c) => (
              <li key={c.id} className="flex items-start gap-2">
                <CheckIcon state={c.state} />
                <span className="min-w-0 break-words">
                  <span className="font-medium">{c.label}:</span> {c.detail}
                  {c.action && (
                    <span className="block text-muted-foreground">Como resolver: {c.action}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {!verification.settings.sender_email && (
            <p className="text-muted-foreground">
              Salve o remetente acima para validar remetente e domínio.
            </p>
          )}
        </div>
      )}

      <details className="rounded-md border p-4">
        <summary className="cursor-pointer font-medium">
          Endereços próprios para teste ({data.testRecipients.filter((t) => !t.revoked_at).length})
        </summary>
        <p className="mt-2 text-muted-foreground">
          Testes vão apenas para endereços seus ou da sua equipe, autorizados aqui. Eles não
          autorizam campanhas para leads.
        </p>
        <div className="mt-3 divide-y">
          {data.testRecipients.map((t) => (
            <div key={t.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
              <span className="min-w-0 break-words">
                {t.email} · {t.label}
                <span className="block text-xs text-muted-foreground">
                  {t.revoked_at
                    ? `Revogado em ${formatInZone(t.revoked_at, data.settings.timezone)}`
                    : `Autorizado em ${formatInZone(t.authorized_at, data.settings.timezone)} por ${t.recorded_by}`}
                </span>
              </span>
              {!t.revoked_at && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      if (!window.confirm(`Revogar ${t.email} para testes?`)) return;
                      await revokeTest({ data: { email: t.email, confirmed: true } });
                      await onChanged();
                    })
                  }
                >
                  <Trash2 className="size-4" />
                  Revogar
                </Button>
              )}
            </div>
          ))}
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Input
            type="email"
            aria-label="E-mail próprio para teste"
            placeholder="seu-email@empresa.com.br"
            value={test.email}
            onChange={(e) => setTest({ ...test, email: e.target.value })}
            maxLength={254}
          />
          <Input
            aria-label="Identificação do endereço de teste"
            placeholder="Ex.: Meu e-mail"
            value={test.label}
            onChange={(e) => setTest({ ...test, label: e.target.value })}
            maxLength={80}
          />
        </div>
        <label className="mt-3 flex items-start gap-2 text-xs">
          <Checkbox
            checked={test.confirmed}
            onCheckedChange={(v) => setTest({ ...test, confirmed: v === true })}
          />
          <span>
            Confirmo que este endereço é meu (ou da minha equipe) e autorizo receber e-mails de
            teste.
          </span>
        </label>
        <Button
          className="mt-3"
          size="sm"
          variant="outline"
          disabled={
            busy || !test.confirmed || test.label.trim().length < 2 || !test.email.includes("@")
          }
          onClick={() =>
            void run(async () => {
              await addTest({ data: { email: test.email, label: test.label, confirmed: true } });
              setTest({ email: "", label: "", confirmed: false });
              await onChanged();
              setNotice("Endereço de teste autorizado.");
            })
          }
        >
          Autorizar endereço de teste
        </Button>
      </details>

      <details className="rounded-md border p-4">
        <summary className="cursor-pointer font-medium">
          Consentimentos para e-mail ({emailConsents.filter((p) => !p.withdrawn_at).length}{" "}
          vigentes)
        </summary>
        <p className="mt-2 text-muted-foreground">
          Registrar consentimento é opcional para e-mail: as campanhas usam o e-mail salvo no card.
          Um descadastro registrado aqui continua bloqueando o endereço em campanhas futuras.
        </p>
        <div className="mt-3 max-h-72 divide-y overflow-y-auto">
          {emailConsents.map((p) => (
            <div key={p.id} className="py-2">
              <p className="break-words font-medium">
                {leadName.get(p.lead_id) ?? "Lead"} · {p.contact}
              </p>
              <p className="text-xs">
                {p.withdrawn_at ? (
                  <span className="text-destructive">
                    Descadastrado em {formatInZone(p.withdrawn_at, data.settings.timezone)}
                  </span>
                ) : (
                  <span className="text-emerald-700">Vigente</span>
                )}{" "}
                · Concedido em {formatInZone(p.granted_at, data.settings.timezone)} · Registrado em{" "}
                {formatInZone(p.recorded_at, data.settings.timezone)}
              </p>
              <p className="break-words text-xs text-muted-foreground">Origem: {p.evidence}</p>
            </div>
          ))}
          {!emailConsents.length && (
            <p className="py-2 text-muted-foreground">
              Nenhum consentimento ou descadastro de e-mail registrado.
            </p>
          )}
        </div>
      </details>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            await onChanged();
          })
        }
      >
        <RefreshCw className="size-4" />
        Atualizar dados do canal
      </Button>
    </section>
  );
}
