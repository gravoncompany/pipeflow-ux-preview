import {polpCatalogSchema,polpConsentSchema,sanitizePolpText,polpConsentListSchema,polpPageSchema,polpAccountSchema,polpTransactionSchema,polpTransactionSyncSchema,nubankBusinessStatus,type PolpConsent,type PolpAccount,type PolpTransaction,type PolpTransactionSync,type PolpResult} from './polp';

export type PolpCredentials={clientId?:string;clientSecret?:string};
export function polpCredentialsFromEnv():PolpCredentials {
 return {clientId:process.env['POLP_CLIENT_ID']||process.env['POLP_CLIENT_UNDERLINE_ID'],clientSecret:process.env['POLP_CLIENT_SECRET']||process.env['POLP_UNDERLINE_CLIENT_UNDERLINE_SECRET']};
}
const POLP_BASE='https://api.polp.com.br/api/v2';
const MAX_BYTES=1024*1024;
async function polpRequest(credentials:PolpCredentials,path:string,init:{method?:string;body?:unknown},transport:typeof fetch):Promise<{httpStatus:number;json:unknown|null}> {
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),10000);
 try {
  const response=await transport(`${POLP_BASE}${path}`,{method:init.method??'GET',redirect:'manual',signal:controller.signal,headers:{Accept:'application/json',...(init.body!==undefined?{'Content-Type':'application/json'}:{}),'x-api-client':credentials.clientId??'','x-api-secret':credentials.clientSecret??''},body:init.body===undefined?undefined:JSON.stringify(init.body)});
  const reader=response.body?.getReader();
  if(!reader)return {httpStatus:response.status,json:null};
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES){await reader.cancel();return {httpStatus:response.status,json:null};}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  if(!response.headers.get('content-type')?.includes('application/json'))return {httpStatus:response.status,json:null};
  return {httpStatus:response.status,json:JSON.parse(new TextDecoder().decode(bytes))};
 }finally{clearTimeout(timer);}
}
export type PolpCallResult<T>={ok:true;data:T;httpStatus:number}|{ok:false;httpStatus:number|null;reason:'missing_credentials'|'http_error'|'invalid_response'|'unavailable'|'timeout'};
type PolpFailureReason='missing_credentials'|'http_error'|'invalid_response'|'unavailable'|'timeout';
function failure(httpStatus:number|null,reason:PolpFailureReason):PolpCallResult<never>{return {ok:false,httpStatus,reason};}

// Registro seguro: apenas etapa, HTTP e código/mensagem da Polp com sequências numéricas e e-mails mascarados.
// Nunca registra CPF, CNPJ, credenciais, links de autorização ou corpo enviado.
export {sanitizePolpText};
export function polpErrorSummary(json:unknown):{code:string|null;message:string|null;fields:string[]}{
 const o=json&&typeof json==='object'?json as Record<string,unknown>:{};
 const errors=o.errors&&typeof o.errors==='object'&&!Array.isArray(o.errors)?Object.keys(o.errors as object).slice(0,10).map(k=>k.slice(0,40)):[];
 return {code:sanitizePolpText(typeof o.code==='string'?o.code:typeof o.error==='string'?o.error:null),message:sanitizePolpText(o.message),fields:errors};
}
export function logPolpFailure(stage:string,httpStatus:number|null,reason:string,json?:unknown):void{
 const summary=json===undefined?{code:null,message:null,fields:[]}:polpErrorSummary(json);
 console.warn(JSON.stringify({event:'polp_failure',stage,httpStatus,reason,...summary}));
}

