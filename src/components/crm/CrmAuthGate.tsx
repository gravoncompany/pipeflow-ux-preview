import { useState, type FormEvent } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";
import { PipeflowLogo } from "@/components/brand/PipeflowLogo";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { StageId } from "@/lib/crm-types";
import { useServerFn } from "@tanstack/react-start";
import { unlockCrm } from "@/lib/crm-auth.functions";
import { setPreviewSessionToken } from "@/lib/crm-preview-session";

export type CrmAccess = {
  level: "limited" | "full";
  allowedStages: StageId[] | "all";
};

const STORAGE_KEY = "crm-access-level";

const LIMITED_STAGES: StageId[] = [
  "tentando-contato",
  "contato-realizado",
  "primeira-ligacao",
  "segunda-ligacao",
  "terceira-ligacao",
];

export function getStoredAccess(): CrmAccess | null {
  if (typeof window === "undefined") return null;
  const v = window.sessionStorage.getItem(STORAGE_KEY);
  if (v === "full") return { level: "full", allowedStages: "all" };
  if (v === "limited") return { level: "limited", allowedStages: LIMITED_STAGES };
  return null;
}

export function clearStoredAccess() {
  window.sessionStorage.removeItem(STORAGE_KEY);
  setPreviewSessionToken(null);
}

export function CrmAuthGate({ onUnlock }: { onUnlock: (access: CrmAccess) => void }) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const unlock = useServerFn(unlockCrm);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await unlock({ data: { password } });
      if (result.level === "full" || result.level === "limited") {
        setPreviewSessionToken("previewToken" in result ? result.previewToken : null);
        window.sessionStorage.setItem(STORAGE_KEY, result.level);
        onUnlock({ level: result.level, allowedStages: result.level === "full" ? "all" : LIMITED_STAGES });
      } else setError(result.error || "Senha incorreta");
    } catch {
      setError("Não foi possível entrar. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-sm"
      >
        <div className="mb-5">
          <PipeflowLogo symbolClassName="h-11 w-11" textClassName="text-xl" />
          <p className="mt-2 text-xs text-muted-foreground">Acesso restrito</p>
        </div>

        <Label htmlFor="crm-password" className="text-xs font-medium">
          Senha de acesso
        </Label>
        <div className="relative mt-1.5">
          <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="crm-password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError("");
            }}
            placeholder="Digite a senha"
            className="pl-9 pr-12"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 size-8 -translate-y-1/2 text-muted-foreground"
            onClick={() => setShowPassword((visible) => !visible)}
            aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
            title={showPassword ? "Ocultar senha" : "Mostrar senha"}
            aria-pressed={showPassword}
            aria-controls="crm-password"
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </Button>
        </div>
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

        <Button type="submit" className="mt-4 w-full" disabled={loading}>
          {loading ? "Entrando..." : "Entrar"}
        </Button>
      </form>
    </div>
  );
}
