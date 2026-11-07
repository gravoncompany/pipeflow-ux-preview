import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { UIMessage } from "ai";
import { MessageSquare, FlaskConical, Brain, Link2, ScanText, MessagesSquare, Plus, Menu } from "lucide-react";
import { CrmSidebar } from "@/components/crm/CrmSidebar";
import { CrmAuthGate } from "@/components/crm/CrmAuthGate";
import { GravonTestChat, GravonChatPane, storedGravonPreferences, textOnlyMessages } from "@/components/crm/GravonTestChat";
import { GravonWhatsAppTest } from "@/components/crm/GravonWhatsAppTest";
import { GravonKnowledge } from "@/components/crm/GravonKnowledge";
import { GravonPortal } from "@/components/crm/GravonPortal";
import { ConversationAnalysesPanel } from "@/components/crm/ConversationAnalysesPanel";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { getGravonAiStatus } from "@/lib/gravon-ai.functions";
import { GRAVON_FLOATING_EVENT } from "@/components/crm/GravonFloatingChat";
import { loadOrCreateThreads, newThread, saveThreads, threadTitle, type GravonThread } from "@/lib/gravon-chat-threads";
import { cn } from "@/lib/utils";

const TABS = ["chat", "analises", "portal", "whatsapp", "knowledge", "tests"] as const;
type Tab = (typeof TABS)[number];

