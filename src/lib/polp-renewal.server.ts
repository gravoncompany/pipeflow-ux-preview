import {signCrmSession} from './crm-session-token';
import {canRecreateConsent,selectExistingConsent,polpReadErrorMessage,polpRecreateErrorMessage,type PolpConsent} from './polp';
import type {PolpCallResult} from './polp-api.server';

// Vínculo consentimento ↔ empresa/representante, sem armazenar documentos.
// A Polp não devolve CPF/CNPJ no consentimento; o único campo livre de correlação é `cliente_user_id`.
// Na criação gravamos ali um HMAC (segredo de sessão do CRM, propósito exclusivo) de CPF+CNPJ: opaco, não reversível
// sem o segredo e comparável depois. Consentimentos antigos ('gravon-pipeflow') não têm vínculo e só são aceitos quando
// a própria Polp prova a correspondência (POST /consents com avoidDuplicates compara os documentos exatamente).
export const POLP_BINDING_PREFIX='pipeflow:v1:';
export async function polpDocumentBinding(cpf:string,cnpj:string,secret:string|undefined):Promise<string>{
 if(!secret)throw new Error('Sessão indisponível.');
 if(!/^\d{11}$/.test(cpf)||!/^\d{14}$/.test(cnpj))throw new Error('Documentos inválidos.');
 return POLP_BINDING_PREFIX+await signCrmSession(`polp-consent-binding:v1:${cpf}:${cnpj}`,secret);
}
function safeEqual(a:string,b:string):boolean{
 if(a.length!==b.length)return false;
 let difference=0;for(let i=0;i<a.length;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);
 return difference===0;
}
export function isBoundConsent(c:{cliente_user_id?:string|null}):boolean{return typeof c.cliente_user_id==='string'&&c.cliente_user_id.startsWith(POLP_BINDING_PREFIX);}
export function consentMatchesBinding(c:{cliente_user_id?:string|null},binding:string):boolean{return isBoundConsent(c)&&safeEqual(c.cliente_user_id as string,binding);}

// Reaproveitamento pela listagem: somente consentimentos com vínculo idêntico aos documentos informados.
// Consentimentos sem vínculo ou de outra empresa nunca são reaproveitados nem renovados a partir da lista.
export function selectBoundConsent<T extends PolpConsent>(consents:T[],institutionId:string,binding:string){
 return selectExistingConsent(consents.filter(c=>consentMatchesBinding(c,binding)),institutionId);
}
// Resposta do POST /consents (avoidDuplicates): a Polp devolve consentimento com os mesmos documentos ou cria um novo.
// Rejeita instituição divergente ou vínculo de outros documentos (inconsistência → falha fechada).
export function createdConsentMatches(c:PolpConsent,institutionId:string,binding:string):boolean{
 if(c.institution_id!==institutionId)return false;
 return !isBoundConsent(c)||consentMatchesBinding(c,binding);
}

// Prova assinada e de curta duração de que o consentimento pertence aos documentos informados nesta sessão.
// Fica apenas em memória no navegador; a renovação exige essa prova, então nunca renova consentimento de outra empresa.
export const RENEWAL_PROOF_TTL_MS=2*60*60*1000;
export async function issueRenewalProof(consentId:string,binding:string,secret:string|undefined,now:number=Date.now()):Promise<string>{
 if(!secret)throw new Error('Sessão indisponível.');
 const payload=JSON.stringify({v:1,consentId,binding,exp:now+RENEWAL_PROOF_TTL_MS});
 return JSON.stringify({payload,signature:await signCrmSession(`polp-renewal-proof:${payload}`,secret)});
}
export async function verifyRenewalProof(token:string,consentId:string,secret:string|undefined,now:number=Date.now()):Promise<string|null>{
 if(!secret||typeof token!=='string'||token.length>2000)return null;
 try{
  const envelope=JSON.parse(token) as {payload?:unknown;signature?:unknown};
  if(typeof envelope.payload!=='string'||typeof envelope.signature!=='string'||envelope.payload.length>1500)return null;
  const expected=await signCrmSession(`polp-renewal-proof:${envelope.payload}`,secret);
  if(!safeEqual(expected,envelope.signature))return null;
  const p=JSON.parse(envelope.payload) as {v?:unknown;consentId?:unknown;binding?:unknown;exp?:unknown};
  if(p.v!==1||p.consentId!==consentId||typeof p.binding!=='string'||!p.binding.startsWith(POLP_BINDING_PREFIX)||typeof p.exp!=='number'||p.exp<=now)return null;
  return p.binding;
 }catch{return null;}
}

