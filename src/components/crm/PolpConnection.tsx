import {useEffect,useRef,useState} from 'react';
import {useServerFn} from '@tanstack/react-start';
import {RefreshCw,Landmark,Link2,ExternalLink,Wallet,Smartphone,Database} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {checkPolpConnection,listPolpConsents,connectNubankPj,refreshPolpConsent,recreatePolpConsentLink,readPolpAccountData,syncPolpTransactions,getPolpSyncOverview,getPolpBankLedger,type PolpConsentOutcome,type PolpSyncOverview,type PolpBankLedger,autoReconcileBankReceipts} from '@/lib/polp.functions';
import {BankFinancePanel} from './BankFinancePanel';
import {shouldAutoSync,type LedgerPeriod} from '@/lib/polp-bank-ledger';
import type {PolpTransactionSummary} from '@/lib/polp';
import {consentStatusLabel,onlyDigits,authLinkState,canRecreateConsent,consentGuidance,type PolpResult,type PolpConsentView,type PolpConsentDetail,type PolpAccount,type PolpTransaction} from '@/lib/polp';

function centsBRL(cents:number){return (cents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}
function money(value?:{amount:string;currency:string}|null){
 if(!value)return '—';
 const parsed=Number(value.amount);
 return Number.isFinite(parsed)?parsed.toLocaleString('pt-BR',{style:'currency',currency:value.currency||'BRL'}):'—';
}
export function PolpConnection(){
 const check=useServerFn(checkPolpConnection);
 const list=useServerFn(listPolpConsents);
 const connect=useServerFn(connectNubankPj);
 const refresh=useServerFn(refreshPolpConsent);
 const recreate=useServerFn(recreatePolpConsentLink);
 const readData=useServerFn(readPolpAccountData);
 const syncTx=useServerFn(syncPolpTransactions);
 const syncOverview=useServerFn(getPolpSyncOverview);
 const bankLedger=useServerFn(getPolpBankLedger);
 // Movimentação bancária persistida (Fase 1) nas caixas do Financeiro; somente leitura.
 const [period,setPeriod]=useState<LedgerPeriod>('mes_atual'),[ledger,setLedger]=useState<PolpBankLedger|null>(null),[ledgerBusy,setLedgerBusy]=useState(false);
 const autoSynced=useRef(false);
 const autoReconcile=useServerFn(autoReconcileBankReceipts);
 async function runAutoReconcile(silent=false){
  try{const out=await autoReconcile({data:{confirmed:true}});
   if(!out.ok){if(!silent)setSyncError(out.error);return;}
   if(!silent||out.reconciled)setSyncMsg(out.needsAccount?'Conciliação automática requer exatamente uma conta cadastrada no Financeiro; concilie manualmente.':`Conciliação automática: ${out.reconciled} recebimento(s) conciliado(s) com correspondência confiável; ${Math.max(0,out.reviewed-out.reconciled)} aguardando revisão.`);
   if(out.reconciled)await loadLedger();
  }catch{if(!silent)setSyncError('Não foi possível executar a conciliação automática.');}
 }
 // Base bancária persistente (Fase 1): sincronização manual idempotente e importação de período com confirmação.
 const [overview,setOverview]=useState<Record<string,PolpSyncOverview>>({}),[syncBusy,setSyncBusy]=useState<string|null>(null),[syncMsg,setSyncMsg]=useState(''),[syncError,setSyncError]=useState('');
 const [rangeFor,setRangeFor]=useState<string|null>(null),[rangeFrom,setRangeFrom]=useState(''),[rangeTo,setRangeTo]=useState('');
 const [result,setResult]=useState<PolpResult|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [consents,setConsents]=useState<PolpConsentView[]>([]);
 const [formOpen,setFormOpen]=useState(false),[cpf,setCpf]=useState(''),[cnpj,setCnpj]=useState(''),[confirmed,setConfirmed]=useState(false);
 const [connectBusy,setConnectBusy]=useState(false),[connectError,setConnectError]=useState('');
 // Link de autorização só em memória (nunca persistido) e exibido apenas enquanto válido.
 const [authLink,setAuthLink]=useState<{consentId:string;url:string;expiresAt:string}|null>(null);
 const [notice,setNotice]=useState(''),[details,setDetails]=useState<Record<string,PolpConsentDetail>>({}),[renewBusy,setRenewBusy]=useState<string|null>(null);
 // Prova assinada (só em memória) de que a conexão pertence ao CNPJ/representante informados; exigida para renovar.
 const [proofs,setProofs]=useState<Record<string,string>>({});
 const [now,setNow]=useState(()=>Date.now());
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),15000);return()=>clearInterval(timer);},[]);
 const visibleLink=authLink&&authLinkState(authLink.expiresAt,now)==='valid'?authLink:null;
 const [accounts,setAccounts]=useState<PolpAccount[]|null>(null),[transactions,setTransactions]=useState<PolpTransaction[]>([]),[readBusy,setReadBusy]=useState(false),[readError,setReadError]=useState('');
 const [summary,setSummary]=useState<PolpTransactionSummary|null>(null),[readWarnings,setReadWarnings]=useState<string[]>([]);

 async function reloadConsents(){try{setConsents(await list());}catch{/* sessão completa exigida */}}
 useEffect(()=>{void reloadConsents();},[]);
 async function run(){setBusy(true);setError('');setResult(null);try{setResult(await check());}catch{setError('Não foi possível verificar a Polp. Confira o acesso completo e tente novamente.');}finally{setBusy(false);}}
 async function submitConnect(){
  setConnectBusy(true);setConnectError('');setNotice('');setAuthLink(null);
  try{
   const outcome=await connect({data:{cpf,cnpj,confirmed:true}});
   if(!outcome.ok){setConnectError(outcome.error);return;}
   applyOutcome(outcome);setFormOpen(false);setCpf('');setCnpj('');setConfirmed(false);
   await reloadConsents();
  }catch{setConnectError('Não foi possível iniciar a conexão. Tente novamente.');}finally{setConnectBusy(false);}
 }
 function applyOutcome(outcome:Extract<PolpConsentOutcome,{ok:true}>){
  const id=outcome.consent.consentId;
  setDetails(d=>({...d,[id]:outcome.detail}));
  if(outcome.renewalProof){const proof=outcome.renewalProof;setProofs(p=>({...p,[id]:proof}));}
  setNotice(outcome.notice??'');
  if(outcome.authUrl&&outcome.authUrlExpiresAt)setAuthLink({consentId:id,url:outcome.authUrl,expiresAt:outcome.authUrlExpiresAt});
  else setAuthLink(current=>current?.consentId===id?null:current);
  setNow(Date.now());
 }
 async function refreshOne(consentId:string){
  setConnectError('');setNotice('');
  try{
   const outcome=await refresh({data:{consentId}});
   if(!outcome.ok){setConnectError(outcome.error);return;}
   applyOutcome(outcome);
   await reloadConsents();
  }catch{setConnectError('Não foi possível atualizar o status na Polp.');}
 }
 function confirmCompany(){
  setFormOpen(true);setConnectError('');
  setNotice('Para gerar um novo link, informe o CPF do representante e o CNPJ da empresa desta conexão. Conexões existentes da mesma empresa são reaproveitadas; consentimentos de outra empresa nunca são renovados.');
 }
 async function renewLink(consentId:string){
  const proof=proofs[consentId];
  if(renewBusy)return;
  if(!proof){confirmCompany();return;}
  if(!window.confirm('Gerar um novo link de autorização no Nubank PJ? A Polp emitirá uma nova solicitação de leitura (contas, saldos e transações) válida por 1 hora. O link anterior deixará de valer.'))return;
  setRenewBusy(consentId);setConnectError('');setNotice('');
  try{
   const outcome=await recreate({data:{consentId,proof,confirmed:true}});
   if(!outcome.ok){setConnectError(outcome.error);return;}
   applyOutcome(outcome);
   await reloadConsents();
  }catch{setConnectError('Não foi possível gerar um novo link. Use "Atualizar status" antes de tentar de novo.');}finally{setRenewBusy(null);}
 }
 async function loadLedger(p:LedgerPeriod=period){setLedgerBusy(true);try{setLedger(await bankLedger({data:{period:p}}));}catch{setLedger({available:false});}finally{setLedgerBusy(false);}}
 // eslint-disable-next-line react-hooks/exhaustive-deps
 useEffect(()=>{void loadLedger(period);},[period]);
 async function loadOverview(consentId:string){try{const o=await syncOverview({data:{consentId}});setOverview(v=>({...v,[consentId]:o}));}catch{/* sessão completa exigida */}}
 // Carrega o resumo apenas quando a lista de conexões muda; incluir `overview` recarregaria em loop.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 useEffect(()=>{for(const c of consents)if(c.status==='AUTHORISED'&&!overview[c.consentId])void loadOverview(c.consentId);},[consents]);
 // Sincronização automática (incremental; primeira carga de 30 dias) ao abrir, no máximo uma vez por visita e só se a última tiver mais de 6 h.
 useEffect(()=>{
  if(autoSynced.current||syncBusy)return;
  const target=consents.find(c=>c.status==='AUTHORISED'&&overview[c.consentId]?.available);
  if(!target)return;const o=overview[target.consentId];if(!o||!o.available)return;
  if(!shouldAutoSync(o.lastSuccessAt,o.runs[0]?.status??null,Date.now()))return;
  autoSynced.current=true;void runSync(target.consentId);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[overview,consents]);
 async function runSync(consentId:string,range?:{from:string;to:string}){
  if(syncBusy)return;
  if(range&&!window.confirm('Importar as transações deste período para a base bancária do Pipeflow? Somente leitura: nenhum lançamento financeiro é criado e registros já salvos não são duplicados.'))return;
  setSyncBusy(consentId);setSyncMsg('');setSyncError('');
  try{
   const r=await syncTx({data:range?{consentId,mode:'range',fromDate:new Date(`${range.from}T00:00:00-03:00`).toISOString(),toDate:new Date(`${range.to}T23:59:59-03:00`).toISOString(),confirmed:true}:{consentId,mode:'auto',confirmed:true}});
   if(!r.ok){setSyncError(r.error);return;}
   setSyncMsg(`${r.status==='partial'?'Sincronização parcial':'Sincronização concluída'}: ${r.inserted} nova(s), ${r.updated} atualizada(s), ${r.unchanged} sem alteração.${r.warnings.length?' '+r.warnings.join(' '):''}`);
   setRangeFor(null);
   void runAutoReconcile(true);
  }catch{setSyncError('Não foi possível sincronizar agora. Os registros já salvos foram preservados.');}
  finally{setSyncBusy(null);void loadOverview(consentId);void loadLedger();}
 }
 async function readManual(consentId:string){
  setReadBusy(true);setReadError('');setAccounts(null);setTransactions([]);setSummary(null);setReadWarnings([]);
  try{
   const to=new Date(),from=new Date(to.getTime()-30*24*60*60*1000);
   const outcome=await readData({data:{consentId,fromDate:from.toISOString(),toDate:to.toISOString()}});
   if(!outcome.ok){setReadError(outcome.error);return;}
   setAccounts(outcome.accounts);setTransactions(outcome.transactions);setSummary(outcome.summary);setReadWarnings(outcome.warnings);
  }catch{setReadError('Não foi possível consultar os dados bancários.');}finally{setReadBusy(false);}
 }
 const cpfDigits=onlyDigits(cpf),cnpjDigits=onlyDigits(cnpj);
 const canSubmit=cpfDigits.length===11&&cnpjDigits.length===14&&confirmed&&!connectBusy;
 return <section className="finance-no-print border-t py-6"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-lg font-semibold"><Landmark className="h-5 w-5"/>Polp · Open Finance</h2><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={()=>void run()}><RefreshCw className="h-4 w-4"/>{busy?'Verificando…':'Verificar Polp'}</Button><Button disabled={connectBusy} onClick={()=>{setFormOpen(v=>!v);setConnectError('');}}><Link2 className="h-4 w-4"/>Conectar Nubank PJ</Button></div></div>
 <p className="mt-2 text-sm text-muted-foreground">Somente leitura de contas, saldos e transações · movimentações não alteram lançamentos manuais nem o faturamento</p>
 <BankFinancePanel ledger={ledger} period={period} onPeriod={setPeriod} busy={ledgerBusy} reload={()=>loadLedger()} onAutoReconcile={()=>void runAutoReconcile()}/>
 {error&&<p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
 {formOpen&&<div className="mt-4 space-y-3 rounded-md border p-4"><p className="text-sm font-medium">Autorização Open Finance — Nubank PJ</p><p className="text-sm text-muted-foreground">Serão solicitadas apenas permissões de leitura de contas, saldos e transações. Os documentos são enviados diretamente à Polp e não ficam armazenados no Pipeflow.</p>
  <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">CPF do representante<input inputMode="numeric" className="mt-1 w-full rounded-md border bg-background px-3 py-2" value={cpf} onChange={e=>setCpf(onlyDigits(e.target.value))} placeholder="Somente números"/></label><label className="text-sm">CNPJ da empresa<input inputMode="numeric" className="mt-1 w-full rounded-md border bg-background px-3 py-2" value={cnpj} onChange={e=>setCnpj(onlyDigits(e.target.value))} placeholder="Somente números"/></label></div>
  <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Autorizo a criação do consentimento de leitura junto ao Nubank PJ pela Polp.</label>
  <Button disabled={!canSubmit} onClick={()=>void submitConnect()}>{connectBusy?'Criando consentimento…':'Iniciar autorização no banco'}</Button></div>}
 {connectError&&<p role="alert" className="mt-3 text-sm text-destructive">{connectError}</p>}
 {notice&&<p role="status" className="mt-3 text-sm text-muted-foreground">{notice}</p>}
 {visibleLink&&<div className="mt-3 space-y-2 rounded-md border p-3 text-sm"><p>Link de autorização pronto · válido até {new Date(visibleLink.expiresAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}. <a className="inline-flex items-center gap-1 font-medium text-primary underline" href={visibleLink.url} target="_blank" rel="noreferrer">Concluir autorização no Nubank<ExternalLink className="h-3 w-3"/></a></p>
  <div className="flex items-start gap-2 text-muted-foreground"><Smartphone className="mt-0.5 h-4 w-4 shrink-0"/><ul className="list-disc space-y-1 pl-4"><li>Abra o link no celular com o aplicativo Nubank instalado, conectado ao CPF do representante que opera a conta PJ.</li><li>Conclua antes do horário de validade (1 hora após a geração). Depois disso a página do Nubank mostra erro e é preciso gerar um novo link.</li><li>Abra o link uma única vez e não o encaminhe a outras pessoas. Ao terminar, clique em “Atualizar status”.</li></ul></div></div>}
 {consents.length>0&&<div className="mt-4 space-y-2">{consents.map(c=><div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"><div><p className="font-medium">{c.institutionName||'Nubank'} · {consentStatusLabel(c.status)}{c.status==='AWAITING_AUTHORIZATION'&&authLinkState(c.urlExpiresAt,now)!=='valid'?' · link expirado':''}</p><p className="text-muted-foreground">Verificado em {new Date(c.lastCheckedAt).toLocaleString('pt-BR')}{c.executionStatus?` · importação: ${c.executionStatus==='SUCCESS'?'concluída':c.executionStatus==='PARTIAL_SUCCESS'?'parcial':'em andamento'}`:''}</p>{consentGuidance(c.status,c.urlExpiresAt,now)&&<p className="text-amber-700">{consentGuidance(c.status,c.urlExpiresAt,now)}</p>}{details[c.consentId]?.statusLabel&&<p className="text-muted-foreground">Situação na Polp: {details[c.consentId]?.statusLabel}</p>}{details[c.consentId]?.error&&<p className="text-destructive">Motivo informado pela Polp: {details[c.consentId]?.error}</p>}</div><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={()=>void refreshOne(c.consentId)}><RefreshCw className="h-3 w-3"/>Atualizar status</Button>{canRecreateConsent(c.status,c.urlExpiresAt,now)&&(proofs[c.consentId]?<Button size="sm" disabled={renewBusy!==null} onClick={()=>void renewLink(c.consentId)}><Link2 className="h-3 w-3"/>{renewBusy===c.consentId?'Gerando link…':'Gerar novo link de autorização'}</Button>:<Button size="sm" variant="secondary" onClick={confirmCompany}><Link2 className="h-3 w-3"/>Confirmar empresa para gerar novo link</Button>)}{c.status==='AUTHORISED'&&<Button variant="outline" size="sm" disabled={syncBusy!==null} onClick={()=>void runSync(c.consentId)}><Database className="h-3 w-3"/>{syncBusy===c.consentId?'Sincronizando…':'Sincronizar transações'}</Button>}{c.status==='AUTHORISED'&&<Button variant="ghost" size="sm" onClick={()=>setRangeFor(v=>v===c.consentId?null:c.consentId)}>Importar período</Button>}{c.status==='AUTHORISED'&&<Button variant="outline" size="sm" disabled={readBusy} onClick={()=>void readManual(c.consentId)}><Wallet className="h-3 w-3"/>{readBusy?'Consultando…':'Consultar saldo e transações'}</Button>}</div></div>)}</div>}
 {consents.filter(c=>c.status==='AUTHORISED').map(c=>{const o=overview[c.consentId];return <div key={`sync-${c.id}`} className="mt-2 text-xs text-muted-foreground">{o?.available?<span>Base bancária: {o.stored} transação(ões) salvas{o.lastSuccessAt?` · última sincronização completa em ${new Date(o.lastSuccessAt).toLocaleString('pt-BR')}`:' · nenhuma sincronização completa ainda'}{o.runs[0]&&o.runs[0].status!=='success'?` · última execução: ${({running:'em andamento',partial:'parcial',failed:'falhou'} as Record<string,string>)[o.runs[0].status]??o.runs[0].status}`:''}</span>:o?<span>Base bancária indisponível (migração 0078 pendente).</span>:null}
  {rangeFor===c.consentId&&<div className="mt-2 flex flex-wrap items-end gap-2 rounded-md border p-3 text-sm text-foreground"><label>De<input type="date" className="ml-2 rounded-md border bg-background px-2 py-1" value={rangeFrom} onChange={e=>setRangeFrom(e.target.value)}/></label><label>Até<input type="date" className="ml-2 rounded-md border bg-background px-2 py-1" value={rangeTo} onChange={e=>setRangeTo(e.target.value)}/></label><Button size="sm" disabled={!rangeFrom||!rangeTo||syncBusy!==null} onClick={()=>void runSync(c.consentId,{from:rangeFrom,to:rangeTo})}>Importar</Button><span className="text-xs text-muted-foreground">Máximo de 92 dias por importação. O histórico disponível depende do banco (Open Finance).</span></div>}</div>;})}
 {syncMsg&&<p role="status" className="mt-3 text-sm text-muted-foreground">{syncMsg}</p>}
 {syncError&&<p role="alert" className="mt-3 text-sm text-destructive">{syncError}</p>}
 {readError&&<p role="alert" className="mt-3 text-sm text-destructive">{readError}</p>}
 {accounts&&<div className="mt-4 space-y-3 text-sm"><p className="font-medium">Contas (leitura manual, últimos 30 dias) — nada foi gravado no Financeiro</p>
  {accounts.length===0&&<p className="text-muted-foreground">Nenhuma conta disponível ainda — a importação do banco pode estar em andamento.</p>}
  {accounts.map(a=><div key={a.id} className="rounded-md border p-3"><p className="font-medium">Conta {a.number??''}{a.check_digit?`-${a.check_digit}`:''} {a.subtype?`· ${a.subtype}`:''}</p><p>Saldo disponível: {money(a.balance?.available_amount)}{a.balance?.blocked_amount?` · Bloqueado: ${money(a.balance.blocked_amount)}`:''}{a.balance?.automatically_invested_amount?` · Aplicado automaticamente: ${money(a.balance.automatically_invested_amount)}`:''}</p>{a.balance?.update_date_time&&<p className="text-muted-foreground">Saldo informado pelo banco em {new Date(a.balance.update_date_time).toLocaleString('pt-BR')}</p>}{!a.balance&&<p className="text-muted-foreground">Saldo ainda não sincronizado pela Polp.</p>}</div>)}
  {summary&&transactions.length>0&&<div className="grid gap-2 sm:grid-cols-3"><div className="rounded-md border p-3"><p className="text-muted-foreground">Entradas</p><p className="text-base font-semibold text-green-700">{centsBRL(summary.incomeCents)}</p></div><div className="rounded-md border p-3"><p className="text-muted-foreground">Saídas</p><p className="text-base font-semibold text-red-700">{centsBRL(summary.expenseCents)}</p></div><div className="rounded-md border p-3"><p className="text-muted-foreground">Resultado do período</p><p className={`text-base font-semibold ${summary.netCents<0?'text-red-700':'text-green-700'}`}>{centsBRL(summary.netCents)}</p></div><p className="text-xs text-muted-foreground sm:col-span-3">{summary.counted} de {transactions.length} transações consideradas nos totais.</p></div>}
  {readWarnings.length>0&&<ul role="status" className="list-disc space-y-1 pl-5 text-amber-700">{readWarnings.map(w=><li key={w}>{w}</li>)}</ul>}
  {transactions.length>0&&<div className="max-h-80 overflow-auto rounded-md border"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="py-2 pl-3">Data</th><th>Descrição</th><th>Contraparte</th><th className="pr-3 text-right">Valor</th></tr></thead><tbody>{transactions.map(t=><tr key={t.id} className="border-b"><td className="py-2 pl-3">{t.transaction_date_time?new Date(t.transaction_date_time).toLocaleDateString('pt-BR'):'—'}</td><td>{t.transaction_name??'—'}{t.type?<span className="text-muted-foreground"> · {t.type}</span>:null}</td><td>{t.counterparty?.alias||t.counterparty?.name||'—'}</td><td className={`pr-3 text-right ${t.credit_debit_type==='CREDITO'?'text-green-700':t.credit_debit_type==='DEBITO'?'text-red-700':'text-muted-foreground'}`}>{t.credit_debit_type==='DEBITO'?'−':''}{money(t.transaction_amount)}</td></tr>)}</tbody></table></div>}
  {accounts.length>0&&transactions.length===0&&<p className="text-muted-foreground">Nenhuma transação no período consultado.</p>}</div>}
 {result&&<div role="status" className="mt-4 space-y-2 text-sm"><p>Credenciais: {result.credentialsConfigured?'configuradas':'não configuradas'}</p><p>Autenticação: {result.authentication==='rejected'?'requisição recusada':'não comprovada — o catálogo é público'}</p><p>Catálogo: {result.status==='ok'?`${result.institutions.length} instituições${result.complete?'':' · resultado parcial'}`:`consulta indisponível${result.httpStatus?` · HTTP ${result.httpStatus}`:''}`}</p><p>Nubank PJ: {({available:'disponível no catálogo · CPF + CNPJ',unavailable:'temporariamente indisponível',not_found:'suporte empresarial não confirmado',unknown:'não confirmado'})[result.nubankBusiness]}</p>{result.institutions.length>0&&<details className="pt-2"><summary className="cursor-pointer font-medium">Instituições financeiras</summary><div className="mt-3 max-h-80 overflow-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="py-2">Instituição</th><th>Perfil</th><th>Situação</th></tr></thead><tbody>{result.institutions.map(r=><tr key={r.id} className="border-b"><td className="py-2 pr-3">{r.name}</td><td className="pr-3">{r.type==='BOTH'?'PF e PJ':r.type==='BUSINESS'?'PJ':'PF'}</td><td>{r.status==='OPERATIONAL'?'Operacional':'Indisponível/degradada'}</td></tr>)}</tbody></table></div></details>}</div>}</section>;
}
