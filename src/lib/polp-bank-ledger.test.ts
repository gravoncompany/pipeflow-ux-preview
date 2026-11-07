import {test} from 'node:test';
import assert from 'node:assert/strict';
import {periodRange,spDate,summarizeLedger,categoryLabel,shouldAutoSync,AUTO_SYNC_INTERVAL_MS,type LedgerRow} from './polp-bank-ledger';

const row=(over:Partial<LedgerRow>={}):LedgerRow=>({id:'t',transactionAt:'2026-11-01T12:00:00Z',description:'Pix',amountCents:30000,currency:'BRL',direction:'CREDITO',accountSuffix:'6789',category:null,type:'PIX',counterparty:null,...over});

test('períodos seguem o calendário de São Paulo (virada de mês às 00:00 -03:00)',()=>{
 const now=Date.parse('2026-11-02T18:00:00Z');
 assert.deepEqual(periodRange('mes_atual',now),{from:'2026-11-01T03:00:00.000Z',to:'2026-12-01T03:00:00.000Z'});
 assert.deepEqual(periodRange('mes_anterior',now),{from:'2026-10-01T03:00:00.000Z',to:'2026-11-01T03:00:00.000Z'});
 assert.deepEqual(periodRange('ano_atual',now),{from:'2026-01-01T03:00:00.000Z',to:'2027-01-01T03:00:00.000Z'});
 assert.deepEqual(periodRange('ano_anterior',now),{from:'2025-01-01T03:00:00.000Z',to:'2026-01-01T03:00:00.000Z'});
 const l30=periodRange('ultimos_30',now);assert.equal(l30.to,'2026-11-03T03:00:00.000Z');assert.equal(Date.parse(l30.to)-Date.parse(l30.from),30*24*60*60*1000);
 // 01/11 às 01:00 UTC ainda é 31/10 em São Paulo → mês atual = outubro.
 const lateOct=Date.parse('2026-11-01T01:00:00Z');assert.deepEqual(spDate(lateOct),{y:2026,m:10,d:31});
 assert.equal(periodRange('mes_atual',lateOct).from,'2026-10-01T03:00:00.000Z');
 // Janeiro → mês anterior é dezembro do ano anterior; dezembro → próximo ano.
 assert.equal(periodRange('mes_anterior',Date.parse('2027-01-15T12:00:00Z')).from,'2026-12-01T03:00:00.000Z');
 assert.equal(periodRange('mes_atual',Date.parse('2026-12-15T12:00:00Z')).to,'2027-01-01T03:00:00.000Z');
});
test('totais: entradas/saídas separadas, módulo do valor, exclusões e pendências de conciliação',()=>{
 const s=summarizeLedger([row(),row({id:'b',amountCents:1050}),row({id:'c',direction:'DEBITO',amountCents:-4990}),row({id:'d',direction:null}),row({id:'e',amountCents:null}),row({id:'f',currency:'USD'})]);
 assert.deepEqual(s,{incomeCents:31050,expenseCents:4990,netCents:26060,counted:3,excluded:3,pendingReconciliation:3});
 assert.deepEqual(summarizeLedger([]),{incomeCents:0,expenseCents:0,netCents:0,counted:0,excluded:0,pendingReconciliation:0});
});
test('categoria só quando informada pela Polp',()=>{
 assert.equal(categoryLabel('FOOD_AND_DRINK_RESTAURANT'),'Food and drink restaurant');
 for(const v of [null,undefined,'','___'])assert.equal(categoryLabel(v),null);
});
test('sincronização automática: nunca sincronizada ou após 6 h; nunca durante execução em andamento',()=>{
 const now=Date.parse('2026-11-02T18:00:00Z');
 assert.equal(shouldAutoSync(null,null,now),true);
 assert.equal(shouldAutoSync(new Date(now-AUTO_SYNC_INTERVAL_MS+60000).toISOString(),'success',now),false);
 assert.equal(shouldAutoSync(new Date(now-AUTO_SYNC_INTERVAL_MS).toISOString(),'success',now),true);
 assert.equal(shouldAutoSync(null,'running',now),false);
 assert.equal(shouldAutoSync('inválido','failed',now),true);
});
