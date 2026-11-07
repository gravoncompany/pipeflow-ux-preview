// HyperCash — servidor. Credenciais criptografadas (AES-GCM, INTEGRATIONS_ENCRYPTION_KEY), nunca expostas
// ao navegador nem registradas em logs. Tabelas service-only; toda leitura/escrita exige sessão completa do CRM
// + conta administrativa verificada. Sincronização idempotente: upsert por subscription_id / charge_id.
import { hasFullCrmSession } from "./crm-session.server";
import { internalKnowledgeActor } from "./commercial-knowledge.server";
import { encryptInstagramToken as encrypt, decryptInstagramToken as decrypt } from "./instagram-oauth-crypto.server";
import { mapCharge, mapSubscription, type ChargeStatus } from './hypercash';
import { allHypercashPages, credentialProblem, hypercashRead } from './hypercash-api';
import type { Json } from '@/integrations/supabase/types';
const PROVIDER='hypercash';
const CTX='external-integration:hypercash';
async function admin() {
  const secret = process.env["CRM_SESSION_SECRET"];
  if (!secret || !(await hasFullCrmSession(secret))) throw new Error("Entre com a senha de acesso completo do CRM.");
  const actor = await internalKnowledgeActor("integrations:hypercash", "menu");
  if (!actor || actor.company !== "crm:1") throw new Error("Entre com sua conta administrativa para configurar integrações.");
  await actor.authorize().catch(() => { throw new Error("Sua conta não tem permissão de administrador."); });
  return actor;
}
async function db() { return (await import("@/integrations/supabase/client.server")).supabaseAdmin; }
function encryptionKey() {
  const key = process.env["INTEGRATIONS_ENCRYPTION_KEY"];
  if (!key) throw new Error("Chave de proteção das credenciais ausente no servidor.");
  return key;
}

type IntegrationRow = {
  id: string; provider: string; name: string; status: string; last_check_at: string | null;
  last_check_status: string | null; last_sync_at: string | null; last_sync_status: string | null; revision: number; auto_sync:boolean; transactions_check_status:string|null; transactions_check_at:string|null;
};
const PUBLIC_COLUMNS = "id,provider,name,status,last_check_at,last_check_status,last_sync_at,last_sync_status,revision,auto_sync,transactions_check_status,transactions_check_at";

async function integrationRow(): Promise<IntegrationRow | null> {
  const { data, error } = await (await db()).from("crm_external_integrations").select(PUBLIC_COLUMNS).eq("provider", PROVIDER).maybeSingle();
  if (error) throw new Error("Não foi possível ler a integração.");
  return (data as IntegrationRow | null) ?? null;
}

async function storedKey(): Promise<string> {
  const { data, error } = await (await db()).from("crm_external_integrations").select("encrypted_credentials,status").eq("provider", PROVIDER).maybeSingle();
  if (error) throw new Error("Não foi possível ler a integração.");
  if (!data?.encrypted_credentials) throw new Error("A credencial HCP de Assinaturas não está cadastrada. A credencial SK de Transações permanece separada e não autoriza esta consulta.");
  return decrypt(data.encrypted_credentials as string, encryptionKey(), CTX);
}

