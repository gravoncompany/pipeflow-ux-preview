import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

export type ConfirmRequest = { title: string; description?: ReactNode; details?: [string, ReactNode][]; confirmLabel?: string; destructive?: boolean };
type Ask = (req: ConfirmRequest) => Promise<boolean>;
const Ctx = createContext<Ask | null>(null);

/**
 * Substitui `window.confirm` por um diálogo do sistema que mostra o resumo da operação
 * (cliente, valor, conta…) antes de confirmar. Fora do provider, recorre ao confirm nativo.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<ConfirmRequest | null>(null);
  const resolver = useRef<(v: boolean) => void>(() => undefined);
  const ask = useCallback<Ask>((r) => new Promise((resolve) => { resolver.current = resolve; setReq(r); }), []);
  const close = (v: boolean) => { resolver.current(v); setReq(null); };
  return (
    <Ctx.Provider value={ask}>
      {children}
      <AlertDialog open={!!req} onOpenChange={(o) => { if (!o) close(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{req?.title}</AlertDialogTitle>
            {req?.description && <AlertDialogDescription>{req.description}</AlertDialogDescription>}
          </AlertDialogHeader>
          {req?.details && req.details.length > 0 && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-md border bg-muted/40 p-3 text-sm">
              {req.details.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="font-medium tabular-nums">{v}</dd></div>)}
            </dl>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => close(false)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction className={req?.destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined} onClick={() => close(true)}>{req?.confirmLabel ?? "Confirmar"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Ctx.Provider>
  );
}

export function useConfirm(): Ask {
  const ask = useContext(Ctx);
  return ask ?? (async (r) => window.confirm([r.title, typeof r.description === "string" ? r.description : ""].filter(Boolean).join("\n\n")));
}
