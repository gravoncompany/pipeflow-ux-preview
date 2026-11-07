import {signCrmSession} from './crm-session-token';
import {moneyToCents,type PolpAccount,type PolpTransactionSync} from './polp';
import type {PolpCallResult,PolpPage,PolpTransactionQuery} from './polp-api.server';

// Fase 1 — Base bancária. Espelha transações da Polp em tabelas service-only (migração 0078) sem criar lançamentos
// financeiros. Idempotente: a mesma transação lida várias vezes nunca duplica; mudanças do provedor viram revisões.

const DAY=24*60*60*1000;
export const MAX_WINDOW_DAYS=92;
export const INITIAL_SYNC_DAYS=30;
export const MAX_ACCOUNTS_PER_SYNC=5;
export const UPSERT_BATCH_SIZE=500;
export const COUNTERPARTY_KEY_VERSION=1;

const iso=(value:string|null|undefined):string|null=>{
 if(!value)return null;
 const t=Date.parse(value);
 return Number.isNaN(t)?null:new Date(t).toISOString();
};
const bounded=(value:string|null|undefined,max:number):string|null=>{
 const v=typeof value==='string'?value.trim():'';
 return v?v.slice(0,max):null;
};
const currencyCode=(value:string|null|undefined):string=>{
 const v=(value??'').trim().toUpperCase()||'BRL';
 return /^[A-Z]{3}$/.test(v)?v:'XXX';
};

// HMAC do documento da contraparte (CPF/CNPJ). O documento nunca é armazenado nem devolvido; a mesma função servirá
// para comparar com o CNPJ dos clientes na conciliação (Fase 3). Propósito exclusivo e versão de chave explícita.
export async function counterpartyDocHmac(doc:string|null|undefined,secret:string|undefined):Promise<{hmac:string;kind:'cpf'|'cnpj';version:number}|null>{
 if(!secret||!doc)return null;
 const digits=doc.replace(/\D/g,'');
 const kind=digits.length===11?'cpf':digits.length===14?'cnpj':null;
 if(!kind||/^(\d)\1+$/.test(digits))return null;
 return {hmac:await signCrmSession(`polp-counterparty-doc:v${COUNTERPARTY_KEY_VERSION}:${kind}:${digits}`,secret),kind,version:COUNTERPARTY_KEY_VERSION};
}

export type BankTransactionRow={
 polp_transaction_id:string;polp_account_id:string;transaction_at:string|null;amount_raw:string;amount_cents:number|null;currency:string;
 direction:'CREDITO'|'DEBITO'|null;transaction_type:string|null;description:string|null;category_ref:string|null;counterparty_name:string|null;
 counterparty_doc_hmac:string|null;counterparty_doc_kind:'cpf'|'cnpj'|null;counterparty_key_version:number|null;counterparty_person_type:'PESSOA_NATURAL'|'PESSOA_JURIDICA'|null;
 provider_created_at:string|null;provider_updated_at:string|null;content_hash:string;
};

async function sha256Hex(value:string):Promise<string>{
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
 return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}
// Hash estável do conteúdo normalizado (ordem de chaves fixa): detecta mudanças reais do provedor.
export async function contentHash(row:Omit<BankTransactionRow,'content_hash'>):Promise<string>{
 const keys=Object.keys(row).sort() as (keyof typeof row)[];
 return sha256Hex(JSON.stringify(keys.map(k=>[k,row[k]])));
}