// Cria consentimento real somente leitura (produto ACCOUNT). CPF/CNPJ seguem só na chamada; nunca são persistidos.
// `clienteUserId` é o vínculo opaco (HMAC) dos documentos, usado depois para provar que o consentimento é da mesma empresa.
export async function createPolpConsent(credentials:PolpCredentials,input:{institutionId:string;cpf:string;cnpj:string;clienteUserId:string},transport:typeof fetch=fetch):Promise<PolpCallResult<PolpConsent>> {
 if(!credentials.clientId||!credentials.clientSecret)return failure(null,'missing_credentials');
 if(!input.clienteUserId)return failure(null,'invalid_response');
 let result:{httpStatus:number;json:unknown|null};
 try{result=await polpRequest(credentials,'/consents',{method:'POST',body:{institution_id:input.institutionId,cpf:input.cpf,cnpj:input.cnpj,products:['ACCOUNT'],avoidDuplicates:true,cliente_user_id:input.clienteUserId}},transport);}
 catch(error){const timeout=error instanceof Error&&(error.name==='AbortError'||error.name==='TimeoutError');logPolpFailure('create',null,timeout?'timeout':'unavailable');return failure(null,timeout?'timeout':'unavailable');}
 if(result.httpStatus!==200&&result.httpStatus!==201){logPolpFailure('create',result.httpStatus,'http_error',result.json);return failure(result.httpStatus,'http_error');}
 const parsed=polpConsentSchema.safeParse(result.json);
 if(!parsed.success){logPolpFailure('create',result.httpStatus,'invalid_response');return failure(result.httpStatus,'invalid_response');}
 return {ok:true,data:parsed.data,httpStatus:result.httpStatus};
}
// Leitura: consentimentos já existentes na conta Polp. Segue next_cursor por no máximo 5 páginas (15 itens cada);
// `complete:false` indica que podem existir mais registros. Usado antes de qualquer nova criação.
export const POLP_CONSENT_LIST_MAX_PAGES=5;
export async function listPolpConsents(credentials:PolpCredentials,transport:typeof fetch=fetch):Promise<PolpCallResult<PolpConsent[]>&{complete?:boolean}> {
 if(!credentials.clientId||!credentials.clientSecret)return failure(null,'missing_credentials');
 const items:PolpConsent[]=[];let cursor:string|null=null;let httpStatus=200;
 for(let page=0;page<POLP_CONSENT_LIST_MAX_PAGES;page++){
  let result:{httpStatus:number;json:unknown|null};
  try{result=await polpRequest(credentials,cursor?`/consents?cursor=${encodeURIComponent(cursor)}`:'/consents',{},transport);}
  catch(error){const timeout=error instanceof Error&&(error.name==='AbortError'||error.name==='TimeoutError');logPolpFailure('list',null,timeout?'timeout':'unavailable');return failure(null,timeout?'timeout':'unavailable');}
  if(result.httpStatus!==200){logPolpFailure('list',result.httpStatus,'http_error',result.json);return failure(result.httpStatus,'http_error');}
  const list=polpConsentListSchema.safeParse(result.json);
  if(!list.success){logPolpFailure('list',result.httpStatus,'invalid_response');return failure(result.httpStatus,'invalid_response');}
  httpStatus=result.httpStatus;
  items.push(...list.data.data.flatMap(item=>{const p=polpConsentSchema.safeParse(item);return p.success?[p.data]:[];}));
  const next=list.data.meta?.next_cursor??null;
  if(!next)return {ok:true,data:items,httpStatus,complete:true};
  if(next===cursor)break;
  cursor=next;
 }
 return {ok:true,data:items,httpStatus,complete:false};
}
export async function getPolpConsent(credentials:PolpCredentials,consentId:string,transport:typeof fetch=fetch):Promise<PolpCallResult<PolpConsent>> {
 if(!credentials.clientId||!credentials.clientSecret)return failure(null,'missing_credentials');
 let result:{httpStatus:number;json:unknown|null};
 try{result=await polpRequest(credentials,`/consents/${encodeURIComponent(consentId)}`,{},transport);}
 catch(error){const timeout=error instanceof Error&&(error.name==='AbortError'||error.name==='TimeoutError');logPolpFailure('show',null,timeout?'timeout':'unavailable');return failure(null,timeout?'timeout':'unavailable');}
 if(result.httpStatus!==200){logPolpFailure('show',result.httpStatus,'http_error',result.json);return failure(result.httpStatus,'http_error');}
 const parsed=polpConsentSchema.safeParse(result.json);
 if(!parsed.success){logPolpFailure('show',result.httpStatus,'invalid_response');return failure(result.httpStatus,'invalid_response');}
 return {ok:true,data:parsed.data,httpStatus:result.httpStatus};
}
// Renova a autorização no mesmo registro Polp (POST /consents/{id}/recreate): novo link com validade de 1 hora.
// Envia somente products ACCOUNT; documentos e instituição não podem ser alterados por esta rota. Sem retries.
export async function recreatePolpConsent(credentials:PolpCredentials,consentId:string,transport:typeof fetch=fetch):Promise<PolpCallResult<PolpConsent>> {
 if(!credentials.clientId||!credentials.clientSecret)return failure(null,'missing_credentials');
 let result:{httpStatus:number;json:unknown|null};
 try{result=await polpRequest(credentials,`/consents/${encodeURIComponent(consentId)}/recreate`,{method:'POST',body:{products:['ACCOUNT']}},transport);}
 catch(error){const timeout=error instanceof Error&&(error.name==='AbortError'||error.name==='TimeoutError');logPolpFailure('recreate',null,timeout?'timeout':'unavailable');return failure(null,timeout?'timeout':'unavailable');}
 if(result.httpStatus!==200&&result.httpStatus!==201){logPolpFailure('recreate',result.httpStatus,'http_error',result.json);return failure(result.httpStatus,'http_error');}
 const parsed=polpConsentSchema.safeParse(result.json);
 if(!parsed.success||parsed.data.id!==consentId){logPolpFailure('recreate',result.httpStatus,'invalid_response');return failure(result.httpStatus,'invalid_response');}
 return {ok:true,data:parsed.data,httpStatus:result.httpStatus};
}
// Leitura paginada (next_cursor) e limitada: valida cada item; inválidos são contados, não derrubam a página.
// `complete:false` indica que o limite de páginas foi atingido. Falhas são registradas sem corpo/dados bancários.
export type PolpPage<T>={items:T[];complete:boolean;skipped:number};
async function readPolpPages<T>(credentials:PolpCredentials,stage:string,basePath:string,parseItem:(v:unknown)=>{success:true;data:T}|{success:false},maxPages:number,transport:typeof fetch):Promise<PolpCallResult<PolpPage<T>>>{
 if(!credentials.clientId||!credentials.clientSecret)return failure(null,'missing_credentials');
 const items:T[]=[];let skipped=0,cursor:string|null=null,httpStatus=200;
 for(let page=0;page<maxPages;page++){
  const path:string=cursor?`${basePath}${basePath.includes('?')?'&':'?'}cursor=${encodeURIComponent(cursor)}`:basePath;
  let result:{httpStatus:number;json:unknown|null};
  try{result=await polpRequest(credentials,path,{},transport);}
  catch(error){const timeout=error instanceof Error&&(error.name==='AbortError'||error.name==='TimeoutError');logPolpFailure(stage,null,timeout?'timeout':'unavailable');return failure(null,timeout?'timeout':'unavailable');}
  if(result.httpStatus!==200){logPolpFailure(stage,result.httpStatus,'http_error',result.json);return failure(result.httpStatus,'http_error');}
  const parsed=polpPageSchema.safeParse(result.json);
  if(!parsed.success){logPolpFailure(stage,result.httpStatus,'invalid_response');return failure(result.httpStatus,'invalid_response');}
  httpStatus=result.httpStatus;
  for(const raw of parsed.data.data){const p=parseItem(raw);if(p.success)items.push(p.data);else skipped++;}
  const next=parsed.data.meta?.next_cursor??null;
  if(!next)return {ok:true,data:{items,complete:true,skipped},httpStatus};
  if(next===cursor)break;
  cursor=next;
 }
 return {ok:true,data:{items,complete:false,skipped},httpStatus};
}
// Contas do consentimento (15 por página na Polp; até 5 páginas). O saldo vem junto (balance.available_amount etc.).
export async function listPolpAccounts(credentials:PolpCredentials,consentId:string,transport:typeof fetch=fetch):Promise<PolpCallResult<PolpPage<PolpAccount>>> {
 return readPolpPages(credentials,'accounts',`/consents/${encodeURIComponent(consentId)}/accounts`,v=>polpAccountSchema.safeParse(v),5,transport);
}
// Leitura manual e limitada: janela máxima de 92 dias por transaction_date_time (fromDate/toDate),
// 500 itens por página na Polp, até 10 páginas.
export async function listPolpAccountTransactions(credentials:PolpCredentials,accountId:string,range:{fromDate:string;toDate:string},transport:typeof fetch=fetch):Promise<PolpCallResult<PolpPage<PolpTransaction>>> {
 if(!credentials.clientId||!credentials.clientSecret)return failure(null,'missing_credentials');
 const from=new Date(range.fromDate),to=new Date(range.toDate);
 if(Number.isNaN(from.getTime())||Number.isNaN(to.getTime())||to<from||to.getTime()-from.getTime()>92*24*60*60*1000)return failure(null,'invalid_response');
 return readPolpPages(credentials,'transactions',`/accounts/${encodeURIComponent(accountId)}/transactions?fromDate=${encodeURIComponent(from.toISOString())}&toDate=${encodeURIComponent(to.toISOString())}`,v=>polpTransactionSchema.safeParse(v),10,transport);
}
// Sincronização persistente (somente servidor): filtro por data da transação (fromDate/toDate) ou por atualização no
// provedor (fromUpdatedAt/toUpdatedAt, modo incremental). Mesmos limites de paginação da leitura manual.
export type PolpTransactionQuery={fromDate?:string;toDate?:string;fromUpdatedAt?:string;toUpdatedAt?:string};
export async function listPolpAccountTransactionsForSync(credentials:PolpCredentials,accountId:string,query:PolpTransactionQuery,transport:typeof fetch=fetch):Promise<PolpCallResult<PolpPage<PolpTransactionSync>>> {
 if(!credentials.clientId||!credentials.clientSecret)return failure(null,'missing_credentials');
 const params=new URLSearchParams();
 for(const key of ['fromDate','toDate','fromUpdatedAt','toUpdatedAt'] as const){const v=query[key];if(v===undefined)continue;const d=new Date(v);if(Number.isNaN(d.getTime()))return failure(null,'invalid_response');params.set(key,d.toISOString());}
 if(!params.size)return failure(null,'invalid_response');
 return readPolpPages(credentials,'transactions_sync',`/accounts/${encodeURIComponent(accountId)}/transactions?${params.toString()}`,v=>polpTransactionSyncSchema.safeParse(v),10,transport);
}
// Localiza a instituição Nubank com suporte empresarial no catálogo público.
export async function findNubankInstitution(credentials:PolpCredentials,transport:typeof fetch=fetch):Promise<PolpCallResult<{id:string;name:string}>> {
 const catalog=await testPolpCatalog(credentials,transport);
 if(catalog.status!=='ok')return failure(catalog.httpStatus,catalog.status==='missing_credentials'?'missing_credentials':catalog.status==='invalid_response'?'invalid_response':catalog.status==='unavailable'?'unavailable':'http_error');
 const nubank=catalog.institutions.find(r=>/^nubank(?:\s|$)/i.test(r.name)&&['BUSINESS','BOTH'].includes(r.type)&&r.credentials.includes('cpf')&&r.credentials.includes('cnpj')&&r.status==='OPERATIONAL');
 return nubank?{ok:true,data:{id:nubank.id,name:nubank.name},httpStatus:catalog.httpStatus??200}:failure(catalog.httpStatus,'invalid_response');
}
// Only a fixed institution catalog operation: no consent/banking/sync endpoints.
export async function testPolpCatalog(credentials:{clientId?:string;clientSecret?:string},transport:typeof fetch=fetch):Promise<PolpResult>{
 const base:PolpResult={credentialsConfigured:Boolean(credentials.clientId&&credentials.clientSecret),authentication:'not_verified',status:'missing_credentials',httpStatus:null,institutions:[],complete:false,nubankBusiness:'unknown'};
 if(!credentials.clientId||!credentials.clientSecret)return base;
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),10000);
 try {
  const response=await transport('https://api.polp.com.br/api/v2/institutions',{method:'GET',redirect:'manual',signal:controller.signal,headers:{Accept:'application/json','x-api-client':credentials.clientId,'x-api-secret':credentials.clientSecret}});
  base.httpStatus=response.status;
  if(!response.ok){await response.body?.cancel();return {...base,status:'http_error',authentication:response.status===401||response.status===403?'rejected':'not_verified'};}
  if(!response.headers.get('content-type')?.includes('application/json')){await response.body?.cancel();return {...base,status:'invalid_response'};}
  const reader=response.body?.getReader();if(!reader)return {...base,status:'invalid_response'};
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1024*1024){await reader.cancel();return {...base,status:'invalid_response'};}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const parsed=polpCatalogSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
  if(!parsed.success)return {...base,status:'invalid_response'};
  const complete=!parsed.data.links?.next&&!parsed.data.meta?.next_cursor;
  // Public route: a successful catalog request does not prove valid API keys.
  return {...base,status:'ok',institutions:parsed.data.data,complete,nubankBusiness:nubankBusinessStatus(parsed.data.data,complete)};
 }catch{return {...base,status:'unavailable'};}finally{clearTimeout(timer);}
}