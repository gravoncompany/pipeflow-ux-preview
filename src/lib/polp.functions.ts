import {createServerFn} from '@tanstack/react-start';
import {z} from 'zod';
import {validCpf,validCnpj,onlyDigits,usableAuthUrl,consentGuidance,polpCreateErrorMessage,polpRecreateErrorMessage,polpReadErrorMessage,type PolpConsent,type PolpConsentDetail,type PolpConsentView,type PolpAccount,type PolpTransaction,type PolpTransactionSummary,summarizeTransactions} from './polp';
export {polpCreateErrorMessage,polpRecreateErrorMessage};

export const checkPolpConnection=createServerFn({method:'POST'}).handler(async()=>{
 const {financeAccess}=await import('./finance-management.server');await financeAccess(false);
 const {testPolpCatalog,polpCredentialsFromEnv}=await import('./polp-api.server');
 const result=await testPolpCatalog(polpCredentialsFromEnv());
 await financeAccess(false);return result;
});

function mapRow(row:{id:string;consent_id:string;institution_name:string;status:string;execution_status:string|null;url_expires_at:string|null;last_checked_at:string}):PolpConsentView {
 return {id:row.id,consentId:row.consent_id,institutionName:row.institution_name,status:row.status as PolpConsentView['status'],executionStatus:row.execution_status,urlExpiresAt:row.url_expires_at,lastCheckedAt:row.last_checked_at};
}
const ROW_COLUMNS='id,consent_id,institution_name,status,execution_status,url_expires_at,last_checked_at';
// Campos persistidos: apenas estado e validade do link — nunca a URL, documentos ou textos do provedor.
function consentRowFields(c:PolpConsent){
 return {status:c.status,execution_status:c.execution_status??null,url_expires_at:c.url_to_authenticate_expires_at??null,last_checked_at:new Date().toISOString()};
}
function consentDetail(c:PolpConsent):PolpConsentDetail{return {statusLabel:c.status_label??null,error:c.error??null};}
export type PolpConsentOutcome={ok:true;consent:PolpConsentView;authUrl:string|null;authUrlExpiresAt:string|null;detail:PolpConsentDetail;notice:string|null;renewalProof:string|null}|{ok:false;error:string};
// Monta a resposta: o link só sai se ainda estiver válido; caso contrário, orientação para gerar um novo.
export function consentOutcome(row:PolpConsentView,c:PolpConsent,notice:string|null=null,now:number=Date.now()):PolpConsentOutcome{
 const authUrl=usableAuthUrl(c,now);
 return {ok:true,consent:row,authUrl,authUrlExpiresAt:authUrl?c.url_to_authenticate_expires_at??null:null,detail:consentDetail(c),notice:notice??consentGuidance(c.status,c.url_to_authenticate_expires_at,now),renewalProof:null};
}

// Lista os consentimentos registrados (sem dados bancários nem documentos).
export const listPolpConsents=createServerFn({method:'POST'}).handler(async():Promise<PolpConsentView[]>=>{
 const {financeAccess}=await import('./finance-management.server');const {db}=await financeAccess(false);
 const {data,error}=await db.from('polp_consents').select(ROW_COLUMNS).order('created_at',{ascending:false}).limit(20);
 if(error)throw new Error('Não foi possível carregar as conexões Polp.');
 await financeAccess(false);
 return (data??[]).map(mapRow);
});