const api=hypercashRead;
async function storedTransactionsKey() {
 const {data,error}=await (await db()).from('crm_external_integrations').select('encrypted_transactions_credentials').eq('provider',PROVIDER).maybeSingle();
 if(error||!data?.encrypted_transactions_credentials)throw new Error('Salve a credencial SK de Transações primeiro.');
 return decrypt(data.encrypted_transactions_credentials,encryptionKey(),CTX+':transactions');
}
async function allRows(table:'crm_hypercash_subscriptions'|'crm_hypercash_charges') {
 const client=await db();const result:Record<string,unknown>[]=[];
 for(let page=0;page<1000;page++){const {data,error}=await client.from(table).select('*').order('id').range(page*500,page*500+499);if(error)throw new Error('Não foi possível ler os registros HyperCash.');result.push(...data);if(data.length<500)return result;}
 throw new Error('Consulta HyperCash excedeu o limite seguro.');
}
export async function hypercashOverview() {
 const actor=await admin();const integration=await integrationRow();const client=await db();
 const credentials=await client.from('crm_external_integrations').select('encrypted_credentials,encrypted_transactions_credentials').eq('provider',PROVIDER).maybeSingle();
 if(credentials.error)throw new Error('Não foi possível verificar a configuração das APIs.');
 const [subscriptions,charges,logs,clientsRes,accounts,targets,payments,banks,payouts,audit]=await Promise.all([
  allRows('crm_hypercash_subscriptions'),allRows('crm_hypercash_charges'),
  client.from('crm_hypercash_sync_log').select('id,started_at,finished_at,outcome,subscriptions_count,charges_count,message').order('started_at',{ascending:false}).limit(20),
  client.from('crm_clients').select('id,trade_name,legal_name,email').limit(2000),
  client.from('finance_records').select('id,data').eq('scope','crm:1').eq('kind','account'),
  client.from('crm_client_charges').select('id,client_id,description,amount,status').limit(2000),
  client.from('crm_client_payments').select('id,charge_id,amount,paid_at,finance_account_id').limit(2000),
  client.from('polp_bank_transactions').select('polp_transaction_id,polp_account_id,description,counterparty_name,amount_cents,transaction_at').eq('company_key','crm:1').eq('direction','CREDITO').eq('currency','BRL').order('transaction_at',{ascending:false}).limit(1000),
  client.from('crm_hypercash_payout_links').select('bank_transaction_id,charge_id,gross_cents,fee_cents'),
  client.from('crm_hypercash_audit').select('id,event,created_at').order('created_at',{ascending:false}).limit(30),
 ]);
 if([logs,clientsRes,accounts,targets,payments,banks,payouts,audit].some(r=>r.error))throw new Error('Não foi possível carregar o acompanhamento HyperCash.');
 await actor.authorize();
 return {integration,credentialsSaved:Boolean(credentials.data?.encrypted_credentials),transactionsCredentialsSaved:Boolean(credentials.data?.encrypted_transactions_credentials),subscriptions:subscriptions as unknown as Array<{subscription_id:string;customer_name:string|null;customer_email:string|null;product_name:string|null;amount_cents:number|null;frequency:string|null;status:string|null;next_billing_date:string|null;client_id:string|null;payment_method:string|null}>,
 charges:charges as unknown as Array<{id:string;charge_id:string;subscription_id:string|null;transaction_id:string|null;amount_cents:number;status:string;billing_date:string|null;paid_at:string|null;customer_name:string|null;customer_email:string|null;client_id:string|null;finance_payment_id:string|null}>,syncLog:logs.data??[],
 clients:(clientsRes.data??[]).map(c=>({id:c.id,name:c.trade_name||c.legal_name||'Cliente',email:c.email})),
 accounts:(accounts.data??[]).map(a=>({id:a.id,name:String((a.data as Record<string,unknown>).name??'Conta')})),targets:targets.data??[],payments:payments.data??[],banks:banks.data??[],payouts:payouts.data??[],audit:audit.data??[]};
}

/** Testa a chave chamando o resumo de assinaturas; não salva nada. */
async function checkKey(key:string) {
 const res=await api('/v1/subscriptions/summary',key);
 if(!res.ok)return res;
 if(!res.body||typeof res.body!=='object'||(res.body as {success?:unknown}).success!==true)return {ok:false as const,http:200,code:'schema'};
 return {ok:true as const};
}

export async function saveHypercash(input: { apiKey: string }) {
  const actor = await admin();
  const apiKey = input.apiKey.trim();
  const problem=credentialProblem(apiKey,"subscriptions");if(problem)throw new Error(problem);
  const check = await checkKey(apiKey);
  if (!check.ok) return { saved: false as const, failure: { http: check.http, code: check.code } };
  const encrypted = await encrypt(apiKey, encryptionKey(), CTX);
  await actor.authorize();
  const now = new Date().toISOString();
  const client = await db();
  const existing = await integrationRow();
  if (!existing) {
    const { error } = await client.from("crm_external_integrations").insert({
      provider: PROVIDER, name: "HyperCash", encrypted_credentials: encrypted, status: "ativa",
      last_check_at: now, last_check_status: "ok", updated_at: now,
    });
    if (error) throw new Error("Outra pessoa salvou a integração agora. Atualize a página.");
  } else {
    const { data, error } = await client.from("crm_external_integrations").update({
      encrypted_credentials: encrypted, status: "ativa", last_check_at: now, last_check_status: "ok",
      revision: existing.revision + 1, updated_at: now,
    }).eq("provider", PROVIDER).eq("revision", existing.revision).select("revision");
    if (error || !data?.length) throw new Error("A configuração mudou desde que você abriu a página. Atualize e tente de novo.");
  }
  return { saved: true as const };
}

