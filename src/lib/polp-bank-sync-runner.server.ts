import {syncPolpConsent,planSyncWindow,type SyncOutcome,type SyncPlan} from './polp-bank-sync.server';

// Ligação entre a orquestração (polp-bank-sync.server) e as RPCs service-only da migração 0078.
// As tabelas novas ainda não estão nos tipos gerados; o acesso usa um cliente sem tipos, restrito a estas operações.
type Result={data:unknown;error:unknown};
type Query=PromiseLike<Result>&{eq(c:string,v:unknown):Query;order(c:string,o:{ascending:boolean}):Query;limit(n:number):Query;maybeSingle():PromiseLike<Result>};
export type UntypedDb={rpc(fn:string,args:Record<string,unknown>):PromiseLike<Result>;from(table:string):{select(cols:string,opts?:{count?:'exact';head?:boolean}):Query}};

export const COMPANY_KEY='crm:1';
const LEASE_SECONDS=600;

export async function lastSuccessStartedAt(db:UntypedDb,companyKey:string,consentId:string):Promise<{ok:true;value:string|null}|{ok:false}>{
 const {data,error}=await db.from('polp_sync_state').select('last_success_started_at').eq('company_key',companyKey).eq('consent_id',consentId).maybeSingle();
 if(error)return {ok:false};
 const v=(data as {last_success_started_at?:string|null}|null)?.last_success_started_at??null;
 return {ok:true,value:v};
}

export async function runConsentSync(db:UntypedDb,input:{companyKey:string;consentId:string;trigger:'manual'|'scheduled';plan:SyncPlan}):Promise<SyncOutcome>{
 const api=await import('./polp-api.server');
 const credentials=api.polpCredentialsFromEnv();
 const {companyKey,consentId}=input;
 return syncPolpConsent({
  claim:async plan=>{
   const {data,error}=await db.rpc('claim_polp_sync',{p_company_key:companyKey,p_consent_id:consentId,p_trigger:input.trigger,p_mode:plan.mode,p_from:plan.from,p_to:plan.to,p_lease_seconds:LEASE_SECONDS});
   if(error){api.logPolpFailure('sync_claim',null,'unavailable');throw new Error('sync_unavailable');}
   return typeof data==='string'&&data?data:null;
  },
  listAccounts:()=>api.listPolpAccounts(credentials,consentId),
  listTransactions:(accountId,query)=>api.listPolpAccountTransactionsForSync(credentials,accountId,query),
  recordAccounts:async(runId,rows)=>{
   const {error}=await db.rpc('record_polp_bank_accounts',{p_company_key:companyKey,p_consent_id:consentId,p_run:runId,p_accounts:rows});
   if(error)throw new Error('record_accounts_failed');
  },
  upsert:async(runId,rows)=>{
   const {data,error}=await db.rpc('upsert_polp_bank_transactions',{p_company_key:companyKey,p_consent_id:consentId,p_run:runId,p_rows:rows});
   if(error)throw new Error('upsert_failed');
   const d=data as {inserted?:number;updated?:number;unchanged?:number}|null;
   return {inserted:Number(d?.inserted??0),updated:Number(d?.updated??0),unchanged:Number(d?.unchanged??0)};
  },
  finish:async(runId,status,skipped,errorCode)=>{
   const {error}=await db.rpc('finish_polp_sync',{p_company_key:companyKey,p_consent_id:consentId,p_run:runId,p_status:status,p_skipped:skipped,p_error_code:errorCode});
   if(error)throw new Error('finish_failed');
  },
 },{plan:input.plan,secret:process.env.CRM_SESSION_SECRET});
}

// Rotina agendada: somente incremental para consentimentos autorizados que já tiveram sincronização completa.
// Nunca faz a importação inicial nem períodos históricos automaticamente.
export async function runScheduledPolpSync(db:UntypedDb,now:number=Date.now()):Promise<{consents:number;synced:number;skipped:number;failed:number}>{
 const {data,error}=await db.from('polp_consents').select('consent_id,status').eq('status','AUTHORISED').limit(20);
 if(error)throw new Error('consents_unavailable');
 const rows=(data??[]) as {consent_id:string}[];
 let synced=0,skipped=0,failed=0;
 for(const row of rows){
  const last=await lastSuccessStartedAt(db,COMPANY_KEY,row.consent_id);
  if(!last.ok){failed++;continue;}
  const planned=planSyncWindow({mode:'incremental',now,lastSuccessStartedAt:last.value});
  if(!planned.ok){skipped++;continue;}
  const outcome=await runConsentSync(db,{companyKey:COMPANY_KEY,consentId:row.consent_id,trigger:'scheduled',plan:planned.plan}).catch(()=>({ok:false as const,error:'unexpected'}));
  if(outcome.ok)synced++;else failed++;
 }
 return {consents:rows.length,synced,skipped,failed};
}
