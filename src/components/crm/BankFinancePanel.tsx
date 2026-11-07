import {BankOverviewPanel} from './BankOverviewPanel';
import {Fragment,useMemo,useState} from 'react';
import {useServerFn} from '@tanstack/react-start';
import {ResponsiveContainer,BarChart,Bar,LineChart,Line,XAxis,YAxis,CartesianGrid,Tooltip,Legend} from 'recharts';
import {Button} from '@/components/ui/button';
import {saveBankClassifications,setBankRuleActive,getReconciliationOptions,reconcileBankReceipt,type PolpBankLedger,type PolpLedgerRow,type ReconciliationOptions} from '@/lib/polp.functions';
import {BANK_KINDS,BUSINESS_CATEGORIES,PERSONAL_CATEGORIES,KIND_LABEL,CATEGORY_LABEL,SPHERE_LABEL,STATUS_LABEL,sphereOf,type BankKind,type CostCategory,type Sphere,type ReviewStatus,type ClassSource} from '@/lib/bank-classification';
import {LEDGER_PERIODS,type LedgerPeriod} from '@/lib/polp-bank-ledger';

const brl=(cents:number)=>(cents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const SOURCE_LABEL:Record<ClassSource,string>={manual:'decisão manual',regra:'regra confirmada',historico:'aprendizado Pipeflow IA',tipo_polp:'tipo informado pelo banco',categoria_polp:'categoria da Polp',fornecedor:'fornecedor reconhecido',descricao:'pela descrição',padrao:'padrão'};
const monthName=(ym:string)=>new Date(`${ym}-15T12:00:00Z`).toLocaleDateString('pt-BR',{month:'short'});
type Ready=Extract<PolpBankLedger,{available:true}>;
type Filters={direction:'todas'|'CREDITO'|'DEBITO';sphere:'todas'|Sphere;kind:'todos'|BankKind;category:'todas'|CostCategory;status:'todos'|ReviewStatus;source:'todas'|ClassSource;confidence:'todas'|'alta'|'media';min:string;max:string;q:string};
const NO_FILTERS:Filters={direction:'todas',sphere:'todas',kind:'todos',category:'todas',status:'todos',source:'todas',confidence:'todas',min:'',max:'',q:''};
const categoriesFor=(kind:BankKind):readonly CostCategory[]=>kind==='despesa_operacional'?BUSINESS_CATEGORIES:kind==='despesa_pessoal'?PERSONAL_CATEGORIES:[];
const clsText=(c:{kind:BankKind;category:CostCategory|null;vendor:string|null})=>`${KIND_LABEL[c.kind]}${c.category?` · ${CATEGORY_LABEL[c.category]}`:''}${c.vendor?` · ${c.vendor}`:''}`;

// Painel financeiro (banco classificado) + Revisão Financeira. Somente valores confirmados entram nas caixas
// empresariais; pendências aparecem separadas. Faturamento vem da fonte oficial (recebimentos confirmados/conciliados).
export function BankFinancePanel({ledger,period,onPeriod,busy,reload,onAutoReconcile}:{ledger:PolpBankLedger|null;period:LedgerPeriod;onPeriod:(p:LedgerPeriod)=>void;busy:boolean;reload:()=>Promise<void>;onAutoReconcile:()=>void}){
 const saveMany=useServerFn(saveBankClassifications),toggleRule=useServerFn(setBankRuleActive);
 const reconOptions=useServerFn(getReconciliationOptions),reconcile=useServerFn(reconcileBankReceipt);
 const [filters,setFilters]=useState<Filters>(NO_FILTERS);
 const [selected,setSelected]=useState<Set<string>>(new Set());
 const [bulkCategory,setBulkCategory]=useState<CostCategory|''>('');
 const [msg,setMsg]=useState(''),[err,setErr]=useState(''),[saving,setSaving]=useState(false);
 const [editing,setEditing]=useState<{id:string;kind:BankKind;category:CostCategory|null;vendor:string;rule:boolean}|null>(null);
 const [reconFor,setReconFor]=useState<string|null>(null),[reconData,setReconData]=useState<ReconciliationOptions|null>(null),[reconPick,setReconPick]=useState(''),[reconAccount,setReconAccount]=useState('');
 const ready=ledger&&ledger.available?ledger as Ready:null;
 const rows=useMemo(()=>{
  if(!ready)return [] as PolpLedgerRow[];
  const q=filters.q.trim().toLowerCase();const min=filters.min?Math.round(Number(filters.min.replace(',','.'))*100):null;const max=filters.max?Math.round(Number(filters.max.replace(',','.'))*100):null;
  return ready.rows.filter(r=>(filters.direction==='todas'||r.direction===filters.direction)&&(filters.sphere==='todas'||r.sphere===filters.sphere)&&(filters.kind==='todos'||r.cls.kind===filters.kind)
   &&(filters.category==='todas'||r.cls.category===filters.category)&&(filters.status==='todos'||r.status===filters.status)
   &&(filters.source==='todas'||r.suggestion.source===filters.source)&&(filters.confidence==='todas'||r.suggestion.confidence===filters.confidence)
   &&(min===null||Number.isNaN(min)||(r.amountCents!==null&&Math.abs(r.amountCents)>=min))&&(max===null||Number.isNaN(max)||(r.amountCents!==null&&Math.abs(r.amountCents)<=max))
   &&(!q||`${r.description??''} ${r.counterparty??''}`.toLowerCase().includes(q)));
 },[ready,filters]);
 if(!ledger)return <p className="mt-4 text-sm text-muted-foreground">Carregando movimentação bancária…</p>;
 if(!ready)return <p className="mt-4 text-sm text-muted-foreground">Base bancária indisponível no momento.</p>;
 const t=ready.totals,d=ready.dashboard;
 const byId=new Map(ready.rows.map(r=>[r.transactionId,r]));
 type SaveItem={transactionId:string;kind:BankKind;category:string|null;vendor:string|null;expectedRevision:number;decision:'aprovado'|'corrigido';rule:{field:'description'|'counterparty';pattern:string}|null};
 async function save(items:SaveItem[],okText:string){
  setSaving(true);setErr('');setMsg('');
  try{const out=await saveMany({data:{items}});if(!out.ok){setErr(out.error);return;}setMsg(okText.replace('{n}',String(out.saved)));setSelected(new Set());setEditing(null);await reload();}
  catch{setErr('Não foi possível salvar; nada foi alterado.');}finally{setSaving(false);}
 }
 const approveItem=(r:PolpLedgerRow)=>({transactionId:r.transactionId,kind:r.suggestion.kind,category:r.suggestion.category,vendor:r.suggestion.vendor,expectedRevision:r.overrideRevision,decision:'aprovado' as const,rule:null});
 function bulk(mode:'aprovar'|'pessoal'|'empresarial'|'investimento'){
  const list=[...selected].map(id=>byId.get(id)).filter((r):r is PolpLedgerRow=>Boolean(r&&r.direction));
  if(!list.length)return;
  if(mode==='aprovar'){const ok=list.filter(r=>r.suggestion.kind!=='nao_classificado'&&!r.suggestion.hint);if(!ok.length){setErr('Nenhuma das selecionadas tem sugestão confiável para aprovar.');return;}void save(ok.map(approveItem),`{n} movimentação(ões) aprovada(s).`);return;}
  if((mode==='pessoal'||mode==='empresarial')&&list.some(r=>r.direction==='DEBITO')){
   const allowed=mode==='pessoal'?PERSONAL_CATEGORIES:BUSINESS_CATEGORIES;
   if(!bulkCategory||!(allowed as readonly string[]).includes(bulkCategory)){setErr(`Escolha uma categoria ${mode==='pessoal'?'pessoal':'empresarial'} para as saídas selecionadas.`);return;}
  }
  void save(list.map(r=>{const debit=r.direction==='DEBITO';
   const kind:BankKind=mode==='pessoal'?(debit?'despesa_pessoal':'entrada_pessoal'):mode==='empresarial'?(debit?'despesa_operacional':'receita_operacional'):(debit?'aplicacao':'resgate');
   const category=(kind==='despesa_operacional'||kind==='despesa_pessoal')?(bulkCategory||null):null;
   const same=kind===r.suggestion.kind&&category===r.suggestion.category;
   return {transactionId:r.transactionId,kind,category,vendor:r.cls.vendor,expectedRevision:r.overrideRevision,decision:same?'aprovado' as const:'corrigido' as const,rule:null};}),`{n} movimentação(ões) classificada(s).`);
 }
 async function openRecon(r:PolpLedgerRow){setReconFor(r.transactionId);setReconData(null);setReconPick('');setErr('');try{const o=await reconOptions({data:{transactionId:r.transactionId}});setReconData(o);if(o.ok&&o.accounts.length===1)setReconAccount(o.accounts[0].id);}catch{setReconData({ok:false,error:'Não foi possível carregar os candidatos.'});}}
 async function confirmRecon(r:PolpLedgerRow){
  if(!reconData||!reconData.ok)return;const c=reconData.candidates.find(x=>`${x.type}:${x.id}`===reconPick);if(!c)return;
  const needsAccount=c.type==='client_charge'||(c.type==='client_payment'&&!c.reasons.includes('já registrado no Financeiro'));
  if(needsAccount&&!reconAccount){setErr('Escolha a conta do Financeiro.');return;}
  setSaving(true);setErr('');
  try{const out=await reconcile({data:{transactionId:r.transactionId,target:{type:c.type,id:c.id},accountId:needsAccount?reconAccount:null,confirmed:true}});if(!out.ok){setErr(out.error);return;}setReconFor(null);setMsg('Recebimento conciliado.');await reload();}
  catch{setErr('Não foi possível conciliar agora.');}finally{setSaving(false);}
 }
 const box=(items:[string,string,string?,string?][])=><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{items.map(([label,value,tone,hint])=><article key={label} className="rounded-md border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className={`mt-1 text-lg font-semibold ${tone??''}`}>{value}</p>{hint&&<p className="text-xs text-muted-foreground">{hint}</p>}</article>)}</div>;
 const chartData=ready.series.months.map(m=>({mes:monthName(m.month),Faturamento:m.revenue===null?undefined:m.revenue/100,Despesas:m.expenses===null?undefined:m.expenses/100,Resultado:m.result===null?undefined:m.result/100,Tráfego:m.traffic===null?undefined:m.traffic/100}));
 const sel=(v:string,set:(x:string)=>void,opts:[string,string][],label:string)=><label className="text-xs">{label}<select className="ml-1 rounded-md border bg-background px-2 py-1 text-sm" value={v} onChange={e=>set(e.target.value)}>{opts.map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>;
 const visible=rows.slice(0,300);
 // Mesma regra dos totais (só BRL com valor e sentido): com Sentido = Entradas, bate com "Entradas bancárias" da Visão geral.
 const listTotals=rows.reduce((t,r)=>{if(r.amountCents===null||!r.direction||r.currency!=='BRL')return t;const v=Math.abs(r.amountCents);if(r.direction==='CREDITO'){t.inCents+=v;t.inCount++;}else{t.outCents+=v;t.outCount++;}return t;},{inCents:0,inCount:0,outCents:0,outCount:0});
 const allVisibleSelected=visible.length>0&&visible.every(r=>selected.has(r.transactionId));
 return <div className="mt-4 space-y-5">
  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">Painel financeiro · Nubank PJ</h3><select aria-label="Período" className="rounded-md border bg-background px-2 py-1 text-sm" value={period} onChange={e=>onPeriod(e.target.value as LedgerPeriod)}>{LEDGER_PERIODS.map(p=><option key={p.value} value={p.value}>{p.label}</option>)}</select></div>
  {box([[`Faturamento do mês (${monthName(d.monthLabel)})`,brl(d.monthRevenueCents),'text-green-700','receitas operacionais confirmadas'],['Faturamento acumulado (período)',brl(d.revenueCents),'text-green-700','confirmado: recebimentos lançados e conciliados'],
   ['Despesas operacionais (confirmadas)',brl(d.operatingExpenseCents),'text-red-700','somente despesas empresariais confirmadas'],['Resultado operacional',brl(d.operatingResultCents),d.operatingResultCents<0?'text-red-700':'text-green-700','faturamento − despesas operacionais'],
   ['Investimento em tráfego (confirmado)',brl(d.trafficCents),'','anúncios da Gravon · já incluso nas despesas'],['Pendentes de revisão',`${d.pendingCount}`,d.pendingCount?'text-amber-700':'',`saídas ${brl(d.pendingOutCents)} · entradas ${brl(d.pendingInCents)} (fora dos totais)`]])}
  <p className="text-xs text-muted-foreground">Gastos pessoais confirmados {brl(d.personalConfirmedCents)} · nunca reduzem o resultado da empresa. Investimentos, resgates, transferências próprias e empréstimos ficam fora do faturamento e das despesas.{ready.truncated?' Período muito grande: totais podem estar incompletos.':''}</p>
  <div className="grid gap-4 lg:grid-cols-3">
   <div className="h-56 rounded-md border p-2"><p className="px-1 text-xs font-medium">Faturamento e despesas operacionais · {ready.series.year}</p><ResponsiveContainer><BarChart data={chartData}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="mes" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/><Tooltip formatter={(v:number)=>brl(Math.round(v*100))}/><Legend wrapperStyle={{fontSize:10}}/><Bar dataKey="Faturamento" fill="var(--success, #15803d)"/><Bar dataKey="Despesas" fill="var(--destructive, #b91c1c)"/></BarChart></ResponsiveContainer></div>
   <div className="h-56 rounded-md border p-2"><p className="px-1 text-xs font-medium">Resultado operacional · {ready.series.year}</p><ResponsiveContainer><LineChart data={chartData}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="mes" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/><Tooltip formatter={(v:number)=>brl(Math.round(v*100))}/><Line type="monotone" dataKey="Resultado" stroke="var(--primary)" connectNulls={false}/></LineChart></ResponsiveContainer></div>
   <div className="h-56 rounded-md border p-2"><p className="px-1 text-xs font-medium">Investimento em tráfego pago · {ready.series.year}</p><ResponsiveContainer><BarChart data={chartData}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="mes" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/><Tooltip formatter={(v:number)=>brl(Math.round(v*100))}/><Bar dataKey="Tráfego" fill="var(--primary)"/></BarChart></ResponsiveContainer></div>
  </div>
  <p className="text-xs text-muted-foreground">Gráficos com valores confirmados de {ready.series.year}; meses sem dados aparecem vazios (não como zero).</p>
  <details className="rounded-md border p-3"><summary className="cursor-pointer text-sm font-medium">Banco e investimentos (conferência com o extrato)</summary><div className="mt-3 space-y-2">
   {box([['Entradas bancárias',brl(t.bankInCents),'text-green-700'],['Saídas bancárias',brl(t.bankOutCents),'text-red-700'],['Variação de caixa',brl(t.cashChangeCents),t.cashChangeCents<0?'text-red-700':'text-green-700'],['Saldo bancário',ready.balance?brl(ready.balance.availableCents):'—'],['Aplicações (RDB/caixinhas)',brl(t.investedCents)],['Resgates',brl(t.redeemedCents)],['Rendimentos financeiros',brl(t.yieldCents),'text-green-700'],['Recebimentos a conciliar',`${brl(ready.pendingReceipts.cents)} · ${ready.pendingReceipts.count}`,ready.pendingReceipts.count?'text-amber-700':''],['Conciliados (faturamento)',brl(ready.reconciledIncomeCents),'text-green-700']])}
   <p className="text-xs text-muted-foreground">{t.counted} movimentação(ões) · transferências próprias {brl(t.internalTransfersCents)} · empréstimos {brl(t.loansInCents)} recebidos / {brl(t.loansOutCents)} pagos · pessoais {brl(t.personalOutCents)} saídas / {brl(t.personalInCents)} entradas{t.excluded?` · ${t.excluded} sem valor, sentido ou moeda BRL`:''}.</p>
   {ready.reconciliationAvailable&&<Button size="sm" variant="outline" onClick={onAutoReconcile}>Conciliar automaticamente (só correspondências confiáveis)</Button>}
  </div></details>
  {(ready.byCategory.length>0||ready.vendors.length>0)&&<div className="grid gap-3 md:grid-cols-2"><div className="rounded-md border p-3"><p className="mb-2 text-sm font-medium">Despesas empresariais por categoria (confirmadas)</p><ul className="space-y-1 text-sm">{ready.byCategory.map(c=><li key={c.category} className="flex justify-between gap-2"><span>{c.label} <span className="text-muted-foreground">({c.count})</span></span><span className="font-medium">{brl(c.cents)}</span></li>)}</ul></div>
   <div className="rounded-md border p-3"><p className="mb-2 text-sm font-medium">Maiores fornecedores (confirmados)</p><ol className="space-y-1 text-sm">{ready.vendors.map((v,i)=><li key={v.vendor} className="flex justify-between gap-2"><span>{i+1}. {v.vendor} <span className="text-muted-foreground">({v.count})</span></span><span className="font-medium">{brl(v.cents)}</span></li>)}</ol></div></div>}

  <BankOverviewPanel personal={false} reviewOnly/>
  <details><summary className="cursor-pointer text-sm font-medium">Classificações e conciliação bancária</summary>
  <section className="space-y-3 rounded-md border p-3" aria-label="Revisão financeira">
   <h3 className="text-sm font-semibold uppercase tracking-wide">Revisão financeira</h3>
   {!ready.reviewAvailable&&<p className="text-xs text-amber-700">Aprovação, marcação pessoal e classificação em massa ficam disponíveis após a migração 0081.</p>}
   <div className="flex flex-wrap items-end gap-2">
    {sel(filters.direction,v=>setFilters({...filters,direction:v as Filters['direction']}),[['todas','Todas'],['CREDITO','Entradas'],['DEBITO','Saídas']],'Sentido')}
    {sel(filters.sphere,v=>setFilters({...filters,sphere:v as Filters['sphere']}),[['todas','Todas'],...(Object.keys(SPHERE_LABEL) as Sphere[]).map(s=>[s,SPHERE_LABEL[s]] as [string,string])],'Esfera')}
    {sel(filters.kind,v=>setFilters({...filters,kind:v as Filters['kind']}),[['todos','Todos'],...BANK_KINDS.map(k=>[k,KIND_LABEL[k]] as [string,string])],'Tipo')}
    {sel(filters.category,v=>setFilters({...filters,category:v as Filters['category']}),[['todas','Todas'],...[...BUSINESS_CATEGORIES,...PERSONAL_CATEGORIES].map(c=>[c,CATEGORY_LABEL[c]] as [string,string])],'Categoria')}
    {sel(filters.status,v=>setFilters({...filters,status:v as Filters['status']}),[['todos','Todos'],...(Object.keys(STATUS_LABEL) as ReviewStatus[]).map(s=>[s,STATUS_LABEL[s]] as [string,string])],'Status')}
    {sel(filters.source,v=>setFilters({...filters,source:v as Filters['source']}),[['todas','Todas'],...(Object.keys(SOURCE_LABEL) as ClassSource[]).map(s=>[s,SOURCE_LABEL[s]] as [string,string])],'Origem')}
    {sel(filters.confidence,v=>setFilters({...filters,confidence:v as Filters['confidence']}),[['todas','Todas'],['alta','Alta'],['media','Média']],'Confiança da IA')}
    <label className="text-xs">Valor de<input inputMode="decimal" className="ml-1 w-20 rounded-md border bg-background px-2 py-1 text-sm" value={filters.min} onChange={e=>setFilters({...filters,min:e.target.value})} placeholder="0,00"/></label>
    <label className="text-xs">até<input inputMode="decimal" className="ml-1 w-20 rounded-md border bg-background px-2 py-1 text-sm" value={filters.max} onChange={e=>setFilters({...filters,max:e.target.value})}/></label>
    <input aria-label="Pesquisar" className="min-w-48 flex-1 rounded-md border bg-background px-2 py-1 text-sm" value={filters.q} onChange={e=>setFilters({...filters,q:e.target.value})} placeholder="Pesquisar descrição ou favorecido"/>
    <Button size="sm" variant="ghost" onClick={()=>setFilters(NO_FILTERS)}>Limpar</Button>
   </div>
   <p className="text-xs text-muted-foreground">{rows.length} de {ready.rows.length} movimentação(ões) no período ({new Date(ready.period.from).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'})} a {new Date(Date.parse(ready.period.to)-1).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'})}) · na lista filtrada: <span className="font-medium text-foreground">entradas {brl(listTotals.inCents)} ({listTotals.inCount})</span> · saídas {brl(listTotals.outCents)} ({listTotals.outCount}) · filtros não alteram os totais do painel.</p>
   {ready.reviewAvailable&&<div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/50 p-2 text-sm">
    <Button size="sm" variant="outline" disabled={saving} onClick={()=>setSelected(new Set(visible.filter(r=>r.status==='pendente'&&r.suggestion.confidence==='alta'&&!r.suggestion.hint).map(r=>r.transactionId)))}>Selecionar confiáveis (IA)</Button>
    {selected.size>0&&<><span>{selected.size} selecionada(s)</span>
    <Button size="sm" disabled={saving} onClick={()=>bulk('aprovar')}>Confirmar selecionadas</Button>
    <select aria-label="Categoria para as saídas" className="rounded-md border bg-background px-2 py-1 text-sm" value={bulkCategory} onChange={e=>setBulkCategory(e.target.value as CostCategory|'')}><option value="">Categoria (saídas)…</option><optgroup label="Empresarial">{BUSINESS_CATEGORIES.map(c=><option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</optgroup><optgroup label="Pessoal">{PERSONAL_CATEGORIES.map(c=><option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</optgroup></select>
    <Button size="sm" variant="outline" disabled={saving} onClick={()=>bulk('empresarial')}>Marcar como empresarial</Button>
    <Button size="sm" variant="outline" disabled={saving} onClick={()=>bulk('pessoal')}>Marcar como pessoal</Button>
    <Button size="sm" variant="outline" disabled={saving} onClick={()=>bulk('investimento')}>Marcar como investimento</Button>
    <Button size="sm" variant="ghost" onClick={()=>setSelected(new Set())}>Limpar seleção</Button></>}</div>}
   {msg&&<p role="status" className="text-sm text-muted-foreground">{msg}</p>}{err&&<p role="alert" className="text-sm text-destructive">{err}</p>}
   {ready.rows.length===0?<p className="text-sm text-muted-foreground">{busy?'Carregando…':'Nenhuma movimentação salva neste período. Use “Sincronizar transações”.'}</p>:
   <div className="max-h-[36rem] overflow-auto rounded-md border"><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-card"><tr className="border-b">
    <th className="py-2 pl-2"><input type="checkbox" aria-label="Selecionar visíveis" checked={allVisibleSelected} onChange={e=>setSelected(e.target.checked?new Set([...selected,...visible.map(r=>r.transactionId)]):new Set([...selected].filter(id=>!visible.some(r=>r.transactionId===id))))}/></th>
    <th>Data</th><th>Descrição</th><th>Favorecido</th><th className="text-right">Valor</th><th>Tipo</th><th>Sugestão</th><th>Esfera</th><th>Status</th><th className="pr-2">Ações</th></tr></thead><tbody>
    {visible.map(r=><Fragment key={r.id}><tr className="border-b align-top">
     <td className="py-2 pl-2"><input type="checkbox" aria-label="Selecionar" checked={selected.has(r.transactionId)} onChange={e=>{const n=new Set(selected);if(e.target.checked)n.add(r.transactionId);else n.delete(r.transactionId);setSelected(n);}}/></td>
     <td className="whitespace-nowrap py-2">{r.transactionAt?new Date(r.transactionAt).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'}):'—'}</td>
     <td>{r.description??'—'}{r.type?<span className="block text-xs text-muted-foreground">{r.type}</span>:null}</td>
     <td>{r.counterparty??'—'}</td>
     <td className={`whitespace-nowrap text-right ${r.direction==='CREDITO'?'text-green-700':r.direction==='DEBITO'?'text-red-700':''}`}>{r.direction==='DEBITO'?'−':''}{r.amountCents===null?'—':brl(Math.abs(r.amountCents))}</td>
     <td>{clsText(r.cls)}<span className="block text-xs text-muted-foreground">{SOURCE_LABEL[r.cls.source]}</span>{r.recon&&<span className="block text-xs text-green-700">Conciliado{r.recon.mode==='auto'?' (auto)':''} · {r.recon.label}</span>}</td>
     <td className="text-xs">{r.suggestion.hint?<span className="text-amber-700">{r.suggestion.hint}</span>:clsText(r.suggestion)}{r.suggestion.confidence&&<span className={`block text-xs ${r.suggestion.confidence==='alta'?'text-green-700':'text-muted-foreground'}`}>confiança {r.suggestion.confidence} · Pipeflow IA</span>}</td>
     <td className="text-xs">{SPHERE_LABEL[r.sphere]}</td>
     <td className={`text-xs ${r.status==='pendente'?'text-amber-700':'text-green-700'}`}>{STATUS_LABEL[r.status]}</td>
     <td className="space-y-1 pr-2 text-xs">{ready.reviewAvailable&&r.status==='pendente'&&r.suggestion.kind!=='nao_classificado'&&!r.suggestion.hint&&<button type="button" className="block text-primary underline" disabled={saving} onClick={()=>void save([approveItem(r)],'Classificação aprovada.')}>Aprovar</button>}
      {ready.reviewAvailable&&<button type="button" className="block text-primary underline" onClick={()=>setEditing({id:r.transactionId,kind:r.cls.kind,category:r.cls.category,vendor:r.cls.vendor??'',rule:false})}>Alterar</button>}
      {r.cls.kind==='receita_operacional'&&r.direction==='CREDITO'&&!r.recon&&ready.reconciliationAvailable&&<button type="button" className="block text-primary underline" onClick={()=>void openRecon(r)}>Conciliar</button>}</td></tr>
     {editing?.id===r.transactionId&&<tr className="border-b bg-muted/40"><td colSpan={10} className="p-3"><div className="flex flex-wrap items-end gap-2 text-sm">
      <label>Tipo<select className="ml-2 rounded-md border bg-background px-2 py-1" value={editing.kind} onChange={e=>{const kind=e.target.value as BankKind;setEditing({...editing,kind,category:categoriesFor(kind).includes(editing.category as CostCategory)?editing.category:null});}}>{BANK_KINDS.filter(k=>r.direction==='CREDITO'?k!=='despesa_operacional'&&k!=='despesa_pessoal':k!=='receita_operacional'&&k!=='entrada_pessoal').map(k=><option key={k} value={k}>{SPHERE_LABEL[sphereOf(k)]} · {KIND_LABEL[k]}</option>)}</select></label>
      {categoriesFor(editing.kind).length>0&&<label>Categoria<select className="ml-2 rounded-md border bg-background px-2 py-1" value={editing.category??''} onChange={e=>setEditing({...editing,category:(e.target.value||null) as CostCategory|null})}><option value="">Escolha…</option>{categoriesFor(editing.kind).map(c=><option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select></label>}
      <label>Fornecedor<input className="ml-2 w-40 rounded-md border bg-background px-2 py-1" maxLength={80} value={editing.vendor} onChange={e=>setEditing({...editing,vendor:e.target.value})} placeholder="opcional"/></label>
      <label className="flex items-center gap-1"><input type="checkbox" checked={editing.rule} disabled={!r.description} onChange={e=>setEditing({...editing,rule:e.target.checked})}/>Salvar regra para movimentações futuras com esta descrição</label>
      <Button size="sm" disabled={saving} onClick={()=>{const same=editing.kind===r.suggestion.kind&&editing.category===r.suggestion.category;void save([{transactionId:r.transactionId,kind:editing.kind,category:editing.category,vendor:editing.vendor.trim()||null,expectedRevision:r.overrideRevision,decision:same?'aprovado':'corrigido',rule:editing.rule&&r.description?{field:'description',pattern:r.description}:null}],'Classificação salva.');}}>{saving?'Salvando…':'Salvar'}</Button>
      <Button size="sm" variant="ghost" onClick={()=>setEditing(null)}>Cancelar</Button></div></td></tr>}
     {reconFor===r.transactionId&&<tr className="border-b bg-muted/40"><td colSpan={10} className="space-y-2 p-3 text-sm">{!reconData?<p>Carregando candidatos…</p>:!reconData.ok?<p className="text-destructive">{reconData.error}</p>:<>
      {reconData.candidates.length===0?<p className="text-muted-foreground">Nenhum cliente, cobrança ou lançamento correspondente. Cadastre a cobrança em Clientes ou registre o recebimento no Financeiro.</p>:
      <ul className="space-y-1">{reconData.candidates.map(c=><li key={`${c.type}:${c.id}`}><label className="flex items-start gap-2"><input type="radio" name={`recon-${r.transactionId}`} className="mt-1" checked={reconPick===`${c.type}:${c.id}`} onChange={()=>setReconPick(`${c.type}:${c.id}`)}/><span><span className="font-medium">{c.clientId?`${reconData.clientNames[c.clientId]??'Cliente'} · `:''}{c.label}</span> · {brl(c.amountCents)} · {new Date(`${c.date}T12:00:00Z`).toLocaleDateString('pt-BR')}<span className="block text-xs text-muted-foreground">{c.reasons.join(' · ')}</span></span></label></li>)}</ul>}
      {reconData.accounts.length>0&&<label className="block">Conta do Financeiro<select className="ml-2 rounded-md border bg-background px-2 py-1" value={reconAccount} onChange={e=>setReconAccount(e.target.value)}><option value="">Escolha…</option>{reconData.accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
      <div className="flex gap-2"><Button size="sm" disabled={!reconPick||saving} onClick={()=>void confirmRecon(r)}>Confirmar conciliação</Button><Button size="sm" variant="ghost" onClick={()=>setReconFor(null)}>Cancelar</Button></div></>}</td></tr>}
    </Fragment>)}
   </tbody></table>{rows.length>300&&<p className="p-2 text-xs text-muted-foreground">Mostrando 300 de {rows.length}. Refine os filtros para ver as demais.</p>}</div>}
   {ready.rules.length>0&&<details className="text-sm"><summary className="cursor-pointer font-medium">Regras de classificação ({ready.rules.filter(r=>r.active).length} ativas)</summary><ul className="mt-2 space-y-1">{ready.rules.map(rule=><li key={rule.id??rule.pattern} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-2 py-1"><span className={rule.active?'':'text-muted-foreground line-through'}>“{rule.pattern}” ({rule.field==='description'?'descrição':'favorecido'}{rule.direction?`, ${rule.direction==='CREDITO'?'entradas':'saídas'}`:''}) → {clsText(rule)}</span>
    {ready.reviewAvailable&&rule.id&&<Button size="sm" variant="ghost" onClick={async()=>{const out=await toggleRule({data:{ruleId:rule.id as string,active:!rule.active}});if(!out.ok)setErr(out.error);else await reload();}}>{rule.active?'Desativar':'Reativar'}</Button>}</li>)}</ul></details>}
  </section></details>
 </div>;
}