export async function testHypercash() {
  const actor=await admin();
  const key = await storedKey();
  const check = await checkKey(key);
  await actor.authorize();
  const saved=await (await db()).from("crm_external_integrations").update({
    last_check_at: new Date().toISOString(), last_check_status: check.ok ? "ok" : `falha:${check.code}`, updated_at: new Date().toISOString(),
  }).eq("provider", PROVIDER);
  if(saved.error)throw new Error('Não foi possível registrar a data da verificação.');
  return check;
}

export async function setHypercashActive(active: boolean, revision: number) {
  const actor=await admin();
  if(active){const check=await checkKey(await storedKey());if(!check.ok)throw new Error('A API de Assinaturas precisa passar na verificação antes de ser ativada.');}
  await actor.authorize();
  const { data, error } = await (await db()).from("crm_external_integrations")
    .update({ status: active ? "ativa" : "desativada", revision: revision + 1, updated_at: new Date().toISOString() })
    .eq("provider", PROVIDER).eq("revision", revision).select("revision");
  if (error || !data?.length) throw new Error("A configuração mudou desde que você abriu a página. Atualize e tente de novo.");
  return { ok: true as const };
}

export async function saveHypercashTransactions(input:{apiKey:string}) {
 const actor=await admin();const key=input.apiKey.trim();const problem=credentialProblem(key,'transactions');if(problem)throw new Error(problem);
 const check=await api('/user/transactions',key,'transactions');if(!check.ok)return {saved:false as const,failure:check};
 const encrypted=await encrypt(key,encryptionKey(),CTX+':transactions');await actor.authorize();
 const existing=await integrationRow();const client=await db();const now=new Date().toISOString();
 if(existing){const {data,error}=await client.from('crm_external_integrations').update({encrypted_transactions_credentials:encrypted,transactions_check_status:'ok',transactions_check_at:now,revision:existing.revision+1}).eq('provider',PROVIDER).eq('revision',existing.revision).select('id');if(error||!data?.length)throw new Error('A configuração mudou. Atualize a página.');}
 else{const {error}=await client.from('crm_external_integrations').insert({provider:PROVIDER,name:'HyperCash',encrypted_transactions_credentials:encrypted,transactions_check_status:'ok',transactions_check_at:now,status:'desativada'});if(error)throw new Error('Não foi possível salvar a credencial.');}
 return {saved:true as const};
}
export async function testHypercashTransactions(){const actor=await admin();const check=await api('/user/transactions',await storedTransactionsKey(),'transactions');await actor.authorize();const {error}=await (await db()).from('crm_external_integrations').update({transactions_check_status:check.ok?'ok':check.code,transactions_check_at:new Date().toISOString()}).eq('provider',PROVIDER);if(error)throw new Error('Não foi possível registrar a verificação.');return check.ok?{ok:true as const}:check;}

