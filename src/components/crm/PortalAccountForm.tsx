import { useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PortalAccountForm() {
  const [mode, setMode] = useState<"login" | "signup" | "recovery">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const queries = useQueryClient();
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (mode === "recovery") {
        const result = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (result.error) throw result.error;
        setMessage("Se a conta existir, você receberá um link para redefinir sua senha.");
      } else if (mode === "signup") {
        const result = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth` },
        });
        if (result.error) throw result.error;
        setPassword("");
        setMessage(
          "Confira seu e-mail e confirme o cadastro. A confirmação não concede permissão administrativa; a liberação é separada.",
        );
      } else {
        const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (result.error) throw result.error;
        const verified = await supabase.auth.getUser();
        if (verified.error || !verified.data.user?.email_confirmed_at)
          throw new Error("Unverified");
        setPassword("");
        await queries.invalidateQueries();
        await navigate({ to: "/gravon-ai", search: { tab: "portal" } });
      }
    } catch {
      setError(
        mode === "login"
          ? "Não foi possível entrar. Confira o e-mail, a senha e a confirmação do cadastro."
          : "Não foi possível enviar o e-mail. Tente novamente mais tarde; use uma senha forte no cadastro.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="max-w-md space-y-5">
      <div className="flex flex-wrap gap-2">
        {(["login", "signup", "recovery"] as const).map((value) => (
          <Button
            key={value}
            variant={mode === value ? "default" : "outline"}
            onClick={() => {
              setMode(value);
              setError("");
              setMessage("");
              setPassword("");
            }}
          >
            {value === "login" ? "Entrar" : value === "signup" ? "Criar conta" : "Esqueci a senha"}
          </Button>
        ))}
      </div>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="account-email">E-mail da conta</Label>
          <Input
            id="account-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        {mode !== "recovery" && (
          <div className="space-y-2">
            <Label htmlFor="account-password">Senha individual</Label>
            <Input
              id="account-password"
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              minLength={mode === "signup" ? 12 : undefined}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
        )}
        {message && (
          <p role="status" className="text-sm text-muted-foreground">
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy}>
          {busy
            ? "Aguarde..."
            : mode === "login"
              ? "Acessar conta"
              : mode === "signup"
                ? "Cadastrar e confirmar e-mail"
                : "Enviar link de recuperação"}
        </Button>
      </form>
    </div>
  );
}
