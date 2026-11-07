import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Plug, RefreshCw, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  confirmHypercashPaymentFn, getHypercashOverview, linkHypercashClientFn, saveHypercashFn, setHypercashActiveFn, syncHypercashFn, testHypercashFn,
  saveHypercashTransactionsFn,testHypercashTransactionsFn,setHypercashAutoSyncFn,linkHypercashPayoutFn,inspectHypercashReadOnlyFn,
} from "@/lib/hypercash.functions";
import { CHARGE_STATUS_LABEL, SUBSCRIPTION_STATUS_LABEL, hypercashReadiness, type ChargeStatus, type SubscriptionStatus } from "@/lib/hypercash";

import { HYPERCASH_FAILURE_LABEL } from "@/lib/hypercash-api";
import { Checkbox } from "@/components/ui/checkbox";

const brl = (cents: number | null) => cents === null ? "—" : (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const when = (v: string | null) => v ? new Date(v).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "—";
const day = (v: string | null) => v ? new Date(v).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—";

type Overview = Awaited<ReturnType<typeof getHypercashOverview>>;

export function HypercashPanel() {
  const fetchOverview = useServerFn(getHypercashOverview);
  const save = useServerFn(saveHypercashFn);
  const test = useServerFn(testHypercashFn);
  const toggle = useServerFn(setHypercashActiveFn);
  const sync = useServerFn(syncHypercashFn);
  const link = useServerFn(linkHypercashClientFn);
  const confirm = useServerFn(confirmHypercashPaymentFn);
  const inspect=useServerFn(inspectHypercashReadOnlyFn);
  const saveTx=useServerFn(saveHypercashTransactionsFn);const testTx=useServerFn(testHypercashTransactionsFn);const auto=useServerFn(setHypercashAutoSyncFn);const payout=useServerFn(linkHypercashPayoutFn);
  const query = useQuery({ queryKey: ["hypercash-overview"], queryFn: () => fetchOverview(), retry: false });
  const [keyKind,setKeyKind]=useState<"subscriptions"|"transactions">("subscriptions");
  const [view,setView]=useState<"subscriptions"|"payments"|"payouts">("subscriptions");
  const [from,setFrom]=useState("");const [to,setTo]=useState("");const [statusFilter,setStatusFilter]=useState("");
  const [accountId,setAccountId]=useState("");const [target,setTarget]=useState("");
  const [bankId,setBankId]=useState("");const [chargeIds,setChargeIds]=useState<string[]>([]);const [fee,setFee]=useState("0");const [payoutConfirm,setPayoutConfirm]=useState(false);const lock=useRef(false);
  const [connecting, setConnecting] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [linking, setLinking] = useState<{ chargeId: string; clientId: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const data: Overview | undefined = query.data;
  const integration = data?.integration ?? null;
  const active = integration?.status === "ativa";
  const readiness=hypercashReadiness({hasSubscriptions:data?.credentialsSaved??false,hasTransactions:data?.transactionsCredentialsSaved??false,active,subscriptionCheck:integration?.last_check_status??null,transactionCheck:integration?.transactions_check_status??null,syncStatus:integration?.last_sync_status??null,syncedAt:integration?.last_sync_at??null});

  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current=true;
    setBusy(true); setNotice(""); setError("");
    try { await action(); await query.refetch(); }
    catch (e) { setError(e instanceof Error ? e.message : "Não foi possível concluir."); }
    finally { lock.current=false;setBusy(false); }
  }

  if (query.isPending) return <p className="py-6 text-sm text-muted-foreground">Carregando integração…</p>;
  if (query.isError) return <p role="alert" className="py-6 text-sm text-destructive">{query.error instanceof Error ? query.error.message : "Não foi possível abrir a integração."}</p>;

  const clients = data?.clients ?? [];
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const paidInPeriod=(data?.charges??[]).filter(c=>c.status==="paid"&&(!from||(c.paid_at??"").slice(0,10)>=from)&&(!to||(c.paid_at??"").slice(0,10)<=to));
  const shownCharges=(data?.charges??[]).filter(c=>(!statusFilter||c.status===statusFilter)&&(!from||(c.paid_at??c.billing_date??"").slice(0,10)>=from)&&(!to||(c.paid_at??c.billing_date??"").slice(0,10)<=to));
  const availablePayouts=(data?.charges??[]).filter(c=>c.status==="paid"&&c.finance_payment_id&&!data?.payouts.some(p=>p.charge_id===c.id));
  const pendingLink = (data?.charges ?? []).filter((c) => c.status === "paid" && !c.client_id);
  const statusVariant = (s: string) => s === "paid" || s === "active" ? "default" as const : "outline" as const;

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
      <div className="flex items-center gap-3">
        <Wallet className="size-6 text-primary" />
        <div>
          <p className="flex items-center gap-2 font-medium">HyperCash
            <Badge variant={readiness.canSync?"default":"outline"}>Assinaturas: {readiness.subscriptions}</Badge>
          </p>
          <p className="text-xs text-muted-foreground">
            {`Verificação de assinaturas: ${when(integration?.last_check_at??null)} · ${readiness.sync} · última sincronização: ${when(integration?.last_sync_at??null)}`}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy||(!data?.credentialsSaved&&!data?.transactionsCredentialsSaved)} onClick={()=>void run(async()=>{const r=await inspect();setNotice(`Consulta somente leitura: Assinaturas ${r.subscriptions??'HCP não cadastrada'}; cobranças ${r.charges??'não consultadas'}; Transações ${r.transactionsCheck==='ok'?'verificada':r.transactionsCheck}; registros na resposta ${r.transactionsReturned??'quantidade indisponível'}; correspondências de data 31/10/2026 ${r.transactionReference??r.catalogueReference??'não verificadas'}. ${r.transactionCoverage}`);})}>Consultar sem sincronizar</Button>
        {!data?.credentialsSaved && <Button size="sm" onClick={() => {setKeyKind("subscriptions");setApiKey("");setConnecting(true);}}><Plug className="size-4" />Configurar Assinaturas HCP</Button>}
        {integration && <>
          <Button size="sm" variant="outline" disabled={busy||!data?.credentialsSaved} onClick={() => void run(async () => { const r = await test({ data: undefined }); setNotice(r.ok ? "Conexão de assinaturas verificada com sucesso." : `${HYPERCASH_FAILURE_LABEL[r.code]??r.code}${r.http ? ` HTTP ${r.http}.` : ""}`); })}>Testar Assinaturas</Button>
          <Button size="sm" variant="outline" disabled={busy || !readiness.canSync} onClick={() => void run(async () => { const r = await sync({ data: undefined }); setNotice(`Sincronização concluída: ${r.subscriptions} assinatura(s), ${r.charges} cobrança(s).`); })}><RefreshCw className="size-4" />Sincronizar agora</Button>
          <Button size="sm" variant="outline" disabled={busy||(!active&&!data?.credentialsSaved)} onClick={() => void run(async () => { await toggle({ data: { active: !active, revision: integration.revision } }); setNotice(active ? "Integração desativada. Nada mais é sincronizado." : "Integração ativada."); })}>{active ? "Desativar" : "Ativar Assinaturas"}</Button>
          {data?.credentialsSaved&&<Button size="sm" variant="ghost" onClick={() => {setKeyKind("subscriptions");setApiKey("");setConnecting(true);}}>Trocar HCP</Button>}
        </>}
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">API de Transações: {readiness.transactions}</Badge><span className="text-xs text-muted-foreground">Última verificação: {when(integration?.transactions_check_at??null)}</span><Button size="sm" variant="outline" disabled={busy} onClick={()=>{setKeyKind("transactions");setApiKey("");setConnecting(true);}}>Configurar credencial SK</Button>{data?.transactionsCredentialsSaved&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>void run(async()=>{const r=await testTx();setNotice(r.ok?"API de Transações verificada (consulta somente leitura).":HYPERCASH_FAILURE_LABEL[r.code]??r.code);})}>Testar Transações</Button>}</div>
    {integration&&<div className="flex items-center gap-2"><Checkbox id="hc-auto" checked={integration.auto_sync} disabled={busy||(!integration.auto_sync&&!readiness.canSync)} onCheckedChange={v=>void run(async()=>{await auto({data:{active:v===true,revision:integration.revision}});})}/><Label htmlFor="hc-auto">Sincronização periódica (a cada hora){!readiness.canSync?" · bloqueada até verificar Assinaturas HCP":""}</Label></div>}
    {notice && <p role="status" className="rounded-md border bg-muted/40 p-3 text-sm">{notice}</p>}
    {error && <p role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{error}</p>}

    {integration && <>
      <div className="flex flex-wrap gap-3"><div><Label htmlFor="hc-from">De</Label><Input id="hc-from" type="date" value={from} onChange={e=>setFrom(e.target.value)}/></div><div><Label htmlFor="hc-to">Até</Label><Input id="hc-to" type="date" min={from} value={to} onChange={e=>setTo(e.target.value)}/></div></div>
      <div className="grid gap-4 sm:grid-cols-3"><div className="border-l-2 border-primary pl-3"><p className="text-xs text-muted-foreground">Assinaturas sincronizadas</p><strong>{data?.subscriptions.length??0}</strong></div><div className="border-l-2 border-primary pl-3"><p className="text-xs text-muted-foreground">Pagamentos pagos na HyperCash</p><strong>{paidInPeriod.length} · {brl(paidInPeriod.reduce((n,c)=>n+c.amount_cents,0))}</strong><p className="text-xs text-muted-foreground">Confirmados no Financeiro: {brl(paidInPeriod.filter(c=>c.finance_payment_id).reduce((n,c)=>n+c.amount_cents,0))}</p></div><div className="border-l-2 border-primary pl-3"><p className="text-xs text-muted-foreground">Pendentes de confirmação / repasse</p><strong>{paidInPeriod.filter(c=>!c.finance_payment_id).length} / {availablePayouts.length}</strong></div></div>
      <nav aria-label="Acompanhamento HyperCash" className="flex flex-wrap gap-2 border-b pb-3">{([['subscriptions','Visualizar assinaturas'],['payments','Visualizar pagamentos'],['payouts','Revisar conciliações']] as const).map(([v,label])=><Button key={v} variant={view===v?'default':'outline'} size="sm" onClick={()=>setView(v)}>{label}</Button>)}</nav>
      {view==='subscriptions'&&

      <section>
        <h3 className="text-sm font-semibold uppercase tracking-wide">Assinaturas ({data?.subscriptions.length ?? 0})</h3>
        {data?.subscriptions.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Nenhuma assinatura sincronizada. Use “Sincronizar agora”.</p> :
          <div className="mt-2 overflow-x-auto rounded-lg border"><table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">Cliente</th><th className="px-3 py-2">Produto</th><th className="px-3 py-2">Valor</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Próxima cobrança</th><th className="px-3 py-2">Cliente no CRM</th></tr></thead>
            <tbody>{data?.subscriptions.map((s) => <tr key={s.subscription_id} className="border-t">
              <td className="px-3 py-2">{s.customer_name ?? "—"}<span className="block text-xs text-muted-foreground">{s.customer_email ?? ""}</span></td>
              <td className="px-3 py-2">{s.product_name ?? "—"}</td>
              <td className="px-3 py-2">{brl(s.amount_cents)}</td>
              <td className="px-3 py-2"><Badge variant={statusVariant(s.status ?? "")}>{SUBSCRIPTION_STATUS_LABEL[(s.status ?? "") as SubscriptionStatus] ?? s.status}</Badge></td>
              <td className="px-3 py-2">{day(s.next_billing_date)}</td>
              <td className="px-3 py-2">{s.client_id ? clientName.get(s.client_id) ?? "Vinculado" : <span className="text-muted-foreground">Sem vínculo</span>}</td>
            </tr>)}</tbody>
          </table></div>}
      </section>}

      {view==='payments'&&<section>
        <h3 className="text-sm font-semibold uppercase tracking-wide">Cobranças ({data?.charges.length ?? 0})</h3>
        <p className="mt-1 text-xs text-muted-foreground">Pagamentos confirmados entram no Financeiro uma única vez, somente depois da sua confirmação aqui. O repasse da HyperCash para o banco nunca é contado como nova receita.</p>
        <select aria-label="Status da cobrança" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} className="mt-3 rounded-md border bg-background p-2 text-sm"><option value="">Todos os status</option>{Object.entries(CHARGE_STATUS_LABEL).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
        {shownCharges.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Nenhuma cobrança sincronizada.</p> :
          <div className="mt-2 overflow-x-auto rounded-lg border"><table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-2">Cliente</th><th className="px-3 py-2">Valor</th><th className="px-3 py-2">Cobrança</th><th className="px-3 py-2">Pago em</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Financeiro</th><th className="px-3 py-2 text-right">Ações</th></tr></thead>
            <tbody>{shownCharges.map((c) => <tr key={c.id} className="border-t">
              <td className="px-3 py-2">{c.customer_name ?? "—"}<span className="block text-xs text-muted-foreground">{c.customer_email ?? ""}</span></td>
              <td className="px-3 py-2">{brl(c.amount_cents)}</td>
              <td className="px-3 py-2">{day(c.billing_date)}</td>
              <td className="px-3 py-2">{when(c.paid_at)}</td>
              <td className="px-3 py-2"><Badge variant={statusVariant(c.status)}>{CHARGE_STATUS_LABEL[c.status as ChargeStatus] ?? c.status}</Badge></td>
              <td className="px-3 py-2">{c.finance_payment_id ? <span className="flex items-center gap-1 text-primary"><BadgeCheck className="size-4" />Registrado</span> : c.client_id ? clientName.get(c.client_id) ?? "Vinculado" : <span className="text-muted-foreground">Sem vínculo</span>}</td>
              <td className="px-3 py-2 text-right"><div className="flex justify-end gap-1">
                {!c.client_id && !c.finance_payment_id && <Button size="sm" variant="outline" onClick={() => setLinking({ chargeId: c.id, clientId: "" })}>Vincular</Button>}
                {c.status === "paid" && c.client_id && !c.finance_payment_id && <Button size="sm" variant="outline" onClick={() => {setAccountId("");setTarget("");setConfirming(c.id);}}>Confirmar recebimento</Button>}
              </div></td>
            </tr>)}</tbody>
          </table></div>}
        {pendingLink.length > 0 && <p className="mt-2 text-xs text-muted-foreground">{pendingLink.length} pagamento(s) identificado(s) antes do cadastro do cliente — vincule quando o cliente existir no CRM.</p>}
      </section>}
      {view==='payouts'&&<section className="space-y-4"><h3 className="font-semibold">Repasses para o banco</h3><select aria-label="Repasse bancário" value={bankId} onChange={e=>setBankId(e.target.value)} className="w-full rounded-md border bg-background p-2 text-sm"><option value="">Selecione a movimentação e verifique a conta Bradesco</option>{data?.banks.filter(b=>!data.payouts.some(p=>p.bank_transaction_id===b.polp_transaction_id)).map(b=><option key={b.polp_transaction_id} value={b.polp_transaction_id}>{day(b.transaction_at)} · {b.polp_account_id} · {b.counterparty_name??b.description} · {brl(b.amount_cents)}</option>)}</select><div className="max-h-72 space-y-2 overflow-auto">{availablePayouts.map(c=><label key={c.id} className="flex items-center gap-2 border-b py-2 text-sm"><Checkbox checked={chargeIds.includes(c.id)} onCheckedChange={v=>setChargeIds(ids=>v===true?[...ids,c.id]:ids.filter(id=>id!==c.id))}/>{clientName.get(c.client_id??'')??c.customer_name} · {brl(c.amount_cents)} · {day(c.paid_at)}</label>)}</div><Label htmlFor="hc-fee">Taxas/descontos do repasse (R$)</Label><Input id="hc-fee" type="number" min="0" step="0.01" value={fee} onChange={e=>setFee(e.target.value)}/><p className="text-sm">Bruto: {brl(availablePayouts.filter(c=>chargeIds.includes(c.id)).reduce((n,c)=>n+c.amount_cents,0))} · Líquido: {brl(availablePayouts.filter(c=>chargeIds.includes(c.id)).reduce((n,c)=>n+c.amount_cents,0)-Math.round(Number(fee)*100))}</p><Button disabled={busy||!bankId||!chargeIds.length||!Number.isFinite(Number(fee))||Number(fee)<0} onClick={()=>setPayoutConfirm(true)}>Revisar repasse selecionado</Button><p className="text-xs text-muted-foreground">{data?.payouts.length??0} recebimento(s) com vínculo persistente de repasse.</p></section>}
      {(data?.syncLog.length ?? 0) > 0 && <details className="text-sm"><summary className="cursor-pointer font-medium">Histórico de sincronizações</summary>
        <ul className="mt-2 space-y-1 text-muted-foreground">{data?.syncLog.map((l) => <li key={l.id}>{when(l.started_at)} · {l.outcome === "ok" ? `ok · ${l.subscriptions_count} assinatura(s), ${l.charges_count} cobrança(s)` : `erro · ${l.message}`}</li>)}</ul>
      </details>}
    {data?.audit.length ? <details><summary className="text-sm font-medium">Histórico de alterações</summary>{data.audit.map(a=><p key={a.id} className="py-1 text-xs text-muted-foreground">{when(a.created_at)} · {a.event}</p>)}</details>:null}
    </>}

    <Dialog open={connecting} onOpenChange={(o) => { if (!busy) setConnecting(o); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Conectar HyperCash</DialogTitle>
          <DialogDescription>{keyKind==="subscriptions"?"Assinaturas e cobranças recorrentes: chave HCP com permissão subscriptions. A chave SK de Transações não autoriza esta API.":"API de Transações: chave secreta SK, autenticada separadamente por Basic. Não substitui a credencial de assinaturas."}</DialogDescription></DialogHeader>
        <div className="space-y-2"><Label htmlFor="hc-key">Chave de API</Label><Input id="hc-key" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={keyKind==="subscriptions"?"Chave de assinaturas HCP":"Chave secreta de Transações SK"} /></div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" onClick={() => setConnecting(false)} disabled={busy}>Cancelar</Button>
          <Button disabled={busy || apiKey.trim().length < 12} onClick={() => void run(async () => {
            const r = keyKind==="subscriptions"?await save({ data: { apiKey } }):await saveTx({data:{apiKey}});
            if (!r.saved) { setApiKey("");setError(HYPERCASH_FAILURE_LABEL[r.failure.code]??r.failure.code); return; }
            setConnecting(false); setApiKey(""); setNotice(keyKind==="subscriptions"?"Assinaturas conectadas. Use Sincronizar agora.":"API de Transações conectada. Assinaturas exigem credencial HCP separada.");
          })}>Salvar e testar</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={Boolean(linking)} onOpenChange={(o) => { if (!o && !busy) setLinking(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Vincular ao cliente</DialogTitle><DialogDescription>O vínculo é usado no histórico financeiro do cliente e na confirmação do recebimento.</DialogDescription></DialogHeader>
        <select aria-label="Cliente" className="w-full rounded-md border bg-background px-2 py-2 text-sm" value={linking?.clientId ?? ""} onChange={(e) => setLinking((l) => l && { ...l, clientId: e.target.value })}>
          <option value="">Escolha o cliente…</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.email ? ` · ${c.email}` : ""}</option>)}
        </select>
        <DialogFooter><Button variant="outline" onClick={() => setLinking(null)} disabled={busy}>Cancelar</Button>
          <Button disabled={busy || !linking?.clientId} onClick={() => void run(async () => { if(!linking)return;await link({ data: linking }); setLinking(null); setNotice("Cliente vinculado."); })}>Vincular</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={Boolean(confirming)} onOpenChange={(o) => { if (!o && !busy) setConfirming(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Confirmar recebimento</DialogTitle>
          <DialogDescription>O valor entra no Financeiro como receita do cliente, uma única vez. O repasse posterior da HyperCash para a conta bancária não será contado de novo.</DialogDescription></DialogHeader>
        <select aria-label="Conta do recebimento HyperCash" className="w-full rounded-md border bg-background p-2 text-sm" value={accountId} onChange={e=>setAccountId(e.target.value)}><option value="">Escolha a conta onde o valor foi recebido (HyperCash)</option>{data?.accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <select aria-label="Vínculo financeiro existente" className="w-full rounded-md border bg-background p-2 text-sm" value={target} onChange={e=>setTarget(e.target.value)}><option value="">Criar cobrança individual para este recebimento</option>{data?.targets.filter(t=>t.client_id===data.charges.find(c=>c.id===confirming)?.client_id&&t.status!=='cancelado'&&t.status!=='pago').map(t=><option key={t.id} value={'charge:'+t.id}>Cobrança: {t.description} · {brl(Number(t.amount)*100)}</option>)}{data?.payments.filter(p=>data.targets.some(t=>t.id===p.charge_id&&t.client_id===data.charges.find(c=>c.id===confirming)?.client_id)&&!data.charges.some(c=>c.finance_payment_id===p.id)).map(p=><option key={p.id} value={'payment:'+p.id}>Pagamento já registrado: {day(p.paid_at)} · {brl(Number(p.amount)*100)}</option>)}</select>
        <DialogFooter><Button variant="outline" onClick={() => setConfirming(null)} disabled={busy}>Cancelar</Button>
          <Button disabled={busy||!accountId} onClick={() => void run(async () => { if(!confirming)return;const [kind,id]=target.split(":");const r = await confirm({ data: { chargeId: confirming, confirmed: true,accountId,targetChargeId:kind==="charge"?id:undefined,targetPaymentId:kind==="payment"?id:undefined } }); setConfirming(null); setNotice(r.already ? "Este recebimento já estava registrado — nada foi duplicado." : "Recebimento registrado no Financeiro e no histórico do cliente."); })}>Confirmar recebimento</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={payoutConfirm} onOpenChange={setPayoutConfirm}><DialogContent><DialogHeader><DialogTitle>Confirmar conciliação do repasse</DialogTitle><DialogDescription>Você verificou a origem HyperCash e os pagamentos selecionados. O repasse será vinculado e classificado como transferência interna, nunca como nova receita. Taxas ficam registradas neste vínculo, sem criar despesas automaticamente.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={busy} onClick={()=>setPayoutConfirm(false)}>Cancelar</Button><Button disabled={busy} onClick={()=>void run(async()=>{await payout({data:{bankId,chargeIds,feeCents:Math.round(Number(fee)*100),confirmed:true}});setPayoutConfirm(false);setChargeIds([]);setBankId('');setNotice('Repasse conciliado sem duplicar receita.');})}>Confirmar repasse</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