export async function syncHypercash() { const actor=await admin();return runHypercashSync(()=>actor.authorize()); }
export async function runHypercashSync(recheck:()=>Promise<void>=async()=>undefined){
 const integration=await integrationRow();if(!integration||integration.status!=='ativa')throw new Error('Conecte e ative a API de assinaturas antes de sincronizar.');
 const key=await storedKey();const client=await db();const lease=crypto.randomUUID();
 const claimed=await client.rpc('claim_hypercash_sync',{p_lease:lease});if(claimed.error||!claimed.data)throw new Error('Outra sincronização está em andamento.');
 const log=await client.from('crm_hypercash_sync_log').insert({integration_id:integration.id}).select('id').single();
 if(log.error||!log.data){await client.from('crm_external_integrations').update({sync_lease:null,sync_lease_until:null}).eq('sync_lease',lease);throw new Error('Não foi possível registrar a sincronização.');}
 let subCount=0,chargeCount=0;
 try{
  const subscriptions=await allHypercashPages('/v1/subscriptions',key,mapSubscription);
  const charges=[];
  for(const sub of subscriptions){const rows=await allHypercashPages(`/v1/subscriptions/${encodeURIComponent(sub.subscriptionId)}/transactions`,key,(raw)=>mapCharge(raw,sub.subscriptionId));for(const row of rows){if(row.subscriptionId!==sub.subscriptionId)throw new Error('HyperCash: cobrança vinculada a outra assinatura.');charges.push({...row,customerName:sub.customerName,customerEmail:sub.customerEmail});}}
  await recheck();const applied=await client.rpc('apply_hypercash_snapshot',{p_lease:lease,p_revision:integration.revision,p_subs:subscriptions as unknown as Json,p_charges:charges as unknown as Json});if(applied.error)throw new Error('Não foi possível salvar a sincronização completa; configuração ou recebimento confirmado mudou.');
  subCount=subscriptions.length;chargeCount=charges.length;
  const finish=await client.from('crm_hypercash_sync_log').update({finished_at:new Date().toISOString(),outcome:'ok',subscriptions_count:subCount,charges_count:chargeCount}).eq('id',log.data.id);if(finish.error)throw new Error('Não foi possível concluir o histórico.');
  await client.from('crm_external_integrations').update({last_sync_at:new Date().toISOString(),last_sync_status:'ok'}).eq('provider',PROVIDER);
  return {ok:true as const,subscriptions:subCount,charges:chargeCount};
 }catch(error){const message=error instanceof Error?error.message:'Falha de sincronização.';await client.from('crm_hypercash_sync_log').update({finished_at:new Date().toISOString(),outcome:'erro',subscriptions_count:subCount,charges_count:chargeCount,message:message.slice(0,300)}).eq('id',log.data.id);await client.from('crm_external_integrations').update({last_sync_status:'erro',sync_lease:null,sync_lease_until:null}).eq('sync_lease',lease);throw error;}
}
export async function setHypercashAutoSync(active:boolean,revision:number){const actor=await admin();if(active){const row=await integrationRow();if(row?.status!=='ativa'||row.last_check_status!=='ok')throw new Error('Ative e verifique a API de Assinaturas antes da sincronização periódica.');await storedKey();}await actor.authorize();const {data,error}=await (await db()).from('crm_external_integrations').update({auto_sync:active,revision:revision+1}).eq('provider',PROVIDER).eq('revision',revision).select('id');if(error||!data?.length)throw new Error('A configuração mudou. Atualize.');return {ok:true as const};}

/** Vínculo manual de uma cobrança a um cliente (quando o e-mail não bastou). */
export async function linkHypercashClient(input: { chargeId: string; clientId: string }) {
  await admin();
  const client = await db();
  const { data: charge, error: chargeError } = await client.from("crm_hypercash_charges").select("id,client_id,finance_payment_id").eq("id", input.chargeId).maybeSingle();
  if (chargeError || !charge) throw new Error("Cobrança não encontrada.");
  if (charge.finance_payment_id) throw new Error("Esta cobrança já foi confirmada no Financeiro; o vínculo não pode mudar.");
  const { data: clientRow, error: clientError } = await client.from("crm_clients").select("id").eq("id", input.clientId).maybeSingle();
  if (clientError || !clientRow) throw new Error("Cliente não encontrado.");
  const { data:linked,error } = await client.from("crm_hypercash_charges").update({ client_id: input.clientId }).eq("id", input.chargeId).is("finance_payment_id",null).select("id");
  if (error||!linked?.length) throw new Error("Não foi possível vincular o cliente; a cobrança mudou.");
  return { ok: true as const };
}

/**
 * Confirma um recebimento HyperCash no Financeiro: cria (ou reutiliza) a cobrança interna do cliente e
 * registra o pagamento uma única vez por charge_id. O repasse posterior ao banco nunca é receita
 * (classificação bancária trata "HyperCash" como transferência interna da plataforma).
 */
