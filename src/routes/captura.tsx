import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { PipeflowSymbol } from "@/components/brand/PipeflowLogo";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { WHATSAPP_CONSENT_TEXT, contactFormSchema } from "@/lib/contact-form";

export const Route = createFileRoute("/captura")({
  head: () => ({
    meta: [
      { title: "Fale com nosso time | PipeFlow CRM" },
      { name: "description", content: "Preencha o formulário e nossa equipe entrará em contato." },
      { property: "og:title", content: "Fale com nosso time | PipeFlow CRM" },
      { property: "og:description", content: "Envie seus dados para conversar com a equipe comercial." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CapturaPage,
});

function CapturaPage() {
  const [form, setForm] = useState({ name: "", company: "", email: "", whatsapp: "", service: "", notes: "" });
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [whatsappConsent, setWhatsappConsent] = useState(false);
  const [submissionId, setSubmissionId] = useState("");

  const onChange = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!form.name.trim()) { setError("Informe seu nome."); return; }
    if (!form.email.trim() && !form.whatsapp.trim()) { setError("Informe e-mail ou WhatsApp."); return; }
    const id = submissionId || crypto.randomUUID(); setSubmissionId(id);
    const parsed = contactFormSchema.safeParse({ ...form, whatsappConsent, submissionId: id, landingUrl: window.location.href });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Confira seus dados."); return; }
    setLoading(true);
    try {
      const response = await fetch("/api/public/forms/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
      if (!response.ok) throw new Error("save_failed");
      setDone(true);
    } catch { setError("Não foi possível enviar. Tente novamente."); }
    finally { setLoading(false); }
  };

  if (done) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-success">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold">Recebemos seu contato!</h1>
          <p className="mt-2 text-sm text-muted-foreground">Nossa equipe responderá em breve.</p>
          <Button className="mt-6" onClick={() => { setForm({ name: "", company: "", email: "", whatsapp: "", service: "", notes: "" }); setWhatsappConsent(false); setSubmissionId(""); setDone(false); }}>
            Enviar outro
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 px-4 py-12">
      <div className="mx-auto max-w-lg">
        <div className="mb-6 flex items-center gap-3">
          <PipeflowSymbol className="h-11 w-11" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Fale com nosso time</h1>
            <p className="text-sm text-muted-foreground">Preencha e entraremos em contato.</p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4 rounded-2xl border bg-card p-6 shadow-sm">
          <Field label="Nome *"><Input value={form.name} onChange={onChange("name")} required maxLength={120} /></Field>
          <Field label="Empresa"><Input value={form.company} onChange={onChange("company")} maxLength={120} /></Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="E-mail"><Input type="email" value={form.email} onChange={onChange("email")} maxLength={160} /></Field>
            <Field label="WhatsApp"><Input value={form.whatsapp} onChange={onChange("whatsapp")} maxLength={40} /></Field>
          </div>
          <Field label="Serviço de interesse"><Input value={form.service} onChange={onChange("service")} maxLength={160} /></Field>
          <Field label="Mensagem"><Textarea rows={4} value={form.notes} onChange={onChange("notes")} maxLength={2000} /></Field>
          <div className="flex items-start gap-3"><Checkbox id="whatsapp-consent" checked={whatsappConsent} onCheckedChange={value => setWhatsappConsent(value === true)} className="mt-1" /><Label htmlFor="whatsapp-consent" className="text-sm font-normal leading-relaxed">{WHATSAPP_CONSENT_TEXT}</Label></div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Enviando..." : "Enviar contato"}
          </Button>
        </form>
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
