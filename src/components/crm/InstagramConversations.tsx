import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Instagram, RefreshCw, ArrowLeft, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getInstagram, getInstagramConversation } from "@/lib/instagram.functions";

const time = (value: string | null) => value ? new Date(value).toLocaleString("pt-BR") : "Não disponível";

export function InstagramConversations() {
  const fetchOverview = useServerFn(getInstagram);
  const fetchConversation = useServerFn(getInstagramConversation);
  const [selected, setSelected] = useState("");
  const [accountId, setAccountId] = useState("");
  const overview = useQuery({ queryKey: ["instagram-overview"], queryFn: () => fetchOverview(), retry: false, refetchInterval: 10000 });
  const data = overview.data && !overview.data.needsAuth ? overview.data : undefined;
  const contacts = data?.contacts.filter(c => !accountId || c.account_id === accountId) ?? [];
  const current = contacts.find(c => c.id === selected);
  const conversation = useQuery({ queryKey: ["instagram-conversation", current?.id], queryFn: () => fetchConversation({ data: { contactId: current?.id ?? "" } }), enabled: Boolean(current) && Boolean(data), retry: false, refetchInterval: 8000 });

  if (overview.isPending) return <p className="p-6 text-sm text-muted-foreground">Carregando Instagram…</p>;
  if (overview.isError || overview.data?.needsAuth) return <div className="p-6"><h2 className="font-semibold">Acesso ao Instagram necessário</h2><p className="my-3 text-sm text-muted-foreground">Entre com sua conta administrativa e o acesso completo do CRM.</p><Button asChild><Link to="/auth">Entrar com minha conta</Link></Button></div>;

  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <select aria-label="Filtrar conta Instagram" className="max-w-full rounded-md border bg-background px-2 py-1 text-sm" value={accountId} onChange={e => { setAccountId(e.target.value); setSelected(""); }}>
          <option value="">Todas as contas</option>{data?.accounts.map(a => <option key={a.id} value={a.id}>@{a.username}</option>)}
        </select>
        <span className="text-xs text-muted-foreground">{contacts.length} contato{contacts.length === 1 ? "" : "s"} · {data?.storage.messages ?? "—"} mensagens no CRM</span>
      </div>
      <div className="flex gap-2"><Button asChild variant="ghost" size="sm"><Link to="/configuracoes/integracoes/instagram"><Settings className="size-4" />Conexão</Link></Button><Button variant="outline" size="icon" title="Atualizar directs" aria-label="Atualizar directs" disabled={overview.isFetching} onClick={() => { void overview.refetch(); if (current) void conversation.refetch(); }}><RefreshCw className={overview.isFetching ? "animate-spin" : ""} /></Button></div>
    </div>
    <div className="grid min-h-0 flex-1 lg:grid-cols-[300px_1fr_260px]">
      <div className={`min-h-0 overflow-y-auto border-r ${current ? "hidden lg:block" : ""}`}>
        {!contacts.length ? <div className="p-5"><Instagram className="mb-3 size-6 text-muted-foreground" /><p className="text-sm">Nenhum direct gravado.</p><p className="mt-2 text-xs text-muted-foreground">Última gravação: {time(data?.storage.latestReceivedAt ?? null)}</p>{!data?.accounts.length && <p className="mt-2 text-sm text-destructive">Nenhuma conta vinculada ao CRM.</p>}</div> : contacts.map(c => <Button key={c.id} variant="ghost" className={`h-auto w-full justify-start rounded-none border-b p-4 text-left ${current?.id === c.id ? "bg-muted" : ""}`} onClick={() => setSelected(c.id)}><div className="min-w-0"><p className="break-all text-sm font-semibold">Instagram · {c.sender_id}</p><p className="mt-1 text-xs font-normal text-muted-foreground">@{data?.accounts.find(a => a.id === c.account_id)?.username} · Contato no CRM</p><p className="mt-2 text-xs font-normal text-muted-foreground">{time(c.last_inbound_at)}</p></div></Button>)}
        {data && data.storage.contacts !== null && data.storage.contacts > data.contacts.length && <p className="p-4 text-xs text-muted-foreground">Exibindo os {data.contacts.length} contatos mais recentes de {data.storage.contacts}.</p>}
      </div>
      {current ? <>
        <div className="flex min-h-0 flex-col">
          <header className="flex items-center gap-3 border-b p-4"><Button variant="ghost" size="icon" className="lg:hidden" aria-label="Voltar aos directs" onClick={() => setSelected("")}><ArrowLeft /></Button><Instagram className="size-5 shrink-0 text-primary" /><div className="min-w-0"><h2 className="break-all text-sm font-semibold">Instagram · {current.sender_id}</h2><p className="text-xs text-muted-foreground">@{data?.accounts.find(a => a.id === current.account_id)?.username}</p></div></header>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4" aria-label="Histórico Instagram">
            {conversation.isPending ? <p className="text-sm text-muted-foreground">Carregando conversa…</p> : conversation.isError ? <p role="alert" className="text-sm text-destructive">Não foi possível consultar a conversa.</p> : conversation.data?.messages.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma mensagem gravada.</p> : conversation.data?.messages.map(m => <article key={m.id} className={`max-w-[90%] rounded-md border p-3 ${m.from_me ? "self-end bg-muted" : "self-start bg-card"}`}><p className="mb-1 text-xs font-medium text-muted-foreground">{m.from_me ? "Sua conta" : "Contato Instagram"}</p><p className="whitespace-pre-wrap break-words text-sm">{m.kind === "deleted" ? "Mensagem removida" : m.body || (m.kind === "attachment" ? "Anexo recebido" : "Evento sem texto")}</p><p className="mt-2 text-xs text-muted-foreground">{time(m.sent_at)}{m.send_state === "accepted" ? " · Aceita pela Meta, entrega não confirmada" : ""}</p></article>)}
          </div>
        </div>
        <aside className="hidden overflow-y-auto border-l p-4 lg:block"><h3 className="mb-4 text-sm font-semibold">Registro no CRM</h3><dl className="space-y-4 text-sm"><div><dt className="text-muted-foreground">Origem</dt><dd>Instagram</dd></div><div><dt className="text-muted-foreground">Identificador do contato</dt><dd className="break-all">{current.sender_id}</dd></div><div><dt className="text-muted-foreground">Registrado em</dt><dd>{time(current.created_at)}</dd></div><div><dt className="text-muted-foreground">Última mensagem recebida</dt><dd>{time(current.last_inbound_at)}</dd></div></dl></aside>
      </> : <div className="col-span-2 hidden items-center justify-center p-10 text-sm text-muted-foreground lg:flex">Selecione um direct</div>}
    </div>
  </div>;
}