export async function normalizeTransaction(t:PolpTransactionSync,accountId:string,secret:string|undefined):Promise<BankTransactionRow>{
 const doc=await counterpartyDocHmac(t.partie_cnpj_cpf,secret);
 const amountRaw=bounded(t.transaction_amount?.amount,40)??'ausente';
 const base:Omit<BankTransactionRow,'content_hash'>={
  polp_transaction_id:t.id,polp_account_id:accountId,transaction_at:iso(t.transaction_date_time),
  amount_raw:amountRaw,amount_cents:t.transaction_amount?moneyToCents(t.transaction_amount):null,currency:currencyCode(t.transaction_amount?.currency),
  direction:t.credit_debit_type??null,transaction_type:bounded(t.type,60),description:bounded(t.transaction_name,300),category_ref:bounded(t.category_ref,80),
  counterparty_name:bounded(t.counterparty?.alias||t.counterparty?.name,200),
  counterparty_doc_hmac:doc?.hmac??null,counterparty_doc_kind:doc?.kind??null,counterparty_key_version:doc?.version??null,
  counterparty_person_type:t.partie_person_type??null,provider_created_at:iso(t.created_at),provider_updated_at:iso(t.updated_at),
 };
 return {...base,content_hash:await contentHash(base)};
}

export type BankAccountRow={polp_account_id:string;account_type:string|null;account_subtype:string|null;currency:string|null;number_suffix:string|null;
 bank_updated_at:string|null;available_cents:number|null;blocked_cents:number|null;invested_cents:number|null;balance_currency:string|null};
export function normalizeAccount(a:PolpAccount):BankAccountRow{
 const digits=(a.number??'').replace(/\D/g,'');
 const cur=(a.currency??'').trim().toUpperCase();
 const balanceCur=(a.balance?.available_amount?.currency??'').trim().toUpperCase();
 return {polp_account_id:a.id,account_type:bounded(a.type,60),account_subtype:bounded(a.subtype,60),currency:/^[A-Z]{3}$/.test(cur)?cur:null,
  number_suffix:digits?digits.slice(-4):null,bank_updated_at:a.balance?iso(a.balance.update_date_time):null,
  available_cents:moneyToCents(a.balance?.available_amount),blocked_cents:moneyToCents(a.balance?.blocked_amount),invested_cents:moneyToCents(a.balance?.automatically_invested_amount),
  balance_currency:/^[A-Z]{3}$/.test(balanceCur)?balanceCur:null};
}

// Janela da sincronização. Incremental: transações atualizadas no provedor desde a última sincronização completa
// (com 24 h de sobreposição; a idempotência absorve repetições). Período: por data da transação, máximo 92 dias.
// Não há importação histórica automática: período anterior exige escolha explícita do usuário.
export type SyncPlan={mode:'incremental'|'range';from:string;to:string;query:PolpTransactionQuery};
export function planSyncWindow(input:{mode:'incremental'|'range';now:number;lastSuccessStartedAt:string|null;fromDate?:string;toDate?:string}):{ok:true;plan:SyncPlan}|{ok:false;error:'initial_required'|'window_too_large'|'invalid_range'}{
 if(input.mode==='incremental'){
  const last=input.lastSuccessStartedAt?Date.parse(input.lastSuccessStartedAt):NaN;
  if(Number.isNaN(last))return {ok:false,error:'initial_required'};
  const from=new Date(last-DAY),to=new Date(input.now);
  if(to.getTime()-from.getTime()>MAX_WINDOW_DAYS*DAY)return {ok:false,error:'window_too_large'};
  return {ok:true,plan:{mode:'incremental',from:from.toISOString(),to:to.toISOString(),query:{fromUpdatedAt:from.toISOString(),toUpdatedAt:to.toISOString()}}};
 }
 const from=input.fromDate?Date.parse(input.fromDate):NaN,to=input.toDate?Date.parse(input.toDate):NaN;
 if(Number.isNaN(from)||Number.isNaN(to)||to<from||to>input.now+DAY)return {ok:false,error:'invalid_range'};
 if(to-from>MAX_WINDOW_DAYS*DAY)return {ok:false,error:'window_too_large'};
 const f=new Date(from).toISOString(),t=new Date(to).toISOString();
 return {ok:true,plan:{mode:'range',from:f,to:t,query:{fromDate:f,toDate:t}}};
}
export function initialRange(now:number):{fromDate:string;toDate:string}{return {fromDate:new Date(now-INITIAL_SYNC_DAYS*DAY).toISOString(),toDate:new Date(now).toISOString()};}