const connectInput=z.object({cpf:z.string().max(20),cnpj:z.string().max(20),confirmed:z.literal(true)});
// Cria o consentimento somente após o clique confirmado. CPF/CNPJ vão apenas para a Polp e nunca são gravados.
export const connectNubankPj=createServerFn({method:'POST'})
 .inputValidator((input:unknown)=>connectInput.parse(input))
 .handler(async({data}):Promise<PolpConsentOutcome>=>{
  const {financeAccess}=await import('./finance-management.server');const {db}=await financeAccess(false);
  const cpf=onlyDigits(data.cpf),cnpj=onlyDigits(data.cnpj);
  if(!validCpf(cpf)||!validCnpj(cnpj))return {ok:false,error:'Informe o CPF do representante (11 dígitos) e o CNPJ da empresa (14 dígitos).'};
  const api=await import('./polp-api.server');
  const credentials=api.polpCredentialsFromEnv();
  const institution=await api.findNubankInstitution(credentials);
  if(!institution.ok)return {ok:false,error:'Nubank PJ não está disponível no catálogo da Polp neste momento.'};
  // Vínculo opaco dos documentos (HMAC) — permite provar depois que o consentimento é desta empresa/representante.
  const renewal=await import('./polp-renewal.server');
  const secret=process.env.CRM_SESSION_SECRET;
  let binding:string;
  try{binding=await renewal.polpDocumentBinding(cpf,cnpj,secret);}catch{return {ok:false,error:'Sessão indisponível. Entre novamente e tente de novo. Nenhuma solicitação foi feita.'};}
  // Antes de criar: reaproveita apenas consentimento com vínculo idêntico (mesmo CNPJ e representante).
  // Sem correspondência, o POST usa avoidDuplicates: a própria Polp devolve o consentimento ativo com os mesmos
  // documentos (inclusive os antigos, sem vínculo) ou cria um novo. Recusado/expirado vinculado vai para renovação explícita.
  const existing=await api.listPolpConsents(credentials);
  if(!existing.ok)return {ok:false,error:'Não foi possível verificar conexões existentes na Polp. Nenhuma nova solicitação foi feita.'};
  const found=renewal.selectBoundConsent(existing.data,institution.data.id,binding);
  const created=found?{ok:true as const,data:found.consent,httpStatus:200}:await api.createPolpConsent(credentials,{institutionId:institution.data.id,cpf,cnpj,clienteUserId:binding});
  if(!created.ok)return {ok:false,error:polpCreateErrorMessage(created.reason,created.httpStatus)};
  if(!renewal.createdConsentMatches(created.data,institution.data.id,binding))return {ok:false,error:'A Polp devolveu um consentimento de outra instituição ou de outros documentos. Nada foi registrado; contate o suporte da Polp.'};
  const {data:row,error}=await db.from('polp_consents').upsert({consent_id:created.data.id,institution_id:created.data.institution_id,institution_name:institution.data.name,products:created.data.products??['ACCOUNT'],...consentRowFields(created.data)},{onConflict:'consent_id'}).select(ROW_COLUMNS).single();
  if(error||!row)return {ok:false,error:found?'Conexão existente encontrada na Polp, mas não foi possível registrá-la. Nenhuma nova solicitação foi feita.':'Consentimento criado na Polp, mas não foi possível registrá-lo. Anote que a autorização pode estar pendente.'};
  await financeAccess(false);
  const notice=created.data.status==='AUTHORISED'?'A conta Nubank PJ já está conectada. Nenhuma nova solicitação foi feita.':null;
  const outcome=consentOutcome(mapRow(row),created.data,notice);
  if(!outcome.ok)return outcome;
  if(found&&!notice)outcome.notice=['Conexão existente desta empresa reaproveitada; nenhuma nova solicitação foi feita.',outcome.notice].filter(Boolean).join(' ');
  // Prova da correspondência (lista vinculada ou avoidDuplicates da Polp), exigida para renovar o link.
  if(created.data.status!=='AUTHORISED')outcome.renewalProof=await renewal.issueRenewalProof(created.data.id,binding,secret);
  return outcome;
 });

// Atualiza o status real na Polp e no registro local. O link só é devolvido se ainda estiver válido.
export const refreshPolpConsent=createServerFn({method:'POST'})
 .inputValidator((input:unknown)=>z.object({consentId:z.string().min(8).max(128)}).parse(input))
 .handler(async({data}):Promise<PolpConsentOutcome>=>{
  const {financeAccess}=await import('./finance-management.server');const {db}=await financeAccess(false);
  const {data:existing}=await db.from('polp_consents').select('consent_id').eq('consent_id',data.consentId).maybeSingle();
  if(!existing)return {ok:false,error:'Conexão não encontrada.'};
  const api=await import('./polp-api.server');
  const current=await api.getPolpConsent(api.polpCredentialsFromEnv(),data.consentId);
  if(!current.ok)return {ok:false,error:polpReadErrorMessage(current.reason,current.httpStatus)};
  if(current.data.id!==data.consentId)return {ok:false,error:'A Polp devolveu um consentimento diferente do solicitado.'};
  const {data:row,error}=await db.from('polp_consents').update({...consentRowFields(current.data),updated_at:new Date().toISOString()}).eq('consent_id',data.consentId).select(ROW_COLUMNS).single();
  if(error||!row)return {ok:false,error:'Não foi possível atualizar o registro da conexão.'};
  await financeAccess(false);
  return consentOutcome(mapRow(row),current.data);
 });

