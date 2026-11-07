import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Minus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PipeflowSymbol } from "@/components/brand/PipeflowLogo";
import { getGravonAiStatus } from "@/lib/gravon-ai.functions";
import { getStoredAccess } from "./CrmAuthGate";
import { GravonTestChat } from "./GravonTestChat";

export const GRAVON_FLOATING_EVENT = "gravon-floating-chat";

export function GravonFloatingChat() {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    setAllowed(getStoredAccess()?.level === "full");
  }, []);
  return allowed ? <FloatingChat /> : null;
}

function FloatingChat() {
  const [open, setOpen] = useState(false);
  const getStatus = useServerFn(getGravonAiStatus);
  const status = useQuery({
    queryKey: ["gravon-ai-status"],
    queryFn: () => getStatus(),
    enabled: open,
    retry: false,
  });
  const changeOpen = (value: boolean) => {
    window.dispatchEvent(new CustomEvent(GRAVON_FLOATING_EVENT, { detail: value }));
    setOpen(value);
  };
  useEffect(
    () => () => {
      window.dispatchEvent(new CustomEvent(GRAVON_FLOATING_EVENT, { detail: false }));
    },
    [],
  );
  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <Button
          className="fixed bottom-5 right-4 z-40 size-16 rounded-full bg-background p-0 text-primary shadow-lg ring-1 ring-border transition-transform hover:scale-105 motion-reduce:transition-none md:right-6"
          aria-label="Abrir Pipeflow IA"
          title="Pipeflow IA — seu assistente de IA no Pipeflow"
        >
          <PipeflowSymbol alt="" className="size-11" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        sideOffset={12}
        onInteractOutside={(event) => event.preventDefault()}
        className="flex h-[min(640px,calc(100dvh-145px))] w-[min(420px,calc(100vw-24px))] flex-col overflow-hidden rounded-lg border p-0 shadow-lg"
        role="dialog"
        aria-label="Chat da Pipeflow IA"
      >
        <header className="flex shrink-0 items-center gap-3 border-b bg-muted/40 px-4 py-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-background ring-1 ring-border">
            <PipeflowSymbol alt="" className="size-8" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">Pipeflow IA</h2>
            <p className="text-xs text-muted-foreground">Seu assistente de IA no Pipeflow</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            title="Minimizar chat"
            aria-label="Minimizar chat"
            onClick={() => changeOpen(false)}
          >
            <Minus className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            title="Fechar chat"
            aria-label="Fechar chat"
            onClick={() => changeOpen(false)}
          >
            <X className="size-4" />
          </Button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col p-4">
          {status.isPending ? (
            <p className="text-sm text-muted-foreground">Conectando…</p>
          ) : status.isError ? (
            <div role="alert">
              <p className="mb-3 text-sm text-destructive">Não foi possível conectar ao chat.</p>
              <Button variant="outline" onClick={() => void status.refetch()}>
                Tentar novamente
              </Button>
            </div>
          ) : status.data.needsAuth ? (
            <p role="alert" className="text-sm text-destructive">
              Entre novamente com acesso completo para conversar.
            </p>
          ) : !status.data.configured ? (
            <p role="alert" className="text-sm text-destructive">
              A conexão com a OpenAI não está configurada.
            </p>
          ) : (
            <GravonTestChat configured compact />
          )}
        </div>
        <p className="shrink-0 border-t py-1.5 text-center text-[10px] text-muted-foreground/80">Desenvolvido pela Gravon Company</p>
      </PopoverContent>
    </Popover>
  );
}
