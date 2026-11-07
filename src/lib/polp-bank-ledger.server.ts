import {periodRange,summarizeLedger,categoryLabel,type LedgerPeriod} from './polp-bank-ledger';
import * as bc from './bank-classification';

// Painel e revisão financeira (somente leitura). Classificação calculada na leitura; decisões manuais (0079/0081) e
// conciliações (0080) são aplicadas por cima. Faturamento vem da fonte oficial (universe_confirmed_sources).
type Res={data:unknown;error:unknown};
type Q=PromiseLike<Res>&{eq(c:string,v:unknown):Q;in(c:string,v:unknown[]):Q;gte(c:string,v:unknown):Q;lt(c:string,v:unknown):Q;order(c:string,o:{ascending:boolean}):Q;range(a:number,b:number):Q;limit(n:number):Q};
export type LedgerDb={from(t:string):{select(c:string):Q}};
const COMPANY='crm:1';
const spMonth=(iso:string)=>{const d=new Date(Date.parse(iso)-3*60*60*1000);return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;};

export type ReviewRow=import('./polp-bank-ledger').LedgerRow&{transactionId:string;cls:bc.Classification;suggestion:bc.Classification;sphere:bc.Sphere;status:bc.ReviewStatus;
 overrideRevision:number;recon:{label:string;mode:string}|null};
export type RuleView={id:string|null;field:'description'|'counterparty';pattern:string;direction:'CREDITO'|'DEBITO'|null;kind:bc.BankKind;category:bc.CostCategory|null;vendor:string|null;active:boolean};
export type BankLedgerView={available:true;period:{from:string;to:string};rows:ReviewRow[];summary:import('./polp-bank-ledger').LedgerSummary;truncated:boolean;
 balance:{availableCents:number;updatedAt:string|null;accounts:number}|null;classificationEditable:boolean;reviewAvailable:boolean;reconciliationAvailable:boolean;
 reconciledIncomeCents:number;pendingReceipts:{count:number;cents:number};totals:bc.BankTotals;dashboard:bc.DashboardTotals&{monthRevenueCents:number;monthLabel:string};
 byCategory:ReturnType<typeof bc.expensesByCategory>;vendors:ReturnType<typeof bc.topVendors>;series:{year:number;months:ReturnType<typeof bc.monthlySeries>};
 monthly:{year:number;months:ReturnType<typeof bc.monthlyBreakdown>}|null;rules:RuleView[]}|{available:false};

