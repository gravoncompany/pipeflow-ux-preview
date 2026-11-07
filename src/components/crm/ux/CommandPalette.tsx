import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Building2, CornerDownLeft, FileText, Search, Wallet } from "lucide-react";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { listClients } from "@/lib/crm-clients.functions";
import { PAGE_CATALOG } from "./nav-catalog";

export const OPEN_PALETTE_EVENT = "pipeflow:open-palette";
export const openCommandPalette = () => window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));

/**
 * Busca global (Ctrl+K / ⌘K): telas do sistema e clientes.
 * Montada só dentro do menu do CRM (atrás do portão). Clientes são lidos pela mesma função
 * protegida da tela Clientes, só quando a busca é aberta; sem sessão, mostra apenas as telas.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((v) => !v); }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener(OPEN_PALETTE_EVENT, onOpen); };
  }, []);
  const clients = useQuery({ queryKey: ["crm-clients"], queryFn: () => listClients(), enabled: open, retry: false, staleTime: 60_000 });
  const list = useMemo(() => ((clients.data?.clients ?? []) as { id: string; trade_name: string; legal_name?: string | null; cnpj?: string | null; contact_name?: string | null }[]), [clients.data]);
  const go = (to: string, extra?: Record<string, unknown>) => { setOpen(false); void navigate({ to, ...(extra ?? {}) } as never); };
  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Buscar telas, clientes, CNPJ…" />
      <CommandList className="max-h-[60vh]">
        <CommandEmpty>Nada encontrado.</CommandEmpty>
        {list.length > 0 && (
          <CommandGroup heading="Clientes">
            {list.slice(0, 400).map((c) => (
              <CommandItem key={c.id} value={`cliente ${c.trade_name} ${c.legal_name ?? ""} ${c.cnpj ?? ""} ${c.contact_name ?? ""} ${c.id}`} onSelect={() => go("/clientes/$id", { params: { id: c.id }, search: { aba: undefined } })}>
                <Building2 className="size-4" />
                <span className="min-w-0 flex-1 truncate">{c.trade_name}{c.legal_name && c.legal_name !== c.trade_name ? <span className="ml-2 text-xs text-muted-foreground">{c.legal_name}</span> : null}</span>
                <button type="button" className="rounded px-1.5 py-0.5 text-xs text-primary hover:bg-primary/10" onClick={(e) => { e.stopPropagation(); go("/financeiro/recebimentos", { search: { cliente: c.id } }); }} title="Recebimentos deste cliente">
                  <Wallet className="inline size-3" /> Recebimentos
                </button>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandSeparator />
        <CommandGroup heading="Telas">
          {PAGE_CATALOG.map((p) => (
            <CommandItem key={`${p.to}|${p.label}`} value={`${p.label} ${p.area} ${p.keywords ?? ""} ${p.to}`} onSelect={() => go(p.to)}>
              <FileText className="size-4" />
              <span className="flex-1">{p.label}</span>
              <span className="text-xs text-muted-foreground">{p.area}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
      <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><Search className="size-3" /> Ctrl+K abre de qualquer tela</span>
        <span className="inline-flex items-center gap-1"><CornerDownLeft className="size-3" /> abrir</span>
      </div>
    </CommandDialog>
  );
}
