import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, LayoutGrid, List, Lock, Megaphone, PanelRightOpen, Search } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CAMPAIGN_SELECTION_KEY, conversationCampaignLeads, filterConversations, type ConversationKind } from "@/lib/campaign-recipients";
import { useTags } from "@/hooks/use-tags";
import { CrmSidebar } from "@/components/crm/CrmSidebar";
import { AtendimentoLayout } from "@/components/crm/AtendimentoLayout";
import { CrmAuthGate } from "@/components/crm/CrmAuthGate";
import { WhatsAppChat } from "@/components/crm/WhatsAppChat";
import { ConversationAnalysis } from "@/components/crm/ConversationAnalysis";
import { ConversationTaskSuggestions } from "@/components/crm/ConversationTaskSuggestions";
import { InstagramConversations } from "@/components/crm/InstagramConversations";
import { LeadDetailSheet } from "@/components/crm/LeadDetailSheet";
import { LeadAgentControl } from "@/components/crm/LeadAgentControl";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listConversations, type Conversation } from "@/lib/whatsapp-chat.functions";
import { useLeads } from "@/hooks/use-leads";
import { usePipelines } from "@/hooks/use-pipelines";
import { useStages } from "@/hooks/use-stages";

export const Route = createFileRoute("/whatsapp")({
  head: () => ({ meta: [
    { title: "Conversas — PipeFlow CRM" },
    { name: "description", content: "Conversas do WhatsApp e directs do Instagram em canais separados no CRM Gravon." },
    { property: "og:title", content: "Conversas — PipeFlow CRM" },
    { property: "og:description", content: "Histórico privado de WhatsApp e Instagram, com contatos registrados separadamente no CRM Gravon." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  // ?contato=<chave do contato>&conta=<conta WhatsApp> abre direto a conversa existente (ex.: ficha do cliente).
  validateSearch: (s: Record<string, unknown>): { contato?: string; conta?: string } => ({
    // Números na URL chegam como number (o roteador interpreta JSON); a chave é sempre tratada como texto.
    contato: (typeof s.contato === "string" || typeof s.contato === "number") && /^\d{8,20}$/.test(String(s.contato)) ? String(s.contato) : undefined,
    conta: typeof s.conta === "string" && s.conta.length <= 120 ? s.conta : undefined,
  }),
  component: ConversasPage,
});

const initials = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
const time = (iso: string) => { const d = new Date(iso); const today = new Date().toDateString() === d.toDateString(); return d.toLocaleString("pt-BR", today ? { hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "2-digit" }); };
const nameOf = (c: Conversation) => c.leadName || c.name || c.phone;

// Read markers only change the unread badge on this browser; they never authorize anything.
const SEEN_KEY = "pipeflow:wa-seen:v1";
function useSeen() {
  const [seen, setSeen] = useState<Record<string, string>>({});
  useEffect(() => { try { setSeen(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}") ?? {}); } catch { setSeen({}); } }, []);
  const mark = useCallback((key: string, at: string) => setSeen((old) => {
    if (old[key] && old[key] >= at) return old;
    const next = { ...old, [key]: at };
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(next)); } catch { /* storage full or blocked */ }
    return next;
  }), []);
  return { seen, mark };
}

function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  return <div className={`flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary ${size === "sm" ? "h-10 w-10 text-xs" : "h-12 w-12 text-sm"}`}>{initials(name)}</div>;
}

function ConversasPage() {
  const list = useServerFn(listConversations);
  const target = Route.useSearch();
  const [selected, setSelected] = useState<string | null>(null);
  // Link direto (?contato=) seleciona a conversa existente assim que a página abre.
  useEffect(() => { if (target.contato) setSelected(target.contato); }, [target.contato]);
  const [cardOpen, setCardOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [limited, setLimited] = useState(false);
  const [channel, setChannel] = useState("whatsapp");
  // Visualização, filtros e seleção ficam na página: alternar Cards/Lista não perde nada.
  const [view, setView] = useState<"cards" | "lista">("cards");
  const [kind, setKind] = useState<ConversationKind>("all");
  const [tag, setTag] = useState("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const { tags } = useTags();
  const { seen, mark } = useSeen();
  const q = useQuery({ queryKey: ["wa-convs"], queryFn: () => list(), refetchInterval: 10000 });
  const authorized = q.data ? !q.data.needsAuth : false;
  const { leads, upsertLead, deleteLead } = useLeads();
  const { pipelines } = usePipelines(authorized);
  const { stages: legacyStages } = useStages();

  const convs = q.data?.conversations ?? [];
  const current = convs.find((c) => c.phoneKey === selected) ?? null;
  const lead = current?.leadId ? leads.find((l) => l.id === current.leadId) ?? null : null;
  const pipeline = lead?.pipelineId ? pipelines.find((p) => p.id === lead.pipelineId) : null;
  const stageTitle = lead ? ((pipeline?.stages ?? legacyStages).find((s) => s.id === lead.stage)?.title ?? lead.stage) : null;
  const unread = (c: Conversation) => c.inboundSinceReply.filter((t) => !seen[c.phoneKey] || t > seen[c.phoneKey]).length;
  const leadById = useMemo(() => new Map(leads.map((l) => [l.id, l])), [leads]);
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const tagsByLead = new Map(leads.map((l) => [l.id, l.tags ?? []]));
    const filtered = filterConversations(convs, kind, tag, tagsByLead);
    return term ? filtered.filter((c) => `${nameOf(c)} ${c.phone} ${c.lastBody} ${c.clientName ?? ""} ${(c.leadId && leadById.get(c.leadId)?.company) || ""}`.toLowerCase().includes(term)) : filtered;
  }, [convs, search, kind, tag, leads, leadById]);
  const companyOf = (c: Conversation) => c.clientName || (c.leadId ? leadById.get(c.leadId)?.company : "") || "—";
  const statusOf = (c: Conversation) => unread(c) > 0 ? "Não lida" : c.inboundSinceReply.length > 0 ? "Aguardando resposta" : c.lastFromMe ? "Respondida" : "Em andamento";
  const allVisiblePicked = visible.length > 0 && visible.every((c) => picked.has(c.phoneKey));
  const togglePick = (key: string, on: boolean) => setPicked((old) => { const next = new Set(old); if (on) next.add(key); else next.delete(key); return next; });
  const toggleVisible = () => setPicked((old) => { const next = new Set(old); for (const c of visible) { if (allVisiblePicked) next.delete(c.phoneKey); else next.add(c.phoneKey); } return next; });
  const campaignPick = conversationCampaignLeads(convs, picked);
  const createCampaign = () => {
    if (!campaignPick.leadIds.length) return;
    const extra = campaignPick.outside ? `\n\n${campaignPick.outside} contato(s) fora do CRM não entram: a campanha usa os cards do CRM.` : "";
    if (extra && !window.confirm(`Criar campanha com ${campaignPick.leadIds.length} contato(s) do CRM?${extra}`)) return;
    try { sessionStorage.setItem(CAMPAIGN_SELECTION_KEY, JSON.stringify({ channel: "whatsapp", leadIds: campaignPick.leadIds })); } catch { /* storage blocked */ }
    window.location.href = "/campanhas/whatsapp";
  };

  // Opening a conversation marks it as read; the card opens only on an explicit click.
  useEffect(() => { if (current) mark(current.phoneKey, current.lastAt); }, [current?.phoneKey, current?.lastAt, mark]); // eslint-disable-line react-hooks/exhaustive-deps
  const select = (key: string) => { setSelected(key); setCardOpen(false); };
  const openFromList = (key: string) => { setView("cards"); select(key); };

  if (q.data?.needsAuth) {
    if (limited) return <div className="flex h-screen bg-background"><CrmSidebar /><main className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"><Lock className="h-8 w-8 text-muted-foreground" /><h1 className="text-xl font-semibold">Conversas restritas</h1><p className="text-sm text-muted-foreground">Entre com a senha de acesso completo.</p><Button onClick={() => setLimited(false)}>Entrar novamente</Button></main></div>;
    return <CrmAuthGate onUnlock={(a) => { if (a.level === "full") { void q.refetch(); window.location.reload(); } else setLimited(true); }} />;
  }

  return <AtendimentoLayout className="h-dvh min-h-0 overflow-hidden">
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-3 md:p-6">
      <header className="mb-4">
        <h1 className="text-2xl font-bold md:text-3xl">Conversas</h1>
        <p className="mt-1 text-sm text-muted-foreground">WhatsApp e Instagram</p>
      </header>
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <Tabs value={channel} onValueChange={setChannel}><TabsList aria-label="Canal de conversas"><TabsTrigger value="whatsapp">WhatsApp</TabsTrigger><TabsTrigger value="instagram">Instagram</TabsTrigger></TabsList></Tabs>
          {channel === "whatsapp" && <span className="text-xs text-muted-foreground">{convs.length} conversa{convs.length === 1 ? "" : "s"}</span>}
        </div>
        {channel === "whatsapp" && <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
          <div role="group" aria-label="Visualização" className="inline-flex rounded-md border p-0.5">
            <Button size="sm" variant={view === "cards" ? "default" : "ghost"} aria-pressed={view === "cards"} onClick={() => setView("cards")}><LayoutGrid />Cards</Button>
            <Button size="sm" variant={view === "lista" ? "default" : "ghost"} aria-pressed={view === "lista"} onClick={() => setView("lista")}><List />Lista</Button>
          </div>
          <Select value={kind} onValueChange={(v) => setKind(v as ConversationKind)}><SelectTrigger aria-label="Filtrar por tipo de contato" className="h-9 w-[190px]"><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="all">Todos os contatos</SelectItem><SelectItem value="clientes">Clientes cadastrados</SelectItem><SelectItem value="leads">Leads</SelectItem><SelectItem value="fora">Fora do CRM</SelectItem>
          </SelectContent></Select>
          <Select value={tag} onValueChange={setTag}><SelectTrigger aria-label="Filtrar por etiqueta" className="h-9 w-[170px]"><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="all">Todas as etiquetas</SelectItem>{tags.map((t) => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}
          </SelectContent></Select>
          <div className="ml-auto flex items-center gap-2">
            {picked.size > 0 && <><span className="text-xs text-muted-foreground">{picked.size} selecionado{picked.size === 1 ? "" : "s"}</span><Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Limpar</Button></>}
            <Button size="sm" disabled={!campaignPick.leadIds.length} title={picked.size && !campaignPick.leadIds.length ? "Os contatos selecionados não têm card no CRM." : undefined} onClick={createCampaign}><Megaphone />Criar campanha de WhatsApp</Button>
          </div>
        </div>}
        {channel === "instagram" ? <InstagramConversations /> : view === "lista" ? <div className="min-h-0 flex-1 overflow-auto">
          <div className="border-b p-2.5"><div className="relative max-w-md"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input aria-label="Buscar conversa" placeholder="Buscar nome, telefone, empresa ou mensagem" className="h-9 rounded-lg border-0 bg-muted pl-9" value={search} onChange={(e) => setSearch(e.target.value)} /></div></div>
          <table className="w-full min-w-[760px] text-sm">
            <thead className="sticky top-0 z-10 bg-card text-left text-xs text-muted-foreground"><tr className="border-b">
              <th className="w-10 px-3 py-2"><Checkbox aria-label="Selecionar todos os visíveis" checked={allVisiblePicked} disabled={!visible.length} onCheckedChange={toggleVisible} /></th>
              <th className="px-2 py-2 font-medium">Nome</th><th className="px-2 py-2 font-medium">Telefone</th><th className="px-2 py-2 font-medium">Empresa</th><th className="px-2 py-2 font-medium">Última mensagem</th><th className="px-2 py-2 font-medium">Status</th>
            </tr></thead>
            <tbody>{q.isPending ? <tr><td colSpan={6} className="p-4 text-muted-foreground">Carregando...</td></tr> : visible.length === 0 ? <tr><td colSpan={6} className="p-4 text-muted-foreground">{convs.length ? "Nenhuma conversa encontrada." : "Nenhuma mensagem recebida ainda."}</td></tr> : visible.map((c) => {
              const status = statusOf(c);
              return <tr key={c.phoneKey} className={`border-b hover:bg-muted/50 ${picked.has(c.phoneKey) ? "bg-accent/60" : ""}`}>
                <td className="px-3 py-2"><Checkbox aria-label={`Selecionar ${nameOf(c)}`} checked={picked.has(c.phoneKey)} onCheckedChange={(v) => togglePick(c.phoneKey, v === true)} /></td>
                <td className="px-2 py-2"><button className="text-left font-medium hover:text-primary hover:underline" onClick={() => openFromList(c.phoneKey)}>{nameOf(c)}</button><span className="block text-[11px] text-muted-foreground">{c.clientId ? "Cliente" : c.leadId ? "Lead" : "Fora do CRM"}</span></td>
                <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">{c.phone}</td>
                <td className="px-2 py-2">{companyOf(c)}</td>
                <td className="max-w-[280px] px-2 py-2"><p className="truncate text-muted-foreground">{c.lastFromMe ? "Você: " : ""}{c.lastBody || "—"}</p><span className="text-[11px] text-muted-foreground">{time(c.lastAt)}</span></td>
                <td className="whitespace-nowrap px-2 py-2"><span className={`rounded-full px-2 py-0.5 text-xs ${status === "Não lida" ? "bg-wa/15 font-semibold text-wa-strong" : status === "Aguardando resposta" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>{status}</span></td>
              </tr>;
            })}</tbody>
          </table>
        </div> : <div className="relative flex min-h-0 flex-1">
          {/* Lista de conversas */}
          <div className={`min-h-0 w-full flex-col border-r md:w-[280px] xl:w-[340px] ${current ? "hidden" : "flex"} ${cardOpen ? "xl:flex" : "md:flex"}`}>
            <div className="border-b p-2.5">
              <div className="relative"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input aria-label="Buscar conversa" placeholder="Pesquisar ou começar uma conversa" className="h-9 rounded-lg border-0 bg-muted pl-9" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {q.isPending ? <p className="p-4 text-sm text-muted-foreground">Carregando...</p> : visible.length === 0 ? <p className="p-4 text-sm text-muted-foreground">{convs.length ? "Nenhuma conversa encontrada." : "Nenhuma mensagem recebida ainda."}</p> : visible.map((c) => {
                const n = unread(c);
                const active = current?.phoneKey === c.phoneKey;
                return <button key={c.phoneKey} onClick={() => select(c.phoneKey)} aria-current={active ? "true" : undefined}
                  className={`flex w-full items-center gap-3 px-3 text-left transition-colors hover:bg-muted/70 ${active ? "bg-accent" : ""}`}>
                  <Avatar name={nameOf(c)} />
                  <div className="min-w-0 flex-1 border-b py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-[15px] font-medium">{nameOf(c)}</p>
                      <span className={`shrink-0 text-[11px] ${n ? "font-semibold text-wa-strong" : "text-muted-foreground"}`}>{time(c.lastAt)}</span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <p className="truncate text-[13px] text-muted-foreground">{c.lastFromMe ? "Você: " : ""}{c.lastBody || "—"}</p>
                      {n > 0 && <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-wa px-1.5 text-[11px] font-semibold text-primary-foreground" aria-label={`${n} não lidas`}>{n > 99 ? "99+" : n}</span>}
                    </div>
                    {c.clientId ? <p className="mt-0.5 text-[11px] text-primary">Cliente · {c.clientName}</p> : !c.leadId && <p className="mt-0.5 text-[11px] text-muted-foreground">Fora do CRM</p>}
                  </div>
                </button>;
              })}
            </div>
          </div>

          {/* Conversa aberta */}
          {current ? <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center gap-3 border-b bg-muted/60 px-3 py-2">
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Voltar para a lista" onClick={() => setSelected(null)}><ArrowLeft /></Button>
              <Avatar name={nameOf(current)} size="sm" />
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{nameOf(current)}</p><p className="truncate text-xs text-muted-foreground">{current.phone}{stageTitle ? ` · ${stageTitle}` : ""}{target.conta && target.contato === current.phoneKey ? ` · Conta ${target.conta}` : ""}</p></div>
              {lead && (cardOpen
                ? <Button size="sm" variant="outline" onClick={() => setCardOpen(false)}>Fechar card</Button>
                : <Button size="sm" onClick={() => setCardOpen(true)}><PanelRightOpen />Abrir card</Button>)}
            </div>
            <WhatsAppChat key={current.phoneKey} phone={current.phone} className="min-h-0 flex-1 rounded-none border-0" showAnalysis={false} />
          </div> : <div className="hidden flex-1 flex-col items-center justify-center gap-2 bg-wa-wallpaper p-10 text-center md:flex">
            <p className="text-lg font-medium">PipeFlow Conversas</p>
            <p className="max-w-sm text-sm text-muted-foreground">Selecione uma conversa para ver as mensagens. O card do lead só abre quando você clicar em "Abrir card".</p>
          </div>}

          {/* Painel lateral: resumo padrão ou card completo */}
          {current && (cardOpen && lead
            ? <aside className="fixed inset-0 z-50 flex flex-col border-l bg-background lg:static lg:z-auto lg:w-[400px] lg:shrink-0 xl:w-[440px]" aria-label="Card do lead">
                <LeadDetailSheet inline open lead={lead} isNew={false} onOpenChange={(v) => { if (!v) setCardOpen(false); }}
                  onSave={(l) => void upsertLead(l)} onDelete={(id) => { void deleteLead(id); setCardOpen(false); }}
                  pipelineId={lead.pipelineId} pipelineStages={pipeline?.stages} pipelines={pipelines} />
              </aside>
            : <aside className="hidden min-h-0 w-[300px] shrink-0 space-y-4 overflow-y-auto border-l p-4 lg:block xl:w-[360px]" aria-label="Resumo do contato">
                <div className="flex flex-col items-center text-center">
                  <Avatar name={nameOf(current)} />
                  <p className="mt-2 font-semibold">{nameOf(current)}</p>
                  <p className="text-xs text-muted-foreground">{current.phone}</p>
                </div>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Funil</dt><dd className="text-right">{lead ? (pipeline?.name ?? (lead.pipelineId ? "Funil" : "Funil principal")) : "Fora do CRM"}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Etapa</dt><dd className="text-right">{stageTitle ?? "—"}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Mensagens</dt><dd>{current.count}</dd></div>
                </dl>
                <LeadAgentControl phone={current.phone} compact />
                {lead && <Button className="w-full" variant="outline" onClick={() => setCardOpen(true)}><PanelRightOpen />Abrir card</Button>}
                <div className="-mx-4 border-t"><ConversationAnalysis key={current.phoneKey} phone={current.phone} /></div>
                <ConversationTaskSuggestions key={`t-${current.phoneKey}`} phone={current.phone} />
              </aside>)}
        </div>}
      </section>
    </main>
  </AtendimentoLayout>;
}