export type SyncDeps={
 claim(plan:SyncPlan):Promise<string|null>;
 listAccounts():Promise<PolpCallResult<PolpPage<PolpAccount>>>;
 listTransactions(accountId:string,query:PolpTransactionQuery):Promise<PolpCallResult<PolpPage<PolpTransactionSync>>>;
 recordAccounts(runId:string,rows:BankAccountRow[]):Promise<void>;
 upsert(runId:string,rows:BankTransactionRow[]):Promise<{inserted:number;updated:number;unchanged:number}>;
 finish(runId:string,status:'success'|'partial'|'failed',skipped:number,errorCode:string|null):Promise<void>;
};
export type SyncOutcome={ok:true;runId:string;status:'success'|'partial';inserted:number;updated:number;unchanged:number;skipped:number;accounts:number;warnings:string[]}|{ok:false;error:string;runId?:string};

export async function syncPolpConsent(deps:SyncDeps,input:{plan:SyncPlan;secret:string|undefined}):Promise<SyncOutcome>{
 if(!input.secret)return {ok:false,error:'Sessão indisponível. Nenhuma sincronização foi iniciada.'};
 const runId=await deps.claim(input.plan);
 if(!runId)return {ok:false,error:'Já existe uma sincronização em andamento para esta conexão. Aguarde alguns minutos.'};
 let finished=false;
 const finish=async(status:'success'|'partial'|'failed',skipped:number,code:string|null)=>{finished=true;await deps.finish(runId,status,skipped,code);};
 try{
  const accounts=await deps.listAccounts();
  if(!accounts.ok){await finish('failed',0,'accounts_unavailable');return {ok:false,runId,error:'Não foi possível consultar as contas na Polp. Nada foi alterado.'};}
  const selected=accounts.data.items.slice(0,MAX_ACCOUNTS_PER_SYNC);
  await deps.recordAccounts(runId,selected.map(normalizeAccount));
  const warnings:string[]=[];let partial=!accounts.data.complete||accounts.data.items.length>selected.length;
  if(partial)warnings.push('Nem todas as contas foram sincronizadas (limite por execução).');
  let inserted=0,updated=0,unchanged=0,skipped=accounts.data.skipped;
  for(const account of selected){
   const page=await deps.listTransactions(account.id,input.plan.query);
   if(!page.ok){partial=true;warnings.push('As transações de uma conta não puderam ser lidas nesta execução.');continue;}
   if(!page.data.complete){partial=true;warnings.push('Há mais transações na janela do que o limite por execução; sincronize períodos menores.');}
   skipped+=page.data.skipped;
   const rows:BankTransactionRow[]=[];
   for(const t of page.data.items)rows.push(await normalizeTransaction(t,account.id,input.secret));
   for(let i=0;i<rows.length;i+=UPSERT_BATCH_SIZE){
    const r=await deps.upsert(runId,rows.slice(i,i+UPSERT_BATCH_SIZE));
    inserted+=r.inserted;updated+=r.updated;unchanged+=r.unchanged;
   }
  }
  if(skipped>0)warnings.push(`${skipped} registro(s) em formato inesperado foram ignorados.`);
  const status=partial?'partial':'success';
  await finish(status,skipped,partial?'partial_read':null);
  return {ok:true,runId,status,inserted,updated,unchanged,skipped,accounts:selected.length,warnings};
 }catch{
  if(!finished)await deps.finish(runId,'failed',0,'unexpected').catch(()=>undefined);
  return {ok:false,runId,error:'A sincronização foi interrompida. Os registros já salvos foram preservados; tente novamente.'};
 }
}

// Autorização da rotina agendada: segredo próprio com no mínimo 32 caracteres, comparação em tempo constante.
// Sem segredo configurado, a rotina permanece desativada.
export function authorizedJobRequest(received:string,secret:string|undefined):boolean{
 if(!secret||secret.length<32)return false;
 const expected=`Bearer ${secret}`;
 let diff=received.length^expected.length;
 for(let i=0;i<expected.length;i++)diff|=received.charCodeAt(i)^expected.charCodeAt(i);
 return diff===0;
}