// Renovação protegida contra execuções simultâneas por um lease atômico no banco (RPC service-only).
// Sem o lease (migração pendente ou erro) nada é enviado à Polp: falha fechada.
export type RenewalLease={ok:true;leaseId:string}|{ok:false;reason:'busy'|'unavailable'};
export type RenewDeps<Row>={
 claimLease(consentId:string):Promise<RenewalLease>;
 releaseLease(consentId:string,leaseId:string):Promise<void>;
 getConsent(consentId:string):Promise<PolpCallResult<PolpConsent>>;
 recreate(consentId:string):Promise<PolpCallResult<PolpConsent>>;
 save(consent:PolpConsent):Promise<Row|null>;
 now?():number;
};
export type RenewResult<Row>={ok:true;consent:PolpConsent;row:Row;renewed:boolean;notice:string|null}|{ok:false;error:string};
export async function renewConsentLink<Row>(deps:RenewDeps<Row>,input:{consentId:string;institutionId:string;binding:string}):Promise<RenewResult<Row>>{
 const lease=await deps.claimLease(input.consentId);
 if(!lease.ok)return {ok:false,error:lease.reason==='busy'?'Já existe uma renovação em andamento para esta conexão. Aguarde alguns instantes e use "Atualizar status". Nenhum novo link foi gerado.':'Proteção contra renovações simultâneas indisponível (migração pendente). Nenhum novo link foi gerado.'};
 let keepLease=false;
 try{
  const current=await deps.getConsent(input.consentId);
  if(!current.ok)return {ok:false,error:`${polpReadErrorMessage(current.reason,current.httpStatus)} Nenhum novo link foi gerado.`};
  const c=current.data;
  if(c.id!==input.consentId||c.institution_id!==input.institutionId)return {ok:false,error:'A Polp devolveu um consentimento diferente do registrado. Nenhum novo link foi gerado.'};
  // Vinculado a outros documentos → outra empresa/representante: nunca renova.
  if(isBoundConsent(c)&&!consentMatchesBinding(c,input.binding))return {ok:false,error:'Este consentimento pertence a outra empresa ou representante. Nenhum novo link foi gerado.'};
  let consent=c,renewed=false,notice:string|null=null;
  if(!canRecreateConsent(c.status,c.url_to_authenticate_expires_at,deps.now?.()??Date.now())){
   notice=c.status==='AUTHORISED'?'A conta já está conectada; nenhum novo link foi gerado.':'O link atual ainda é válido; nenhum novo link foi gerado.';
  }else{
   const result=await deps.recreate(input.consentId);
   if(!result.ok){
    // Resultado desconhecido: mantém o lease até expirar para impedir nova renovação imediata.
    if(result.reason==='timeout'||result.reason==='invalid_response'||result.reason==='unavailable')keepLease=true;
    return {ok:false,error:polpRecreateErrorMessage(result.reason,result.httpStatus)};
   }
   if(result.data.id!==input.consentId||result.data.institution_id!==input.institutionId||(isBoundConsent(result.data)&&!consentMatchesBinding(result.data,input.binding))){keepLease=true;return {ok:false,error:'A Polp respondeu com um consentimento inconsistente. Use "Atualizar status" antes de tentar de novo.'};}
   consent=result.data;renewed=true;
  }
  const row=await deps.save(consent);
  if(!row)return {ok:false,error:renewed?'Novo link solicitado à Polp, mas não foi possível atualizar o registro local. Use "Atualizar status".':'Não foi possível atualizar o registro da conexão.'};
  return {ok:true,consent,row,renewed,notice};
 }finally{
  if(!keepLease)await deps.releaseLease(input.consentId,lease.leaseId).catch(()=>undefined);
 }
}
