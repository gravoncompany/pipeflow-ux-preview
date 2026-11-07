import {counterpartyDocHmac} from './polp-bank-sync.server';
import type {ReconClient,ReconCharge,ReconPayment,ReconSettlement} from './bank-reconciliation';

// Dados para conciliação (somente servidor). Documento do cliente vira HMAC na hora e nunca é devolvido ao navegador.
type Res={data:unknown;error:unknown};
type Q=PromiseLike<Res>&{eq(c:string,v:unknown):Q;in(c:string,v:unknown[]):Q;gte(c:string,v:unknown):Q;order(c:string,o:{ascending:boolean}):Q;limit(n:number):Q};
export type ReconDb={from(t:string):{select(c:string):Q};rpc(fn:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:{message?:string}|null}>};
const cents=(v:unknown)=>Math.round(Number(v)*100);

export async function loadReconciliationData(db:ReconDb,secret:string|undefined):Promise<{ok:true;clients:ReconClient[];charges:ReconCharge[];payments:ReconPayment[];settlements:ReconSettlement[];accounts:{id:string;name:string}[];clientNames:Map<string,string>}|{ok:false}>{
 const since=new Date(Date.now()-200*24*60*60*1000).toISOString().slice(0,10);
 const [cl,ch,pay,fin,links]=await Promise.all([
  db.from('crm_clients').select('id,trade_name,legal_name,cnpj').limit(2000),
  db.from('crm_client_charges').select('id,client_id,description,amount,due_date,status').limit(5000),
  db.from('crm_client_payments').select('id,charge_id,amount,paid_at,finance_operation,finance_account_id').gte('paid_at',since).limit(5000),
  db.from('finance_records').select('id,kind,data').eq('scope','crm:1').in('kind',['account','entry','settlement']).limit(20000),
  db.from('polp_bank_reconciliations').select('client_payment_id,finance_settlement_id').limit(20000),
 ]);
 if(cl.error||ch.error||pay.error||fin.error||links.error)return {ok:false};
 const linkedPayments=new Set(((links.data??[]) as {client_payment_id:string|null}[]).map(l=>l.client_payment_id).filter(Boolean));
 const linkedSettlements=new Set(((links.data??[]) as {finance_settlement_id:string|null}[]).map(l=>l.finance_settlement_id).filter(Boolean));
 const clientRows=(cl.data??[]) as {id:string;trade_name:string|null;legal_name:string|null;cnpj:string|null}[];
 const clients:ReconClient[]=[];const clientNames=new Map<string,string>();
 for(const c of clientRows){
  const doc=c.cnpj?await counterpartyDocHmac(c.cnpj,secret):null;
  clients.push({id:c.id,names:[c.trade_name,c.legal_name].filter((n):n is string=>Boolean(n&&n.trim())),cnpjHmac:doc?.kind==='cnpj'?doc.hmac:null});
  clientNames.set(c.id,(c.trade_name||c.legal_name||'Cliente').trim());
 }
 const chargeRows=(ch.data??[]) as {id:string;client_id:string;description:string;amount:number;due_date:string;status:string}[];
 const chargeById=new Map(chargeRows.map(c=>[c.id,c]));
 const payRows=(pay.data??[]) as {id:string;charge_id:string;amount:number;paid_at:string;finance_operation:string|null}[];
 const paidByCharge=new Map<string,number>();
 for(const p of payRows)paidByCharge.set(p.charge_id,(paidByCharge.get(p.charge_id)??0)+cents(p.amount));
 const charges:ReconCharge[]=chargeRows.filter(c=>c.status==='pendente'||c.status==='vencido').map(c=>({id:c.id,clientId:c.client_id,description:c.description,remainingCents:Math.max(0,cents(c.amount)-(paidByCharge.get(c.id)??0)),dueDate:c.due_date})).filter(c=>c.remainingCents>0);
 const payments:ReconPayment[]=payRows.filter(p=>!linkedPayments.has(p.id)&&chargeById.has(p.charge_id)&&chargeById.get(p.charge_id)?.status!=='cancelado').map(p=>{const c=chargeById.get(p.charge_id)!;
  return {id:p.id,chargeId:p.charge_id,clientId:c.client_id,description:c.description,amountCents:cents(p.amount),paidAt:p.paid_at,countsInRevenue:Boolean(p.finance_operation)};});
 const finRows=(fin.data??[]) as {id:string;kind:string;data:Record<string,unknown>}[];
 const entries=new Map(finRows.filter(r=>r.kind==='entry').map(r=>[r.id,r]));
 const settlements:ReconSettlement[]=finRows.filter(r=>r.kind==='settlement'&&r.data.confirmed===true&&!linkedSettlements.has(r.id)&&(entries.get(String(r.data.targetId))?.data.direction==='in')&&String(r.data.date??'')>=since)
  .map(r=>({id:r.id,name:String(entries.get(String(r.data.targetId))?.data.name??r.data.name??'Recebimento'),amountCents:Number(r.data.amount),date:String(r.data.date)}));
 const accounts=finRows.filter(r=>r.kind==='account').map(r=>({id:r.id,name:String(r.data.name??'Conta')}));
 return {ok:true,clients,charges,payments,settlements,accounts,clientNames};
}

// Operação determinística por transação: repetir a conciliação nunca cria um segundo pagamento.
export async function reconciliationOperation(transactionId:string):Promise<string>{
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`polp-reconciliation:v1:${transactionId}`))).slice(0,16);
 bytes[6]=(bytes[6]&0x0f)|0x50;bytes[8]=(bytes[8]&0x3f)|0x80;
 const h=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
 return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
export function reconcileErrorMessage(message:string):string{
 if(message.includes('already_reconciled'))return 'Este recebimento já foi conciliado com outro lançamento.';
 if(message.includes('not_operating_receipt'))return 'Aplicações, resgates, rendimentos, transferências próprias e empréstimos não podem virar faturamento.';
 if(message.includes('not_a_receipt'))return 'Somente entradas em reais com valor e data podem ser conciliadas.';
 if(message.includes('amount_mismatch'))return 'O valor do pagamento registrado é diferente do recebimento bancário.';
 if(message.includes('overpayment'))return 'O recebimento é maior que o saldo em aberto da cobrança.';
 if(message.includes('charge_paid'))return 'A cobrança já está paga ou cancelada.';
 if(message.includes('account_unavailable'))return 'Escolha uma conta válida do Financeiro.';
 if(message.includes('future_settlement'))return 'Pagamentos com data futura não podem ser conciliados.';
 if(message.includes('duplicate')||message.includes('unique'))return 'Este pagamento ou lançamento já está vinculado a outro recebimento.';
 if(message.includes('reconcile_polp_bank_receipt')||message.includes('function'))return 'Conciliação indisponível (migração 0080 pendente).';
 return 'Não foi possível conciliar agora.';
}
