import { createFileRoute, Link } from "@tanstack/react-router";
import { PipeflowLogo } from "@/components/brand/PipeflowLogo";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Recuperar acesso individual — Gravon AI" },
      { name: "description", content: "Redefinição segura da senha individual da Gravon AI." },
      { property: "og:title", content: "Recuperar acesso individual — Gravon AI" },
      {
        property: "og:description",
        content: "Recupere sua conta individual com o link enviado por e-mail.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPassword,
});
function ResetPassword() {
  const [recovery, setRecovery] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    // Capture the authenticated recovery-link intent, never ordinary signed-in password changes.
    setRecovery(
      new URLSearchParams(window.location.hash.slice(1)).get("type") === "recovery" ||
        sessionStorage.getItem("portal-recovery-intent") === "true",
    );
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!recovery || password !== confirm) {
      setError("As senhas precisam coincidir; abra o link de recuperação recebido por e-mail.");
      return;
    }
    setBusy(true);
    setError("");
    const user = await supabase.auth.getUser();
    if (user.error || !user.data.user) {
      setError("Link inválido ou expirado. Solicite outro link de recuperação.");
      setBusy(false);
      return;
    }
    const result = await supabase.auth.updateUser({ password });
    if (result.error)
      setError("Não foi possível redefinir a senha. Use uma senha forte ou solicite outro link.");
    else {
      setPassword("");
      setConfirm("");
      setDone(true);
      sessionStorage.removeItem("portal-recovery-intent");
    }
    setBusy(false);
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-12">
      <PipeflowLogo symbolClassName="h-11 w-11" textClassName="text-xl" />
      <h1 className="text-2xl font-bold">Nova senha individual</h1>
      {done ? (
        <p role="status">Senha atualizada.</p>
      ) : recovery ? (
        <form onSubmit={submit} className="space-y-4">
          <Label htmlFor="new-password">Nova senha</Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <Label htmlFor="confirm-password">Confirmar nova senha</Label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button disabled={busy} type="submit">
            {busy ? "Salvando..." : "Salvar nova senha"}
          </Button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">
          Abra o link de recuperação enviado ao seu e-mail. Um acesso comum não permite redefinir a
          senha aqui.
        </p>
      )}
      <Link to="/auth" className="text-primary">
        Voltar ao acesso individual
      </Link>
    </main>
  );
}