export async function buildBankLedger(db:LedgerDb,periodKey:LedgerPeriod,now:number=Date.now()):Promise<BankLedgerView>{
 const period=periodRange(periodKey,now);
 const year=new Date(Date.parse(period.from)+12*60*60*1000).getUTCFullYear();
 const yearRange=periodRange('ano_atual',Date.parse(`${year}-06-15T12:00:00Z`));
 const from=period.from<yearRange.from?period.from:yearRange.from,to=period.to>yearRange.to?period.to:yearRange.to;
 type TxRow={id:string;polp_transaction_id:string;transaction_at:string|null;description:string|null;amount_cents:number|null;currency:string;direction:'CREDITO'|'DEBITO'|null;polp_account_id:string;category_ref:string|null;transaction_type:string|null;counterparty_name:string|null};
 const PAGE=1000,MAX_PAGES=15;const raw:TxRow[]=[];let truncated=false;
 for(let page=0;page<MAX_PAGES;page++){
  const {data,error}=await db.from('polp_bank_transactions').select('id,polp_transaction_id,transaction_at,description,amount_cents,currency,direction,polp_account_id,category_ref,transaction_type,counterparty_name')
   .eq('company_key',COMPANY).gte('transaction_at',from).lt('transaction_at',to).order('transaction_at',{ascending:false}).range(page*PAGE,page*PAGE+PAGE-1);
  if(error)return {available:false};
  const list=(data??[]) as TxRow[];raw.push(...list);
  if(list.length<PAGE)break;
  if(page===MAX_PAGES-1)truncated=true;
 }
 const dateOnly=(iso:string)=>new Date(Date.parse(iso)-3*60*60*1000).toISOString().slice(0,10);
 // PostgREST devolve no máximo 1000 linhas por consulta: paginar as decisões manuais (podem passar de mil).
 const allOverrides=async(cols:string):Promise<Res>=>{const out:unknown[]=[];for(let p=0;p<30;p++){const r=await db.from('polp_bank_classification_overrides').select(cols).eq('company_key',COMPANY).order('polp_transaction_id',{ascending:true}).range(p*1000,p*1000+999);
  if(r.error)return r;const list=(r.data??[]) as unknown[];out.push(...list);if(list.length<1000)break;}return {data:out,error:null};};
 let ov=await allOverrides('polp_transaction_id,kind,category,vendor,revision,decision');
 const reviewAvailable=!ov.error;
 if(ov.error)ov=await allOverrides('polp_transaction_id,kind,category,vendor,revision');
 let rl=await db.from('polp_bank_classification_rules').select('id,field,pattern,direction,kind,category,vendor,active').eq('company_key',COMPANY).order('updated_at',{ascending:false}).limit(500);
 if(rl.error)rl=await db.from('polp_bank_classification_rules').select('id,field,pattern,direction,kind,category,vendor').eq('company_key',COMPANY).order('updated_at',{ascending:false}).limit(500);
 const [accounts,snapshots,revenue]=await Promise.all([
  db.from('polp_bank_accounts').select('polp_account_id,number_suffix').eq('company_key',COMPANY).limit(50),
  db.from('polp_bank_balance_snapshots').select('polp_account_id,available_cents,bank_updated_at,currency').eq('company_key',COMPANY).order('bank_updated_at',{ascending:false}).limit(200),
  db.from('universe_confirmed_sources').select('amount,date,status').eq('status','confirmada').gte('date',dateOnly(from)).lt('date',dateOnly(to)).limit(20000),
 ]);
 if(accounts.error||snapshots.error)return {available:false};
 const classificationEditable=!ov.error&&!rl.error;
 type OvRow={polp_transaction_id:string;kind:bc.BankKind;category:bc.CostCategory|null;vendor:string|null;revision:number;decision?:'aprovado'|'corrigido'};
 const overrides=new Map(classificationEditable?((ov.data??[]) as OvRow[]).map(o=>[o.polp_transaction_id,o]):[]);
 const rules:RuleView[]=classificationEditable?((rl.data??[]) as {id:string;field:'description'|'counterparty';pattern:string;direction:string;kind:bc.BankKind;category:bc.CostCategory|null;vendor:string|null;active?:boolean}[])
  .map(r=>({id:r.id,field:r.field,pattern:r.pattern,direction:r.direction==='CREDITO'||r.direction==='DEBITO'?r.direction:null,kind:r.kind,category:r.category,vendor:r.vendor,active:r.active!==false})):[];
 const activeRules=rules.filter(r=>r.active);
 // Conciliação (0080)
 const credits=raw.filter(r=>r.direction==='CREDITO').map(r=>r.polp_transaction_id);
 // Todas as conciliações da empresa, paginadas e filtradas em memória: uma lista longa de ids na URL (.in) travava a leitura
 // quando o período tinha muitas entradas (ex.: ano inteiro carregado junto do mês).
 const creditSet=new Set(credits);
 const rec=await (async():Promise<Res>=>{const out:unknown[]=[];for(let p=0;p<30;p++){const r=await db.from('polp_bank_reconciliations').select('polp_transaction_id,target_type,charge_id,mode').eq('company_key',COMPANY).order('polp_transaction_id',{ascending:true}).range(p*1000,p*1000+999);
  if(r.error)return r;const list=(r.data??[]) as unknown[];out.push(...list);if(list.length<1000)break;}return {data:(out as {polp_transaction_id:string}[]).filter(x=>creditSet.has(x.polp_transaction_id)),error:null};})();
 const reconciliationAvailable=!rec.error;
 const recRows=reconciliationAvailable&&credits.length?((rec.data??[]) as {polp_transaction_id:string;target_type:string;charge_id:string|null;mode:string}[]):[];
 const chargeIds=[...new Set(recRows.map(r=>r.charge_id).filter((x):x is string=>Boolean(x)))];
 const chargeInfo=new Map<string,{description:string;client_id:string}>();const clientName=new Map<string,string>();
 if(chargeIds.length){const ch=await db.from('crm_client_charges').select('id,description,client_id').in('id',chargeIds);for(const c of (ch.data??[]) as {id:string;description:string;client_id:string}[])chargeInfo.set(c.id,c);
  const cids=[...new Set([...chargeInfo.values()].map(c=>c.client_id))];if(cids.length){const cl=await db.from('crm_clients').select('id,trade_name,legal_name').in('id',cids);for(const c of (cl.data??[]) as {id:string;trade_name:string|null;legal_name:string|null}[])clientName.set(c.id,(c.trade_name||c.legal_name||'Cliente').trim());}}
 const reconMap=new Map(recRows.map(r=>{const c=r.charge_id?chargeInfo.get(r.charge_id):undefined;return [r.polp_transaction_id,{label:r.target_type==='finance_settlement'?'Recebimento lançado no Financeiro':`${c?clientName.get(c.client_id)??'Cliente':'Cliente'}${c?` · ${c.description}`:''}`,mode:r.mode}];}));
 const suffix=new Map(((accounts.data??[]) as {polp_account_id:string;number_suffix:string|null}[]).map(a=>[a.polp_account_id,a.number_suffix]));
 const latest=new Map<string,{available_cents:number|null;bank_updated_at:string;currency:string|null}>();
 for(const s of (snapshots.data??[]) as {polp_account_id:string;available_cents:number|null;bank_updated_at:string;currency:string|null}[])if(!latest.has(s.polp_account_id))latest.set(s.polp_account_id,s);
 const brl=[...latest.values()].filter(s=>s.available_cents!==null&&(s.currency??'BRL')==='BRL');
 const balance=brl.length?{availableCents:brl.reduce((t,s)=>t+Number(s.available_cents),0),updatedAt:brl.map(s=>s.bank_updated_at).sort().at(-1)??null,accounts:brl.length}:null;
 // Aprendizado (Pipeflow IA): histórico de confirmações por favorecido normalizado, montado a partir das
 // decisões manuais já salvas. Sugestões aprendidas ficam pendentes; nada é confirmado automaticamente.
 const history=new Map<string,bc.HistoryEntry[]>();
 for(const r of raw){
  const o=overrides.get(r.polp_transaction_id);if(!o)continue;
  const key=bc.normalizeText(r.counterparty_name);if(key.length<3)continue;
  const entry:bc.HistoryEntry={kind:o.kind,category:o.category,vendor:o.vendor,direction:r.direction};
  history.set(key,[...(history.get(key)??[]),entry]);
 }
 const all:ReviewRow[]=raw.map(r=>{
  const o=overrides.get(r.polp_transaction_id)??null;const input={direction:r.direction,type:r.transaction_type,categoryRef:r.category_ref,description:r.description,counterparty:r.counterparty_name};
  const suggestion=bc.classify(input,activeRules,null,history);
  const cls=o?bc.classify(input,activeRules,{kind:o.kind,category:o.category,vendor:o.vendor},history):suggestion;
  const recon=reconMap.get(r.polp_transaction_id)??null;
  return {id:r.id,transactionId:r.polp_transaction_id,transactionAt:r.transaction_at,description:r.description,amountCents:r.amount_cents===null?null:Number(r.amount_cents),currency:r.currency,direction:r.direction,
   accountSuffix:suffix.get(r.polp_account_id)??null,category:categoryLabel(r.category_ref),type:r.transaction_type,counterparty:r.counterparty_name,cls,suggestion,sphere:bc.sphereOf(cls.kind),
   status:bc.reviewStatus(cls,o?{decision:o.decision??'corrigido'}:null,Boolean(recon)),overrideRevision:o?.revision??0,recon};
 });
 const inPeriod=(r:ReviewRow)=>Boolean(r.transactionAt&&r.transactionAt>=period.from&&r.transactionAt<period.to);
 const rows=all.filter(inPeriod);
 const agg=(list:ReviewRow[])=>list.map(r=>({amountCents:r.amountCents,currency:r.currency,direction:r.direction,transactionAt:r.transactionAt,cls:r.cls,status:r.status}));
 // Faturamento confirmado (fonte oficial): por mês e no período.
 const revRows=revenue.error?[]:((revenue.data??[]) as {amount:number;date:string}[]);
 const revenueByMonth=new Map<string,number>();let periodRevenue=0;
 const pFrom=dateOnly(period.from),pTo=dateOnly(period.to);
 for(const r of revRows){const m=r.date.slice(0,7);revenueByMonth.set(m,(revenueByMonth.get(m)??0)+Number(r.amount));if(r.date>=pFrom&&r.date<pTo)periodRevenue+=Number(r.amount);}
 const lastMonth=spMonth(new Date(Math.min(Date.parse(period.to)-1,now)).toISOString());
 let reconciledIncomeCents=0,pendingCount=0,pendingCents=0;
 for(const r of rows){if(r.cls.kind!=='receita_operacional'||r.direction!=='CREDITO'||r.amountCents===null||r.currency!=='BRL')continue;if(r.recon)reconciledIncomeCents+=Math.abs(r.amountCents);else{pendingCount++;pendingCents+=Math.abs(r.amountCents);}}
 const isAnnual=periodKey==='ano_atual'||periodKey==='ano_anterior';
 return {available:true,period,rows,summary:summarizeLedger(rows),truncated,balance,classificationEditable,reviewAvailable,reconciliationAvailable,reconciledIncomeCents,pendingReceipts:{count:pendingCount,cents:pendingCents},
  totals:bc.bankTotals(agg(rows)),dashboard:{...bc.dashboardTotals(agg(rows),periodRevenue),monthRevenueCents:revenueByMonth.get(lastMonth)??0,monthLabel:lastMonth},
  byCategory:bc.expensesByCategory(agg(rows).filter(r=>r.status!=='pendente')),vendors:bc.topVendors(agg(rows).filter(r=>r.status!=='pendente')),
  series:{year,months:bc.monthlySeries(agg(all),revenueByMonth,year)},monthly:isAnnual?{year,months:bc.monthlyBreakdown(agg(rows),year)}:null,rules};
}