export const Route = createFileRoute("/gravon-ai")({
  validateSearch: (search: Record<string, unknown>): { tab?: Tab; c?: string } => ({
    tab: TABS.includes(search.tab as Tab) ? (search.tab as Tab) : undefined,
    c: typeof search.c === "string" && /^[a-z0-9-]{8,64}$/.test(search.c) ? search.c : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Pipeflow IA — Central de inteligência do Pipeflow" },
      { name: "description", content: "Chat com a Pipeflow IA, Análise de Conversas, conhecimento comercial, WhatsApp pessoal, Portal e testes internos." },
      { property: "og:title", content: "Pipeflow IA — Central de inteligência do Pipeflow" },
      { property: "og:description", content: "Converse com a Pipeflow IA e acesse as análises e o conhecimento comercial em um só lugar." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: GravonPage,
});

const MENU: { tab: Tab; label: string; icon: typeof MessageSquare }[] = [
  { tab: "chat", label: "Chat Pipeflow IA", icon: MessagesSquare },
  { tab: "analises", label: "Análise de Conversas", icon: ScanText },
  { tab: "portal", label: "Portal", icon: Link2 },
  { tab: "whatsapp", label: "Meu WhatsApp", icon: MessageSquare },
  { tab: "knowledge", label: "Conhecimento", icon: Brain },
  { tab: "tests", label: "Testes Internos", icon: FlaskConical },
];

function GravonPage() {
  const search = Route.useSearch();
  const tab: Tab = search.tab ?? "chat";
  const getStatus = useServerFn(getGravonAiStatus);
  const q = useQuery({ queryKey: ["gravon-ai-status"], queryFn: () => getStatus(), retry: false });
  const [limited, setLimited] = useState(false);
  if (q.isPending) return <div className="p-8 text-muted-foreground">Carregando...</div>;
  if (q.isError)
    return (
      <div className="p-8">
        <p>Não foi possível verificar o acesso.</p>
        <Button onClick={() => void q.refetch()}>Tentar novamente</Button>
      </div>
    );
  if (q.data?.needsAuth) {
    if (limited)
      return (
        <div className="flex min-h-screen bg-background">
          <CrmSidebar />
          <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
            <h1 className="text-xl font-semibold">Pipeflow IA · acesso completo</h1>
            <Button onClick={() => setLimited(false)}>Entrar novamente</Button>
          </main>
        </div>
      );
    return <CrmAuthGate onUnlock={(a) => { if (a.level === "full") void q.refetch(); else setLimited(true); }} />;
  }
  return <GravonHub tab={tab} threadParam={search.c} configured={q.data?.configured === true} />;
}

function GravonHub({ tab, threadParam, configured }: { tab: Tab; threadParam?: string; configured: boolean }) {
  const navigate = Route.useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [floatingOpen, setFloatingOpen] = useState(false);
  // Panels stay mounted after the first visit so switching options keeps their state.
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set([tab]));
  useEffect(() => setVisited((v) => (v.has(tab) ? v : new Set(v).add(tab))), [tab]);
  useEffect(() => {
    const handle = (event: Event) => { if (event instanceof CustomEvent) setFloatingOpen(event.detail === true); };
    window.addEventListener(GRAVON_FLOATING_EVENT, handle);
    return () => window.removeEventListener(GRAVON_FLOATING_EVENT, handle);
  }, []);

  // ---- conversation history (this browser) ----
  const [threads, setThreads] = useState<GravonThread[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    try { setThreads(loadOrCreateThreads(localStorage)); } catch { setThreads([newThread()]); }
  }, []);
  const activeId = threads?.some((t) => t.id === threadParam) ? threadParam! : threads?.[0]?.id;
  useEffect(() => {
    if (tab === "chat" && activeId && activeId !== threadParam)
      void navigate({ search: { tab: "chat", c: activeId }, replace: true });
  }, [tab, activeId, threadParam, navigate]);
  const update = useCallback((fn: (list: GravonThread[]) => GravonThread[]) => {
    setThreads((old) => {
      const next = fn(old ?? []);
      try { saveThreads(localStorage, next); } catch { /* storage full or blocked */ }
      return next;
    });
  }, []);
  const go = (next: Tab, c?: string) => { setMenuOpen(false); void navigate({ search: next === "chat" ? { tab: "chat", c } : { tab: next } }); };
  const startThread = () => {
    if (busy) return;
    const empty = threads?.find((t) => t.messages.length === 0);
    if (empty) return go("chat", empty.id);
    const t = newThread();
    update((list) => [t, ...list]);
    go("chat", t.id);
  };
  const onMessages = useCallback((id: string, messages: UIMessage[]) => {
    const kept = textOnlyMessages(messages) as GravonThread["messages"];
    update((list) => list.map((t) => {
      if (t.id !== id) return t;
      if (JSON.stringify(t.messages) === JSON.stringify(kept)) return t;
      return { ...t, messages: kept, title: threadTitle(kept), updatedAt: Date.now() };
    }).sort((a, b) => b.updatedAt - a.updatedAt));
  }, [update]);
  const removeThread = (id: string) => {
    if (!window.confirm("Apagar esta conversa deste navegador?")) return;
    const rest = (threads ?? []).filter((t) => t.id !== id);
    const list = rest.length ? rest : [newThread()];
    update(() => list);
    go("chat", list[0]!.id);
  };
  const active = threads?.find((t) => t.id === activeId);

  const menu = (
    <InternalMenu tab={tab} onSelect={(t) => go(t, t === "chat" ? activeId : undefined)}>
      {tab === "chat" && threads && (
        <div className="mt-4 min-h-0 flex-1 border-t pt-4">
          <Button className="w-full justify-start" variant="outline" size="sm" disabled={busy} onClick={startThread}>
            <Plus />Nova conversa
          </Button>
          <p className="mb-1 mt-4 px-2 text-xs font-medium text-muted-foreground">Conversas anteriores</p>
          <ul className="space-y-0.5">
            {threads.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  disabled={busy && t.id !== activeId}
                  onClick={() => go("chat", t.id)}
                  aria-current={t.id === activeId ? "page" : undefined}
                  className={cn(
                    "w-full truncate rounded-md px-2 py-1.5 text-left text-sm transition-colors disabled:opacity-50",
                    t.id === activeId ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                  title={t.title}
                >
                  {t.title}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-3 px-2 text-[11px] leading-snug text-muted-foreground">Histórico salvo neste navegador.</p>
        </div>
      )}
    </InternalMenu>
  );

  return (
    <div className="flex min-h-screen bg-background">
      <CrmSidebar />
      <aside className="hidden w-60 shrink-0 flex-col overflow-y-auto border-r bg-card px-3 py-5 lg:flex" aria-label="Menu da Pipeflow IA">
        {menu}
      </aside>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="flex w-72 flex-col overflow-y-auto px-3">
          <SheetHeader className="sr-only"><SheetTitle>Menu da Pipeflow IA</SheetTitle></SheetHeader>
          {menu}
        </SheetContent>
      </Sheet>
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b px-4 py-2 lg:hidden">
          <Button variant="ghost" size="icon" aria-label="Abrir menu da Pipeflow IA" onClick={() => setMenuOpen(true)}><Menu /></Button>
          <span className="truncate font-semibold">{MENU.find((m) => m.tab === tab)?.label}</span>
        </div>
        <Panel show={tab === "chat"} visited={visited.has("chat")} chat>
          {active ? (
            <GravonChatPane
              key={active.id}
              chatId={`gravon-chat-${active.id}`}
              initial={active.messages as UIMessage[]}
              configured={configured}
              preferences={storedGravonPreferences}
              title={active.title}
              emptyText="Converse sobre estratégia comercial, abordagens e o conhecimento comercial da Gravon."
              onMessages={(m) => onMessages(active.id, m)}
              onBusy={setBusy}
              onClear={() => removeThread(active.id)}
              className="mx-auto flex h-full min-h-0 w-full max-w-4xl flex-col"
              wide
            />
          ) : <p className="text-muted-foreground">Carregando...</p>}
          {!configured && <p role="alert" className="mt-2 text-center text-sm text-destructive">A conexão da Pipeflow IA não está configurada.</p>}
        </Panel>
        <Panel show={tab === "analises"} visited={visited.has("analises")}><ConversationAnalysesPanel /></Panel>
        <Panel show={tab === "portal"} visited={visited.has("portal")}><GravonPortal /></Panel>
        <Panel show={tab === "whatsapp"} visited={visited.has("whatsapp")}><GravonWhatsAppTest /></Panel>
        <Panel show={tab === "knowledge"} visited={visited.has("knowledge")}><GravonKnowledge /></Panel>
        <Panel show={tab === "tests"} visited={visited.has("tests")}>
          <div className="flex min-h-[600px] flex-col">
            {floatingOpen ? (
              <p className="text-sm text-muted-foreground">Conversa aberta no chat flutuante da Pipeflow IA.</p>
            ) : (
              <GravonTestChat configured={configured} />
            )}
          </div>
        </Panel>
      </main>
    </div>
  );
}

function Panel({ show, visited, chat = false, children }: { show: boolean; visited: boolean; chat?: boolean; children: ReactNode }) {
  if (!visited && !show) return null;
  return (
    <div
      hidden={!show}
      className={chat ? "h-[calc(100dvh-57px)] min-h-0 px-4 pb-4 pt-4 md:px-8 lg:h-dvh lg:[&_section>div:first-child]:pr-28" : "min-w-0 flex-1 p-4 md:p-8"}
    >
      {children}
    </div>
  );
}

function InternalMenu({ tab, onSelect, children }: { tab: Tab; onSelect: (tab: Tab) => void; children?: ReactNode }) {
  return (
    <nav className="flex min-h-0 flex-1 flex-col">
      <p className="mb-3 px-2 text-sm font-semibold">Pipeflow IA</p>
      <ul className="space-y-0.5">
        {MENU.map((item) => (
          <li key={item.tab}>
            <button
              type="button"
              onClick={() => onSelect(item.tab)}
              aria-current={tab === item.tab ? "page" : undefined}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm transition-colors",
                tab === item.tab ? "bg-primary text-primary-foreground" : "text-foreground/80 hover:bg-muted",
              )}
            >
              <item.icon className="size-4 shrink-0" />
              {item.label}
            </button>
          </li>
        ))}
      </ul>
      {children}
    </nav>
  );
}