// Gera novo link de autorização no mesmo consentimento (POST /consents/{id}/recreate), somente após clique
// explícito, confirmação e prova assinada de que o consentimento pertence ao CNPJ/representante informados.
// Um lease atômico no banco impede renovações simultâneas; autorizados e links válidos nunca são recriados.
type RpcClient={rpc(fn:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>};
export const recreatePolpConsentLink=createServerFn({method:'POST'})
 .inputValidator((input:unknown)=>z.object({consentId:z.string().min(8).max(128),proof:z.string().min(1).max(2000),confirmed:z.literal(true)}).parse(input))
 .handler(async({data}):Promise<PolpConsentOutcome>=>{
  const {financeAccess}=await import('./finance-management.server');const {db}=await financeAccess(false);
  const renewal=await import('./polp-renewal.server');
  const secret=process.env.CRM_SESSION_SECRET;
  const binding=await renewal.verifyRenewalProof(data.proof,data.consentId,secret);
  if(!binding)return {ok:false,error:'Confirme a empresa: informe o CPF do representante e o CNPJ em "Conectar Nubank PJ" antes de gerar um novo link. Nenhum novo link foi gerado.'};
  const {data:existing}=await db.from('polp_consents').select('consent_id,institution_id').eq('consent_id',data.consentId).maybeSingle();
  if(!existing)return {ok:false,error:'Conexão não encontrada.'};
  const api=await import('./polp-api.server');
  const credentials=api.polpCredentialsFromEnv();
  const rpc=db as unknown as RpcClient;
  const result=await renewal.renewConsentLink({
   claimLease:async consentId=>{
    const {data:lease,error}=await rpc.rpc('claim_polp_consent_renewal',{p_consent_id:consentId,p_lease_seconds:90});
    if(error){api.logPolpFailure('renewal_lease',null,'unavailable');return {ok:false,reason:'unavailable'};}
    return typeof lease==='string'&&lease?{ok:true,leaseId:lease}:{ok:false,reason:'busy'};
   },
   releaseLease:async(consentId,leaseId)=>{await rpc.rpc('release_polp_consent_renewal',{p_consent_id:consentId,p_lease_id:leaseId});},
   getConsent:consentId=>api.getPolpConsent(credentials,consentId),
   recreate:consentId=>api.recreatePolpConsent(credentials,consentId),
   save:async consent=>{const {data:row,error}=await db.from('polp_consents').update({...consentRowFields(consent),updated_at:new Date().toISOString()}).eq('consent_id',data.consentId).select(ROW_COLUMNS).single();return error||!row?null:row;},
  },{consentId:data.consentId,institutionId:existing.institution_id,binding});
  if(!result.ok)return result;
  await financeAccess(false);
  const outcome=consentOutcome(mapRow(result.row),result.consent,result.notice);
  if(outcome.ok&&result.consent.status!=='AUTHORISED')outcome.renewalProof=data.proof;
  return outcome;
 });

const readInput=z.object({consentId:z.string().min(8).max(128),fromDate:z.string().max(40),toDate:z.string().max(40)});
export type PolpReadResult={ok:true;accounts:PolpAccount[];transactions:PolpTransaction[];summary:PolpTransactionSummary;warnings:string[]}|{ok:false;error:string};
// Avisos objetivos (sem dados bancários) quando a leitura foi parcial; falhas nunca são descartadas em silêncio.
export function readWarnings(input:{accountsComplete:boolean;accountsSkipped:number;accountsOmitted:number;failedAccounts:{reason:string;httpStatus:number|null}[];transactionsIncomplete:number;transactionsSkipped:number;excludedInvalidAmount:number;excludedNonBrl:number;excludedNoDirection:number}):string[]{
 const w:string[]=[];
 if(!input.accountsComplete||input.accountsOmitted>0)w.push('Nem todas as contas foram consultadas (limite da consulta manual).');
 if(input.accountsSkipped>0)w.push(`${input.accountsSkipped} conta(s) em formato inesperado foram ignoradas.`);
 for(const f of input.failedAccounts)w.push(`Transações de uma conta não puderam ser lidas: ${polpReadErrorMessage(f.reason,f.httpStatus)}`);
 if(input.transactionsIncomplete>0)w.push('Há mais transações no período do que o limite da consulta manual; os totais podem estar incompletos.');
 if(input.transactionsSkipped>0)w.push(`${input.transactionsSkipped} transação(ões) em formato inesperado foram ignoradas.`);
 if(input.excludedInvalidAmount>0)w.push(`${input.excludedInvalidAmount} transação(ões) com valor em formato não reconhecido ficaram fora dos totais.`);
 if(input.excludedNonBrl>0)w.push(`${input.excludedNonBrl} transação(ões) em moeda diferente de real ficaram fora dos totais.`);
 if(input.excludedNoDirection>0)w.push(`${input.excludedNoDirection} transação(ões) sem indicação de entrada ou saída ficaram fora dos totais.`);
 return w;
}
// Consulta manual e somente leitura: contas com saldo e transações da janela (máx. 92 dias). Nada é gravado.
export const readPolpAccountData=createServerFn({method:'POST'})
 .inputValidator((input:unknown)=>readInput.parse(input))
 .handler(async({data}):Promise<PolpReadResult>=>{
  const {financeAccess}=await import('./finance-management.server');const {db}=await financeAccess(false);
  const {data:existing}=await db.from('polp_consents').select('consent_id,status').eq('consent_id',data.consentId).maybeSingle();
  if(!existing)return {ok:false,error:'Conexão não encontrada.'};
  if(existing.status!=='AUTHORISED')return {ok:false,error:'A conta ainda não está conectada. Conclua a autorização no banco.'};
  const api=await import('./polp-api.server');
  const credentials=api.polpCredentialsFromEnv();
  const accounts=await api.listPolpAccounts(credentials,data.consentId);
  if(!accounts.ok)return {ok:false,error:`Não foi possível consultar as contas na Polp. ${polpReadErrorMessage(accounts.reason,accounts.httpStatus)}`};
  const selected=accounts.data.items.slice(0,5);
  const transactions:PolpTransaction[]=[];const failedAccounts:{reason:string;httpStatus:number|null}[]=[];let transactionsIncomplete=0,transactionsSkipped=0;
  for(const account of selected){
   const result=await api.listPolpAccountTransactions(credentials,account.id,{fromDate:data.fromDate,toDate:data.toDate});
   if(!result.ok){failedAccounts.push({reason:result.reason,httpStatus:result.httpStatus});continue;}
   transactions.push(...result.data.items);
   if(!result.data.complete)transactionsIncomplete++;
   transactionsSkipped+=result.data.skipped;
  }
  transactions.sort((x,y)=>(Date.parse(y.transaction_date_time??'')||0)-(Date.parse(x.transaction_date_time??'')||0));
  const summary=summarizeTransactions(transactions);
  await financeAccess(false);
  return {ok:true,accounts:selected,transactions,summary,warnings:readWarnings({accountsComplete:accounts.data.complete,accountsSkipped:accounts.data.skipped,accountsOmitted:accounts.data.items.length-selected.length,failedAccounts,transactionsIncomplete,transactionsSkipped,excludedInvalidAmount:summary.excludedInvalidAmount,excludedNonBrl:summary.excludedNonBrl,excludedNoDirection:summary.excludedNoDirection})};
 });

// ---- Fase 1: base bancária persistente (migração 0078) ----
// Sincronização manual: exige sessão completa, mesma origem, consentimento AUTHORISED e clique confirmado.
// Incremental quando já houve sincronização completa; caso contrário, primeira carga dos últimos 30 dias.
// Período escolhido pelo usuário (máx. 92 dias) é a única forma de trazer histórico; nada é automático.
const syncInput=z.object({consentId:z.string().min(8).max(128),mode:z.enum(['auto','range']),fromDate:z.string().max(40).optional(),toDate:z.string().max(40).optional(),confirmed:z.literal(true)}).strict();
export type PolpSyncResult={ok:true;status:'success'|'partial';inserted:number;updated:number;unchanged:number;skipped:number;accounts:number;warnings:string[];window:{mode:'incremental'|'range';from:string;to:string}}|{ok:false;error:string};
export function syncPlanErrorMessage(error:'initial_required'|'window_too_large'|'invalid_range'):string{
 if(error==='window_too_large')return 'O período máximo por sincronização é de 92 dias. Escolha um intervalo menor.';
 if(error==='invalid_range')return 'Informe um período válido (data inicial anterior à final, sem datas futuras).';
 return 'Faça a primeira sincronização antes da incremental.';
}
export const syncPolpTransactions=createServerFn({method:'POST'})
 .inputValidator((input:unknown)=>syncInput.parse(input))
 .handler(async({data}):Promise<PolpSyncResult>=>{
  const {financeAccess}=await import('./finance-management.server');const {db,scope}=await financeAccess(false);
  if(scope!=='crm:1')return {ok:false,error:'Escopo financeiro inválido.'};
  const {data:consent}=await db.from('polp_consents').select('consent_id,status').eq('consent_id',data.consentId).maybeSingle();
  if(!consent)return {ok:false,error:'Conexão não encontrada.'};
  if(consent.status!=='AUTHORISED')return {ok:false,error:'A conta ainda não está conectada.'};
  const runner=await import('./polp-bank-sync-runner.server');const sync=await import('./polp-bank-sync.server');
  const udb=db as unknown as import('./polp-bank-sync-runner.server').UntypedDb;
  const now=Date.now();
  let planned;
  if(data.mode==='range'){
   planned=sync.planSyncWindow({mode:'range',now,lastSuccessStartedAt:null,fromDate:data.fromDate,toDate:data.toDate});
  }else{
   const last=await runner.lastSuccessStartedAt(udb,runner.COMPANY_KEY,data.consentId);
   if(!last.ok)return {ok:false,error:'Base bancária indisponível (migração 0078 pendente). Nenhuma sincronização foi iniciada.'};
   planned=last.value?sync.planSyncWindow({mode:'incremental',now,lastSuccessStartedAt:last.value}):sync.planSyncWindow({mode:'range',now,lastSuccessStartedAt:null,...sync.initialRange(now)});
   if(!planned.ok&&planned.error==='window_too_large')planned=sync.planSyncWindow({mode:'range',now,lastSuccessStartedAt:null,fromDate:new Date(now-sync.MAX_WINDOW_DAYS*24*60*60*1000).toISOString(),toDate:new Date(now).toISOString()});
  }
  if(!planned.ok)return {ok:false,error:syncPlanErrorMessage(planned.error)};
  let outcome;
  try{outcome=await runner.runConsentSync(udb,{companyKey:runner.COMPANY_KEY,consentId:data.consentId,trigger:'manual',plan:planned.plan});}
  catch{return {ok:false,error:'Base bancária indisponível (migração 0078 pendente). Nenhuma sincronização foi iniciada.'};}
  await financeAccess(false);
  if(!outcome.ok)return {ok:false,error:outcome.error};
  return {ok:true,status:outcome.status,inserted:outcome.inserted,updated:outcome.updated,unchanged:outcome.unchanged,skipped:outcome.skipped,accounts:outcome.accounts,warnings:outcome.warnings,window:{mode:planned.plan.mode,from:planned.plan.from,to:planned.plan.to}};
 });

// Resumo da base bancária: execuções recentes e quantidade armazenada. Sem dados de transações individuais.
export type PolpSyncOverview={available:true;stored:number;lastSuccessAt:string|null;runs:{id:string;trigger:string;mode:string;status:string;startedAt:string;finishedAt:string|null;inserted:number;updated:number;unchanged:number;skipped:number;errorCode:string|null}[]}|{available:false};
export const getPolpSyncOverview=createServerFn({method:'POST'})
 .inputValidator((input:unknown)=>z.object({consentId:z.string().min(8).max(128)}).strict().parse(input))
 .handler(async({data}):Promise<PolpSyncOverview>=>{
  const {financeAccess}=await import('./finance-management.server');const {db}=await financeAccess(false);
  const udb=db as unknown as import('./polp-bank-sync-runner.server').UntypedDb;
  const {COMPANY_KEY}=await import('./polp-bank-sync-runner.server');
  const [runs,count,state]=await Promise.all([
   udb.from('polp_sync_runs').select('id,trigger,mode,status,started_at,finished_at,inserted,updated,unchanged,skipped,error_code').eq('company_key',COMPANY_KEY).eq('consent_id',data.consentId).order('started_at',{ascending:false}).limit(5),
   udb.from('polp_bank_transactions').select('id',{count:'exact',head:true}).eq('company_key',COMPANY_KEY).eq('consent_id',data.consentId),
   udb.from('polp_sync_state').select('last_success_at').eq('company_key',COMPANY_KEY).eq('consent_id',data.consentId).maybeSingle(),
  ]);
  if(runs.error||count.error||state.error)return {available:false};
  await financeAccess(false);
  type RunRow={id:string;trigger:string;mode:string;status:string;started_at:string;finished_at:string|null;inserted:number;updated:number;unchanged:number;skipped:number;error_code:string|null};
  return {available:true,stored:Number((count as unknown as {count?:number}).count??0),lastSuccessAt:(state.data as {last_success_at?:string|null}|null)?.last_success_at??null,
   runs:((runs.data??[]) as RunRow[]).map(r=>({id:r.id,trigger:r.trigger,mode:r.mode,status:r.status,startedAt:r.started_at,finishedAt:r.finished_at,inserted:r.inserted,updated:r.updated,unchanged:r.unchanged,skipped:r.skipped,errorCode:r.error_code}))};
 });

// ---- Movimentação bancária no Financeiro (lê a base persistida da Fase 1; classificação da Fase 2) ----
// Sessão completa + mesma origem; nenhum documento de contraparte (apenas nome, quando enviado pela Polp).
const ledgerInput=z.object({period:z.enum(['mes_atual','mes_anterior','ultimos_30','ano_atual','ano_anterior'])}).strict();
export type PolpLedgerRow=import('./polp-bank-ledger.server').ReviewRow;
export type PolpBankLedger=import('./polp-bank-ledger.server').BankLedgerView;
type LedgerQuery=PromiseLike<{data:unknown;error:unknown}>&{eq(c:string,v:unknown):LedgerQuery;in(c:string,v:unknown[]):LedgerQuery;gte(c:string,v:unknown):LedgerQuery;lt(c:string,v:unknown):LedgerQuery;order(c:string,o:{ascending:boolean}):LedgerQuery;range(a:number,b:number):LedgerQuery;limit(n:number):LedgerQuery};
type LedgerDb={from(t:string):{select(c:string):LedgerQuery}};
export const getPolpBankLedger=createServerFn({method:'POST'})
 .inputValidator((input:unknown)=>ledgerInput.parse(input))
 .handler(async({data}):Promise<PolpBankLedger>=>{
  const {financeAccess}=await import('./finance-management.server');const {db,scope}=await financeAccess(false);
  if(scope!=='crm:1')return {available:false};
  const {buildBankLedger}=await import('./polp-bank-ledger.server');
  const view=await buildBankLedger(db as unknown as import('./polp-bank-ledger.server').LedgerDb,data.period);
  await financeAccess(false);
  return view;
 });

// Revisão financeira (0081): aprovar, corrigir, marcar pessoal/empresarial/investimento, em massa (até 200), com regras.
const reviewItem=z.object({transactionId:z.string().min(1).max(128),kind:z.enum(['receita_operacional','despesa_operacional','despesa_pessoal','entrada_pessoal','aplicacao','resgate','rendimento','transferencia_interna','emprestimo','nao_classificado']),
 category:z.string().max(40).nullable(),vendor:z.string().trim().max(80).nullable(),expectedRevision:z.number().int().min(0),decision:z.enum(['aprovado','corrigido']),
 rule:z.object({field:z.enum(['description','counterparty']),pattern:z.string().max(120)}).strict().nullable()}).strict();
export const saveBankClassifications=createServerFn({method:'POST'})
 .inputValidator((input:unknown)=>z.object({items:z.array(reviewItem).min(1).max(200)}).strict().parse(input))
 .handler(async({data}):Promise<{ok:true;saved:number}|{ok:false;error:string}>=>{
  const {financeAccess}=await import('./finance-management.server');const {db,scope,actor}=await financeAccess(false);
  if(scope!=='crm:1')return {ok:false,error:'Escopo financeiro inválido.'};
  const bc=await import('./bank-classification');
  for(const it of data.items){
   if(it.category!==null&&!(bc.COST_CATEGORIES as readonly string[]).includes(it.category))return {ok:false,error:'Categoria inválida.'};
   if(!bc.categoryAllowed(it.kind,it.category as import('./bank-classification').CostCategory|null))return {ok:false,error:'A categoria não corresponde ao tipo (empresarial/pessoal).'};
   if((it.kind==='despesa_operacional'||it.kind==='despesa_pessoal')&&!it.category)return {ok:false,error:'Escolha a categoria da despesa.'};
   if(it.rule&&bc.normalizeText(it.rule.pattern).length<3)return {ok:false,error:'O texto da regra precisa ter pelo menos 3 caracteres.'};
  }
  // Direção das regras = sentido da própria movimentação (regra nunca vale para entradas e saídas ao mesmo tempo).
  const ids=data.items.filter(i=>i.rule).map(i=>i.transactionId);
  const dir=new Map<string,string|null>();
  if(ids.length){const ldb=db as unknown as LedgerDb;const {data:tx,error}=await ldb.from('polp_bank_transactions').select('polp_transaction_id,direction').eq('company_key','crm:1').in('polp_transaction_id',ids);
   if(error)return {ok:false,error:'Não foi possível consultar as movimentações.'};for(const t of (tx??[]) as {polp_transaction_id:string;direction:string|null}[])dir.set(t.polp_transaction_id,t.direction);}
  const items=data.items.map(i=>({transaction_id:i.transactionId,kind:i.kind,category:i.category,vendor:i.vendor||null,expected_revision:i.expectedRevision,decision:i.decision,
   rule:i.rule?{field:i.rule.field,pattern:bc.normalizeText(i.rule.pattern),direction:dir.get(i.transactionId)??'qualquer'}:null}));
  const rpc=db as unknown as {rpc(fn:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:{message?:string}|null}>};
  const {data:saved,error}=await rpc.rpc('save_polp_bank_classifications',{p_company_key:'crm:1',p_items:items,p_actor:String(actor).slice(0,120)});
  if(error){const m=error.message??'';return {ok:false,error:m.includes('polp_classification_changed')?'Alguma movimentação foi alterada por outra pessoa. Atualize e tente de novo; nada foi salvo.':m.includes('not_found')?'Movimentação não encontrada; nada foi salvo.':m.includes('save_polp_bank_classifications')||m.includes('function')?'Revisão em massa indisponível (migração 0081 pendente).':'Não foi possível salvar; nada foi alterado.'};}
  await financeAccess(false);
  return {ok:true,saved:Number(saved??data.items.length)};
 });
export const setBankRuleActive=createServerFn({method:'POST'})
 .inputValidator((input:unknown)=>z.object({ruleId:z.string().uuid(),active:z.boolean()}).strict().parse(input))
 .handler(async({data}):Promise<{ok:true}|{ok:false;error:string}>=>{
  const {financeAccess}=await import('./finance-management.server');const {db,scope,actor}=await financeAccess(false);
  if(scope!=='crm:1')return {ok:false,error:'Escopo financeiro inválido.'};
  const rpc=db as unknown as {rpc(fn:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:{message?:string}|null}>};
  const {data:ok,error}=await rpc.rpc('set_polp_bank_rule_active',{p_company_key:'crm:1',p_rule_id:data.ruleId,p_active:data.active,p_actor:String(actor).slice(0,120)});
  if(error)return {ok:false,error:(error.message??'').includes('function')?'Edição de regras indisponível (migração 0081 pendente).':'Não foi possível alterar a regra.'};
  if(!ok)return {ok:false,error:'Regra não encontrada.'};
  await financeAccess(false);
  return {ok:true};
 });

// Correção manual da classificação (migração 0079). Opcionalmente cria regra reutilizável a partir da descrição ou do pagador.
const classifyInput=z.object({transactionId:z.string().min(1).max(128),kind:z.enum(['receita_operacional','despesa_operacional','aplicacao','resgate','rendimento','transferencia_interna','emprestimo','nao_classificado']),
 category:z.enum(['inteligencia_artificial','softwares_assinaturas','publicidade_marketing','hospedagem_infraestrutura','fornecedores','equipe','impostos','despesas_administrativas','outras_despesas']).nullable(),
 vendor:z.string().trim().max(80).nullable(),expectedRevision:z.number().int().min(0),rule:z.object({field:z.enum(['description','counterparty']),pattern:z.string().max(120),sameDirection:z.boolean()}).nullable()}).strict();
export const saveBankClassification=createServerFn({method:'POST'})
 .inputValidator((input:unknown)=>classifyInput.parse(input))
 .handler(async({data}):Promise<{ok:true}|{ok:false;error:string}>=>{
  const {financeAccess}=await import('./finance-management.server');const {db,scope,actor}=await financeAccess(false);
  if(scope!=='crm:1')return {ok:false,error:'Escopo financeiro inválido.'};
  if(data.kind==='despesa_operacional'&&!data.category)return {ok:false,error:'Escolha a categoria da despesa.'};
  const {normalizeText}=await import('./bank-classification');const {COMPANY_KEY}=await import('./polp-bank-sync-runner.server');
  let ruleDirection:string|null=null;let pattern:string|null=null;
  if(data.rule){
   pattern=normalizeText(data.rule.pattern);
   if(pattern.length<3)return {ok:false,error:'O texto da regra precisa ter pelo menos 3 caracteres.'};
   if(data.rule.sameDirection){
    const ldb=db as unknown as LedgerDb;
    const {data:tx,error}=await ldb.from('polp_bank_transactions').select('direction').eq('company_key',COMPANY_KEY).eq('polp_transaction_id',data.transactionId).limit(1);
    if(error)return {ok:false,error:'Não foi possível consultar a movimentação.'};
    ruleDirection=((tx??[]) as {direction:string|null}[])[0]?.direction??null;
   }
  }
  const rpc=db as unknown as {rpc(fn:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:{message?:string}|null}>};
  const {error}=await rpc.rpc('save_polp_bank_classification',{p_company_key:COMPANY_KEY,p_transaction_id:data.transactionId,p_kind:data.kind,p_category:data.kind==='despesa_operacional'?data.category:null,
   p_vendor:data.vendor||null,p_expected_revision:data.expectedRevision,p_rule_field:data.rule?data.rule.field:null,p_rule_pattern:pattern,p_rule_direction:data.rule?(ruleDirection??'qualquer'):null,p_actor:String(actor).slice(0,120)});
  if(error){const m=error.message??'';return {ok:false,error:m.includes('polp_classification_changed')?'A classificação foi alterada por outra pessoa. Atualize e tente de novo.':m.includes('not_found')?'Movimentação não encontrada.':m.includes('save_polp_bank_classification')||m.includes('function')?'Correção manual indisponível (migração 0079 pendente).':'Não foi possível salvar a classificação.'};}
  await financeAccess(false);
  return {ok:true};
 });

// ---- Conciliação de recebimentos bancários (migração 0080) ----
type TxForRecon={polp_transaction_id:string;transaction_at:string|null;amount_cents:number|null;currency:string;direction:'CREDITO'|'DEBITO'|null;transaction_type:string|null;category_ref:string|null;description:string|null;counterparty_name:string|null;counterparty_doc_hmac:string|null};
const TX_RECON_COLS='polp_transaction_id,transaction_at,amount_cents,currency,direction,transaction_type,category_ref,description,counterparty_name,counterparty_doc_hmac';
async function reconContext(){
 const {financeAccess}=await import('./finance-management.server');const access=await financeAccess(false);
 if(access.scope!=='crm:1')throw new Error('Escopo financeiro inválido.');
 const rdb=access.db as unknown as import('./polp-bank-reconciliation.server').ReconDb;
 return {access,financeAccess,rdb};
}
async function txOperatingReceipt(rdb:import('./polp-bank-reconciliation.server').ReconDb,tx:TxForRecon):Promise<boolean>{
 const bc=await import('./bank-classification');
 const [ov,rules]=await Promise.all([
  rdb.from('polp_bank_classification_overrides').select('kind,category,vendor').eq('company_key','crm:1').eq('polp_transaction_id',tx.polp_transaction_id).limit(1),
  rdb.from('polp_bank_classification_rules').select('field,pattern,direction,kind,category,vendor').eq('company_key','crm:1').limit(500),
 ]);
 const o=ov.error?null:((ov.data??[]) as {kind:import('./bank-classification').BankKind;category:import('./bank-classification').CostCategory|null;vendor:string|null}[])[0]??null;
 const r=rules.error?[]:((rules.data??[]) as {field:'description'|'counterparty';pattern:string;direction:string;kind:import('./bank-classification').BankKind;category:import('./bank-classification').CostCategory|null;vendor:string|null}[]).map(x=>({...x,direction:x.direction==='CREDITO'||x.direction==='DEBITO'?x.direction as 'CREDITO'|'DEBITO':null}));
 return bc.classify({direction:tx.direction,type:tx.transaction_type,categoryRef:tx.category_ref,description:tx.description,counterparty:tx.counterparty_name},r,o).kind==='receita_operacional';
}
const receiptOf=(tx:TxForRecon)=>({transactionId:tx.polp_transaction_id,amountCents:Number(tx.amount_cents),date:new Date(Date.parse(tx.transaction_at??'')-3*60*60*1000).toISOString().slice(0,10),counterparty:tx.counterparty_name,counterpartyDocHmac:tx.counterparty_doc_hmac});

export type ReconciliationOptions={ok:true;accounts:{id:string;name:string}[];candidates:import('./bank-reconciliation').ReconCandidate[];clientNames:Record<string,string>}|{ok:false;error:string};
export const getReconciliationOptions=createServerFn({method:'POST'})
 .inputValidator((input:unknown)=>z.object({transactionId:z.string().min(1).max(128)}).strict().parse(input))
 .handler(async({data}):Promise<ReconciliationOptions>=>{
  const {financeAccess,rdb}=await reconContext();
  const {data:rows,error}=await rdb.from('polp_bank_transactions').select(TX_RECON_COLS).eq('company_key','crm:1').eq('polp_transaction_id',data.transactionId).limit(1);
  const tx=((rows??[]) as TxForRecon[])[0];
  if(error||!tx)return {ok:false,error:'Movimentação não encontrada.'};
  if(tx.direction!=='CREDITO'||tx.amount_cents===null||!tx.transaction_at)return {ok:false,error:'Somente entradas com valor e data podem ser conciliadas.'};
  if(!(await txOperatingReceipt(rdb,tx)))return {ok:false,error:'Esta entrada não é receita operacional (investimento, resgate, rendimento, transferência própria ou empréstimo). Corrija a classificação se estiver errada.'};
  const recon=await import('./polp-bank-reconciliation.server');const match=await import('./bank-reconciliation');
  const loaded=await recon.loadReconciliationData(rdb,process.env.CRM_SESSION_SECRET);
  if(!loaded.ok)return {ok:false,error:'Conciliação indisponível (migração 0080 pendente).'};
  await financeAccess(false);
  return {ok:true,accounts:loaded.accounts,candidates:match.reconciliationCandidates(receiptOf(tx),loaded),clientNames:Object.fromEntries(loaded.clientNames)};
 });

const reconcileInput=z.object({transactionId:z.string().min(1).max(128),target:z.object({type:z.enum(['client_charge','client_payment','finance_settlement']),id:z.string().uuid()}).strict(),accountId:z.string().uuid().nullable(),confirmed:z.literal(true)}).strict();
export const reconcileBankReceipt=createServerFn({method:'POST'})
 .inputValidator((input:unknown)=>reconcileInput.parse(input))
 .handler(async({data}):Promise<{ok:true}|{ok:false;error:string}>=>{
  const {access,financeAccess,rdb}=await reconContext();
  const {data:rows,error}=await rdb.from('polp_bank_transactions').select(TX_RECON_COLS).eq('company_key','crm:1').eq('polp_transaction_id',data.transactionId).limit(1);
  const tx=((rows??[]) as TxForRecon[])[0];
  if(error||!tx)return {ok:false,error:'Movimentação não encontrada.'};
  if(!(await txOperatingReceipt(rdb,tx)))return {ok:false,error:'Esta entrada não é receita operacional.'};
  const recon=await import('./polp-bank-reconciliation.server');
  const {error:rpcError}=await rdb.rpc('reconcile_polp_bank_receipt',{p_company_key:'crm:1',p_transaction_id:data.transactionId,p_target:data.target.type,p_target_id:data.target.id,
   p_account:data.accountId,p_operation:await recon.reconciliationOperation(data.transactionId),p_mode:'manual',p_actor:String(access.actor).slice(0,160)});
  if(rpcError)return {ok:false,error:recon.reconcileErrorMessage(rpcError.message??'')};
  await financeAccess(false);
  return {ok:true};
 });

// Automática: só recebimentos operacionais ainda não conciliados com correspondência confiável (documento + valor único).
// Exige exatamente uma conta no Financeiro para registrar; caso contrário, nada é feito automaticamente.
export type AutoReconcileResult={ok:true;reconciled:number;reviewed:number;needsAccount:boolean;errors:number}|{ok:false;error:string};
export const autoReconcileBankReceipts=createServerFn({method:'POST'})
 .inputValidator((input:unknown)=>z.object({confirmed:z.literal(true)}).strict().parse(input))
 .handler(async():Promise<AutoReconcileResult>=>{
  const {access,financeAccess,rdb}=await reconContext();
  const recon=await import('./polp-bank-reconciliation.server');const match=await import('./bank-reconciliation');
  const loaded=await recon.loadReconciliationData(rdb,process.env.CRM_SESSION_SECRET);
  if(!loaded.ok)return {ok:false,error:'Conciliação indisponível (migração 0080 pendente).'};
  if(loaded.accounts.length!==1){await financeAccess(false);return {ok:true,reconciled:0,reviewed:0,needsAccount:true,errors:0};}
  const since=new Date(Date.now()-120*24*60*60*1000).toISOString();
  const [txs,links]=await Promise.all([
   rdb.from('polp_bank_transactions').select(TX_RECON_COLS).eq('company_key','crm:1').eq('direction','CREDITO').gte('transaction_at',since).order('transaction_at',{ascending:true}).limit(2000),
   rdb.from('polp_bank_reconciliations').select('polp_transaction_id').eq('company_key','crm:1').limit(20000),
  ]);
  if(txs.error||links.error)return {ok:false,error:'Não foi possível consultar os recebimentos.'};
  const done=new Set(((links.data??[]) as {polp_transaction_id:string}[]).map(l=>l.polp_transaction_id));
  let reconciled=0,reviewed=0,errors=0;const used=new Set<string>();
  for(const tx of (txs.data??[]) as TxForRecon[]){
   if(done.has(tx.polp_transaction_id)||tx.amount_cents===null||!tx.transaction_at||tx.currency!=='BRL')continue;
   if(!(await txOperatingReceipt(rdb,tx)))continue;
   reviewed++;
   const m=match.autoMatch(receiptOf(tx),{clients:loaded.clients,charges:loaded.charges.filter(c=>!used.has(c.id)),payments:loaded.payments.filter(p=>!used.has(p.id))});
   if(!m)continue;
   const {error}=await rdb.rpc('reconcile_polp_bank_receipt',{p_company_key:'crm:1',p_transaction_id:tx.polp_transaction_id,p_target:m.type,p_target_id:m.id,p_account:loaded.accounts[0].id,
    p_operation:await recon.reconciliationOperation(tx.polp_transaction_id),p_mode:'auto',p_actor:String(access.actor).slice(0,160)});
   if(error){errors++;continue;}
   used.add(m.id);reconciled++;
  }
  await financeAccess(false);
  return {ok:true,reconciled,reviewed,needsAccount:false,errors};
 });
