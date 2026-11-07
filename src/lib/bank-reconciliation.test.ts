import {test} from 'node:test';
import assert from 'node:assert/strict';
import {autoMatch,reconciliationCandidates,identifyClients,type ReconClient,type ReconCharge,type ReconPayment,type ReconReceipt} from './bank-reconciliation';
import {reconciliationOperation,reconcileErrorMessage} from './polp-bank-reconciliation.server';

const H='a'.repeat(64),H2='b'.repeat(64);
const clients:ReconClient[]=[{id:'c1',names:['Clínica Sorriso','Sorriso Odontologia Ltda'],cnpjHmac:H},{id:'c2',names:['Estética Bella'],cnpjHmac:H2},{id:'c3',names:['Outro Cliente'],cnpjHmac:null}];
const charge=(o:Partial<ReconCharge>):ReconCharge=>({id:'ch1',clientId:'c1',description:'Plano semanal',remainingCents:30000,dueDate:'2026-11-02',...o});
const payment=(o:Partial<ReconPayment>):ReconPayment=>({id:'p1',chargeId:'ch9',clientId:'c1',description:'Plano semanal',amountCents:30000,paidAt:'2026-11-02',countsInRevenue:false,...o});
const rcv=(o:Partial<ReconReceipt>={}):ReconReceipt=>({transactionId:'tx',amountCents:30000,date:'2026-11-03',counterparty:'SORRISO ODONTOLOGIA LTDA',counterpartyDocHmac:H,...o});

test('automático: documento do pagador + único alvo de valor exato',()=>{
 assert.deepEqual(autoMatch(rcv(),{clients,charges:[charge({})],payments:[]}),{type:'client_charge',id:'ch1'});
});
test('valor igual sozinho nunca vincula; nome parecido também não basta para o automático',()=>{
 assert.equal(autoMatch(rcv({counterpartyDocHmac:null}),{clients,charges:[charge({})],payments:[]}),null);
 assert.equal(autoMatch(rcv({counterpartyDocHmac:'c'.repeat(64)}),{clients,charges:[charge({clientId:'c3'})],payments:[]}),null);
});
test('pagamento já registrado tem prioridade (vincula, não soma de novo); ambíguos ficam para revisão',()=>{
 assert.deepEqual(autoMatch(rcv(),{clients,charges:[charge({})],payments:[payment({})]}),{type:'client_payment',id:'p1'});
 assert.equal(autoMatch(rcv(),{clients,charges:[],payments:[payment({}),payment({id:'p2'})]}),null);
 assert.equal(autoMatch(rcv(),{clients,charges:[charge({}),charge({id:'ch2'})],payments:[]}),null);
 assert.equal(autoMatch(rcv(),{clients,charges:[charge({remainingCents:60000})],payments:[]}),null); // parcial exige confirmação
 assert.equal(autoMatch(rcv(),{clients,charges:[],payments:[payment({paidAt:'2026-10-01'})]}),null); // data distante
 const dup=[...clients,{id:'c9',names:['Duplicado'],cnpjHmac:H}];
 assert.equal(autoMatch(rcv(),{clients:dup,charges:[charge({})],payments:[]}),null); // CNPJ em dois clientes
});
test('candidatos para seleção: ordenados por evidência, com motivos; parcial permitido, excesso não',()=>{
 const list=reconciliationCandidates(rcv({counterpartyDocHmac:null}),{clients,charges:[charge({}),charge({id:'ch2',clientId:'c2',remainingCents:30000}),charge({id:'ch3',remainingCents:20000}),charge({id:'ch4',remainingCents:90000})],
  payments:[payment({countsInRevenue:true})],settlements:[{id:'s1',name:'Consultoria avulsa',amountCents:30000,date:'2026-11-03'},{id:'s2',name:'Outro',amountCents:30000,date:'2026-08-01'}]});
 const ids=list.map(c=>c.id);
 assert.equal(ids[0],'p1');assert.ok(ids.includes('ch1'));assert.ok(ids.includes('ch2'));assert.ok(ids.includes('ch4'));assert.ok(!ids.includes('ch3'));
 assert.ok(ids.includes('s1'));assert.ok(!ids.includes('s2'));
 assert.ok(list.find(c=>c.id==='p1')?.reasons.includes('já registrado no Financeiro'));
 assert.ok(list.find(c=>c.id==='ch4')?.reasons.includes('pagamento parcial'));
 assert.equal(identifyClients(rcv({counterpartyDocHmac:null}),clients).byName[0]?.id,'c1');
});
test('operação determinística por transação e mensagens claras',async()=>{
 const a=await reconciliationOperation('tx-1');assert.equal(a,await reconciliationOperation('tx-1'));assert.notEqual(a,await reconciliationOperation('tx-2'));
 assert.match(a,/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
 assert.match(reconcileErrorMessage('ERROR: not_operating_receipt'),/não podem virar faturamento/);
 assert.match(reconcileErrorMessage('already_reconciled'),/já foi conciliado/);
 assert.match(reconcileErrorMessage('overpayment'),/maior que o saldo/);
});
