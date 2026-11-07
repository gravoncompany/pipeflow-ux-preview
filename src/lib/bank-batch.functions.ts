import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { BANK_KINDS, COST_CATEGORIES, categoryAllowed } from './bank-classification';

const item = z.object({ transactionId:z.string().min(1).max(128), kind:z.enum(BANK_KINDS), category:z.enum(COST_CATEGORIES).nullable(), vendor:z.string().max(80).nullable(), expectedRevision:z.number().int().min(0), decision:z.enum(['aprovado','corrigido']), clientId:z.string().uuid().nullable(), reconciliation:z.object({target:z.enum(['client_charge','client_payment']),targetId:z.string().uuid(),accountId:z.string().uuid().nullable()}).strict().nullable() }).strict();
export type BankBatchItem=z.infer<typeof item>;
export const confirmBankBatch=createServerFn({method:'POST'})
 .inputValidator(i=>z.object({operation:z.string().uuid(),confirmed:z.literal(true),items:z.array(item).min(1).max(3000)}).strict().parse(i))
 .handler(async({data})=>{
  const {financeAccess}=await import('./finance-management.server');
  const {db,actor}=await financeAccess(true);
  for(const i of data.items) if(!categoryAllowed(i.kind,i.category))throw new Error('Categoria incompatível. Nada foi confirmado.');
  const payload=data.items.map(i=>({transaction_id:i.transactionId,kind:i.kind,category:i.category,vendor:i.vendor,expected_revision:i.expectedRevision,decision:i.decision,rule:null,client_id:i.clientId,reconciliation:i.reconciliation?{target:i.reconciliation.target,target_id:i.reconciliation.targetId,account_id:i.reconciliation.accountId}:null}));
  const {data:saved,error}=await db.rpc('review_polp_bank_batch',{p_company_key:'crm:1',p_operation:data.operation,p_items:payload,p_actor:String(actor).slice(0,120)});
  if(error){
   const m=error.message;
   throw new Error(m.includes('classification_changed')?'Uma classificação mudou. Atualize a lista; nada deste lote foi salvo.':m.includes('not_operating_receipt')?'RDB, resgates, transferências e repasses HyperCash não podem virar receita. Nada foi salvo.':m.includes('client_link_conflict')?'Um pagamento já está vinculado a outro cliente. Nada foi salvo.':m.includes('overpayment')?'O valor supera o saldo da cobrança. Nada foi salvo.':'Não foi possível confirmar o lote. Nada foi salvo; revise os vínculos e categorias.');
  }
  await financeAccess(true);
  return {saved:Number(saved)};
 });

export const getBankReviewContext=createServerFn({method:'POST'}).handler(async()=>{
 const {financeAccess}=await import('./finance-management.server'); const {db}=await financeAccess(false);
 const [clients,charges,accounts,audit]=await Promise.all([
  db.from('crm_clients').select('id,trade_name,legal_name').order('id').limit(1000),
  db.from('crm_client_charges').select('id,client_id,description,amount,due_date,status').in('status',['pendente','vencido']).order('due_date').limit(1000),
  db.from('finance_records').select('id,data').eq('scope','crm:1').eq('kind','account').limit(100),
  db.from('polp_bank_classification_audit').select('id,polp_transaction_id,after_data,actor,created_at').eq('company_key','crm:1').order('created_at',{ascending:false}).limit(100),
 ]);
 if(clients.error||charges.error||accounts.error||audit.error)throw new Error('Não foi possível ler clientes e histórico.');
 await financeAccess(false);
 return {clients:clients.data??[],charges:charges.data??[],accounts:(accounts.data??[]).map(a=>({id:a.id,name:String((a.data as {name?:string}).name??'Conta')})),audit:audit.data??[]};
});

export const getClientBankHistory=createServerFn({method:'POST'}).inputValidator(i=>z.object({clientId:z.string().uuid()}).strict().parse(i)).handler(async({data})=>{
 const {financeAccess}=await import('./finance-management.server'); const {db}=await financeAccess(false);
 const {data:client,error:ce}=await db.from('crm_clients').select('id').eq('id',data.clientId).maybeSingle();
 if(ce||!client)throw new Error('Cliente não encontrado.');
 const {data:links,error}=await db.from('polp_bank_client_links').select('polp_transaction_id,created_at').eq('company_key','crm:1').eq('client_id',data.clientId).limit(1000);
 if(error)throw new Error('Não foi possível ler os pagamentos bancários.');
 const ids=(links??[]).map(l=>l.polp_transaction_id);
 const result: {id:string;date:string|null;amount:number;description:string|null;status:string}[]=[];
 for(let i=0;i<ids.length;i+=50){
  const [tx,ov]=await Promise.all([db.from('polp_bank_transactions').select('polp_transaction_id,transaction_at,amount_cents,description').eq('company_key','crm:1').in('polp_transaction_id',ids.slice(i,i+50)),db.from('polp_bank_classification_overrides').select('polp_transaction_id,kind,decision').eq('company_key','crm:1').in('polp_transaction_id',ids.slice(i,i+50))]);
  if(tx.error||ov.error)throw new Error('Não foi possível ler os pagamentos bancários.');
  for(const t of tx.data??[]){const o=ov.data?.find(o=>o.polp_transaction_id===t.polp_transaction_id);if(o?.kind==='receita_operacional')result.push({id:t.polp_transaction_id,date:t.transaction_at,amount:Number(t.amount_cents),description:t.description,status:'Confirmado'});}
 }
 await financeAccess(false);return result;
});