export async function confirmHypercashPayment(input:{chargeId:string;confirmed:boolean;accountId:string;targetChargeId?:string;targetPaymentId?:string}) {
 const actor=await admin();if(!input.confirmed)throw new Error('Confirme o recebimento.');await actor.authorize();
 const {data,error}=await (await db()).rpc('confirm_hypercash_receipt',{p_actor:actor.userId,p_charge:input.chargeId,p_account:input.accountId,p_target_charge:input.targetChargeId,p_target_payment:input.targetPaymentId});
 if(error)throw new Error('Recebimento não confirmado. Verifique cliente, conta, data, valor e vínculo existente; nenhum pagamento parcial foi criado.');
 return {ok:true as const,already:Boolean((data as {already?:boolean})?.already)};
}
export async function linkHypercashPayout(input:{bankId:string;chargeIds:string[];feeCents:number;confirmed:boolean}) {
 const actor=await admin();if(!input.confirmed)throw new Error('Confirme a conciliação.');await actor.authorize();
 const {error}=await (await db()).rpc('link_hypercash_payout',{p_actor:actor.userId,p_bank:input.bankId,p_charges:input.chargeIds,p_fee:input.feeCents});
 if(error)throw new Error('Conciliação não confirmada. O bruto menos as taxas deve corresponder ao repasse, sem vínculos anteriores.');return {ok:true as const};
}

/** Histórico financeiro HyperCash de um cliente (aba Financeiro da ficha). */
export async function clientHypercashHistory(clientId: string) {
  await admin();
  const client = await db();
  const [charges, subs] = await Promise.all([
    client.from("crm_hypercash_charges").select("id,charge_id,transaction_id,amount_cents,status,billing_date,paid_at,finance_payment_id").eq("client_id", clientId).order("billing_date", { ascending: false }).limit(100),
    client.from("crm_hypercash_subscriptions").select("subscription_id,product_name,amount_cents,frequency,status,next_billing_date").eq("client_id", clientId).limit(20),
  ]);
  if (charges.error || subs.error) throw new Error("Não foi possível carregar o histórico HyperCash.");
  return { charges: charges.data ?? [], subscriptions: subs.data ?? [] };
}

/** Cobranças pagas ainda sem cliente: ficam disponíveis para vinculação posterior. */
export type { ChargeStatus };

/** Read-only diagnostics; never imports rows, updates checks, enables sync or confirms receipts. */
export async function inspectHypercashReadOnly() {
 const actor=await admin();const client=await db();
 const r=await client.from('crm_external_integrations').select('encrypted_credentials,encrypted_transactions_credentials').eq('provider',PROVIDER).maybeSingle();
 if(r.error)throw new Error('Não foi possível ler a configuração.');
 let subscriptions:number|null=null,charges:number|null=null,catalogueReference:number|null=null,transactionsCheck:string='not_configured',transactionsReturned:number|null=null,transactionReference:number|null=null;
 if(r.data?.encrypted_credentials){const key=await storedKey();const subs=await allHypercashPages('/v1/subscriptions',key,mapSubscription);subscriptions=subs.length;charges=0;catalogueReference=0;for(const sub of subs){await actor.authorize();const items=await allHypercashPages(`/v1/subscriptions/${encodeURIComponent(sub.subscriptionId)}/transactions`,key,raw=>mapCharge(raw,sub.subscriptionId));charges+=items.length;catalogueReference+=items.filter(c=>c.status==='paid'&&c.paidAt?.slice(0,10)==='2026-10-31').length;}}
 if(r.data?.encrypted_transactions_credentials){const response=await api('/user/transactions',await storedTransactionsKey(),'transactions');transactionsCheck=response.ok?'ok':response.code;if(response.ok){const body=response.body;const object=body&&typeof body==='object'?body as Record<string,unknown>:{};const list=Array.isArray(body)?body:Array.isArray(object.data)?object.data:Array.isArray(object.transactions)?object.transactions:Array.isArray(object.items)?object.items:null;if(list){transactionsReturned=list.length;transactionReference=list.filter(row=>row&&typeof row==='object'&&Object.entries(row).some(([key,v])=>/date|at$/i.test(key)&&typeof v==='string'&&v.slice(0,10)==='2026-10-31')).length;}}}
 await actor.authorize();return {subscriptions,charges,catalogueReference,transactionsCheck,transactionsReturned,transactionReference,transactionCoverage:'Apenas resposta da consulta sem filtros; paginação e unidades da API de Transações não documentadas. Correspondência de data não confirma status de pagamento.',financialWrites:false};
}
