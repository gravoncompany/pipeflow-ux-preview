import {normalizeText} from './bank-classification';

// Conciliação de recebimentos bancários (lógica pura). Vínculo automático somente com correspondência confiável:
// documento do pagador (HMAC) igual ao CNPJ de um único cliente E um único alvo com valor exato.
// Valor igual sozinho nunca vincula. Pagamento já registrado tem prioridade sobre criar novo (evita somar duas vezes).

export type ReconClient={id:string;names:string[];cnpjHmac:string|null};
export type ReconCharge={id:string;clientId:string;description:string;remainingCents:number;dueDate:string};
export type ReconPayment={id:string;chargeId:string;clientId:string;description:string;amountCents:number;paidAt:string;countsInRevenue:boolean};
export type ReconSettlement={id:string;name:string;amountCents:number;date:string};
export type ReconReceipt={transactionId:string;amountCents:number;date:string;counterparty:string|null;counterpartyDocHmac:string|null};
export type ReconCandidate={type:'client_payment'|'client_charge'|'finance_settlement';id:string;clientId:string|null;label:string;amountCents:number;date:string;score:number;reasons:string[]};

const DAY=24*60*60*1000;
const daysBetween=(a:string,b:string)=>Math.abs(Date.parse(`${a}T12:00:00Z`)-Date.parse(`${b}T12:00:00Z`))/DAY;
function nameMatches(counterparty:string|null,names:string[]):boolean{
 const cp=normalizeText(counterparty);if(cp.length<4)return false;
 return names.some(n=>{const v=normalizeText(n);return v.length>=4&&(cp.includes(v)||v.includes(cp));});
}
export function identifyClients(receipt:ReconReceipt,clients:ReconClient[]):{byDoc:ReconClient[];byName:ReconClient[]}{
 const byDoc=receipt.counterpartyDocHmac?clients.filter(c=>c.cnpjHmac&&c.cnpjHmac===receipt.counterpartyDocHmac):[];
 const byName=clients.filter(c=>!byDoc.includes(c)&&nameMatches(receipt.counterparty,c.names));
 return {byDoc,byName};
}
// Candidatos ordenados por evidência, para seleção e confirmação manual.
export function reconciliationCandidates(receipt:ReconReceipt,data:{clients:ReconClient[];charges:ReconCharge[];payments:ReconPayment[];settlements:ReconSettlement[]},limit=10):ReconCandidate[]{
 const {byDoc,byName}=identifyClients(receipt,data.clients);
 const docIds=new Set(byDoc.map(c=>c.id)),nameIds=new Set(byName.map(c=>c.id));
 const who=(clientId:string)=>docIds.has(clientId)?{score:50,reason:'documento do pagador confere com o CNPJ do cliente'}:nameIds.has(clientId)?{score:20,reason:'nome do pagador parecido com o cliente'}:{score:0,reason:''};
 const out:ReconCandidate[]=[];
 for(const p of data.payments){
  const w=who(p.clientId);const exact=p.amountCents===receipt.amountCents;const near=daysBetween(p.paidAt,receipt.date)<=7;
  if(!exact&&!w.score)continue;
  const reasons=[w.reason,exact?'valor exato':'',near?'data próxima':'',p.countsInRevenue?'já registrado no Financeiro':'registrado manualmente (será conciliado, sem somar de novo)'].filter(Boolean);
  out.push({type:'client_payment',id:p.id,clientId:p.clientId,label:`Pagamento registrado · ${p.description}`,amountCents:p.amountCents,date:p.paidAt,score:w.score+(exact?30:0)+(near?10:0)+5,reasons});
 }
 for(const c of data.charges){
  const w=who(c.clientId);const exact=c.remainingCents===receipt.amountCents;const partial=receipt.amountCents<c.remainingCents;const near=daysBetween(c.dueDate,receipt.date)<=10;
  if(!w.score&&!exact)continue;
  if(!exact&&!partial)continue; // recebimento maior que o saldo da cobrança seria recusado (excesso)
  const reasons=[w.reason,exact?'valor exato do saldo da cobrança':'pagamento parcial',near?'vencimento próximo':''].filter(Boolean);
  out.push({type:'client_charge',id:c.id,clientId:c.clientId,label:`Cobrança em aberto · ${c.description}`,amountCents:c.remainingCents,date:c.dueDate,score:w.score+(exact?30:5)+(near?10:0),reasons});
 }
 for(const s of data.settlements){
  if(s.amountCents!==receipt.amountCents||daysBetween(s.date,receipt.date)>7)continue;
  out.push({type:'finance_settlement',id:s.id,clientId:null,label:`Recebimento já lançado · ${s.name}`,amountCents:s.amountCents,date:s.date,score:35,reasons:['valor exato','data próxima','já lançado no Financeiro']});
 }
 return out.sort((a,b)=>b.score-a.score).slice(0,limit);
}
// Decisão automática: só com documento confirmado de um único cliente e um único alvo de valor exato.
export function autoMatch(receipt:ReconReceipt,data:{clients:ReconClient[];charges:ReconCharge[];payments:ReconPayment[]}):{type:'client_payment'|'client_charge';id:string}|null{
 const {byDoc}=identifyClients(receipt,data.clients);
 if(byDoc.length!==1)return null;
 const clientId=byDoc[0].id;
 const pays=data.payments.filter(p=>p.clientId===clientId&&p.amountCents===receipt.amountCents&&daysBetween(p.paidAt,receipt.date)<=7);
 if(pays.length===1)return {type:'client_payment',id:pays[0].id};
 if(pays.length>1)return null;
 const charges=data.charges.filter(c=>c.clientId===clientId&&c.remainingCents===receipt.amountCents);
 return charges.length===1?{type:'client_charge',id:charges[0].id}:null;
}
