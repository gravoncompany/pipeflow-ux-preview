import {test} from 'node:test';
import assert from 'node:assert/strict';
import {counterpartyDocHmac,normalizeTransaction,normalizeAccount,contentHash,planSyncWindow,initialRange,syncPolpConsent,authorizedJobRequest,UPSERT_BATCH_SIZE,type BankTransactionRow,type SyncDeps,type SyncPlan} from './polp-bank-sync.server';
import {listPolpAccountTransactionsForSync} from './polp-api.server';
import {polpTransactionSchema,polpTransactionSyncSchema,type PolpAccount,type PolpTransactionSync} from './polp';

// Dados fictícios. Nenhuma chamada real à Polp ou ao banco.
const SECRET='fixture-session-secret';
const NOW=Date.parse('2026-11-02T18:00:00Z');
const keys={clientId:'fixture-client',clientSecret:'fixture-secret'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const tx=(over:Partial<PolpTransactionSync>&Record<string,unknown>={}):PolpTransactionSync=>polpTransactionSyncSchema.parse({id:'tx-1',account_id:'acc-1',transaction_name:'Pix recebido',transaction_date_time:'2026-10-15T10:00:00Z',type:'PIX',credit_debit_type:'CREDITO',transaction_amount:{amount:'300.0000',currency:'BRL'},partie_cnpj_cpf:'11.222.333/0001-81',partie_person_type:'PESSOA_JURIDICA',counterparty:{name:'Cliente Exemplo Ltda',alias:null},category_ref:null,created_at:'2026-10-15T10:01:00Z',updated_at:'2026-10-15T10:01:00Z',...over});
const account:PolpAccount={id:'acc-1',number:'123456789',check_digit:'0',type:'CONTA_DEPOSITO_A_VISTA',subtype:'INDIVIDUAL',currency:'BRL',balance:{update_date_time:'2026-11-02T12:00:00Z',has_reserved_balance:false,available_amount:{amount:'1500.0000',currency:'BRL'},blocked_amount:{amount:'0.00',currency:'BRL'},automatically_invested_amount:null}};

test('HMAC da contraparte: CPF/CNPJ normalizados, opaco, determinístico; inválidos ou sem segredo → null',async()=>{
 const a=await counterpartyDocHmac('11.222.333/0001-81',SECRET),b=await counterpartyDocHmac('11222333000181',SECRET);
 assert.deepEqual(a,b);assert.equal(a?.kind,'cnpj');assert.equal(a?.version,1);assert.match(a?.hmac??'',/^[0-9a-f]{64}$/);
 assert.equal((await counterpartyDocHmac('123.456.789-01',SECRET))?.kind,'cpf');
 assert.notEqual(a?.hmac,(await counterpartyDocHmac('11222333000181','outro-segredo'))?.hmac);
 for(const bad of [null,'','123','1234567890123','00000000000','11111111111111'])assert.equal(await counterpartyDocHmac(bad,SECRET),null);
 assert.equal(await counterpartyDocHmac('11222333000181',undefined),null);
});
test('normalização: valor 4 casas → centavos, moeda, datas ISO e documento nunca armazenado',async()=>{
 const row=await normalizeTransaction(tx(),'acc-1',SECRET);
 assert.equal(row.amount_cents,30000);assert.equal(row.amount_raw,'300.0000');assert.equal(row.currency,'BRL');assert.equal(row.direction,'CREDITO');
 assert.equal(row.transaction_at,'2026-10-15T10:00:00.000Z');assert.equal(row.counterparty_doc_kind,'cnpj');assert.equal(row.counterparty_name,'Cliente Exemplo Ltda');
 const serialized=JSON.stringify(row);for(const doc of ['11222333000181','11.222.333'])assert.equal(serialized.includes(doc),false);
 const odd=await normalizeTransaction(tx({transaction_amount:{amount:'10.00',currency:'brl '},transaction_date_time:'não-é-data',partie_cnpj_cpf:null}),'acc-1',SECRET);
 assert.equal(odd.currency,'BRL');assert.equal(odd.transaction_at,null);assert.equal(odd.counterparty_doc_hmac,null);assert.equal(odd.counterparty_key_version,null);
 const noAmount=await normalizeTransaction(tx({transaction_amount:null}),'acc-1',SECRET);
 assert.equal(noAmount.amount_raw,'ausente');assert.equal(noAmount.amount_cents,null);
 assert.equal((await normalizeTransaction(tx({transaction_amount:{amount:'1.00',currency:'REAL'}}),'acc-1',SECRET)).currency,'XXX');
});
test('hash de conteúdo estável e sensível a mudanças do provedor (ex.: enriquecimento da contraparte)',async()=>{
 const a=await normalizeTransaction(tx(),'acc-1',SECRET),b=await normalizeTransaction(tx(),'acc-1',SECRET);
 assert.equal(a.content_hash,b.content_hash);
 const {content_hash:_h,...rest}=a;void _h;assert.equal(await contentHash(rest),a.content_hash);
 assert.notEqual((await normalizeTransaction(tx({counterparty:{name:'Outro Nome',alias:null}}),'acc-1',SECRET)).content_hash,a.content_hash);
});
test('conta: apenas os 4 últimos dígitos e saldo em centavos',()=>{
 const r=normalizeAccount(account);
 assert.equal(r.number_suffix,'6789');assert.equal(JSON.stringify(r).includes('123456789'),false);
 assert.equal(r.available_cents,150000);assert.equal(r.blocked_cents,0);assert.equal(r.invested_cents,null);assert.equal(r.bank_updated_at,'2026-11-02T12:00:00.000Z');
 assert.equal(normalizeAccount({...account,balance:null}).bank_updated_at,null);
});
test('leitura manual (navegador) nunca recebe o documento da contraparte',()=>{
 const parsed=polpTransactionSchema.parse({id:'x',partie_cnpj_cpf:'11222333000181',credit_debit_type:'CREDITO'});
 assert.equal('partie_cnpj_cpf' in parsed,false);
});
test('janela: incremental com sobreposição de 24 h; período até 92 dias; sem histórico automático',()=>{
 const inc=planSyncWindow({mode:'incremental',now:NOW,lastSuccessStartedAt:'2026-11-01T18:00:00Z'});
 assert.equal(inc.ok,true);if(inc.ok){assert.equal(inc.plan.query.fromUpdatedAt,'2026-10-31T18:00:00.000Z');assert.equal(inc.plan.query.fromDate,undefined);}
 assert.deepEqual(planSyncWindow({mode:'incremental',now:NOW,lastSuccessStartedAt:null}),{ok:false,error:'initial_required'});
 assert.deepEqual(planSyncWindow({mode:'incremental',now:NOW,lastSuccessStartedAt:'2026-06-01T00:00:00Z'}),{ok:false,error:'window_too_large'});
 const r=planSyncWindow({mode:'range',now:NOW,lastSuccessStartedAt:null,fromDate:'2026-09-01T00:00:00Z',toDate:'2026-10-01T00:00:00Z'});
 assert.equal(r.ok&&r.plan.query.fromDate,'2026-09-01T00:00:00.000Z');
 assert.deepEqual(planSyncWindow({mode:'range',now:NOW,lastSuccessStartedAt:null,fromDate:'2026-01-01T00:00:00Z',toDate:'2026-10-01T00:00:00Z'}),{ok:false,error:'window_too_large'});
 for(const [f,t] of [['2026-10-02','2026-10-01'],['x','2026-10-01'],['2026-11-01','2026-12-31']])assert.deepEqual(planSyncWindow({mode:'range',now:NOW,lastSuccessStartedAt:null,fromDate:f,toDate:t}),{ok:false,error:'invalid_range'});
 const init=initialRange(NOW);assert.equal(Date.parse(init.toDate)-Date.parse(init.fromDate),30*24*60*60*1000);
});

// Base simulada com a mesma semântica das RPCs da migração 0078 (lease, upsert idempotente, versões append-only).
function fakeLedger(){
 const rows=new Map<string,BankTransactionRow&{revision:number}>();const versions:{id:string;revision:number}[]=[];
 let lease:string|null=null,seq=0;const finished:{status:string;code:string|null;skipped:number}[]=[];const accounts:string[]=[];
 return {rows,versions,finished,accounts,
  claim:async(_p:SyncPlan)=>{if(lease)return null;lease=`run-${++seq}`;return lease;},
  recordAccounts:async(run:string,a:{polp_account_id:string}[])=>{if(run!==lease)throw new Error('polp_sync_lease_lost');accounts.push(...a.map(x=>x.polp_account_id));},
  upsert:async(run:string,batch:BankTransactionRow[])=>{
   if(run!==lease)throw new Error('polp_sync_lease_lost');
   let inserted=0,updated=0,unchanged=0;
   for(const r of batch){const cur=rows.get(r.polp_transaction_id);
    if(!cur){rows.set(r.polp_transaction_id,{...r,revision:1});versions.push({id:r.polp_transaction_id,revision:1});inserted++;continue;}
    if(cur.content_hash===r.content_hash||(cur.provider_updated_at&&r.provider_updated_at&&r.provider_updated_at<cur.provider_updated_at)){unchanged++;continue;}
    rows.set(r.polp_transaction_id,{...r,revision:cur.revision+1});versions.push({id:r.polp_transaction_id,revision:cur.revision+1});updated++;}
   return {inserted,updated,unchanged};
  },
  finish:async(run:string,status:'success'|'partial'|'failed',skipped:number,code:string|null)=>{if(run===lease)lease=null;finished.push({status,code,skipped});},
 };
}
const plan:SyncPlan={mode:'range',from:'2026-10-01T00:00:00.000Z',to:'2026-10-31T00:00:00.000Z',query:{fromDate:'2026-10-01T00:00:00.000Z',toDate:'2026-10-31T00:00:00.000Z'}};
function deps(ledger:ReturnType<typeof fakeLedger>,txs:()=>PolpTransactionSync[],opts:{accountsOk?:boolean;complete?:boolean;skipped?:number}={}):SyncDeps&{polpCalls:()=>number}{
 let calls=0;
 return {claim:ledger.claim,recordAccounts:ledger.recordAccounts,upsert:ledger.upsert,finish:ledger.finish,polpCalls:()=>calls,
  listAccounts:async()=>{calls++;return opts.accountsOk===false?{ok:false,httpStatus:500,reason:'http_error'}:{ok:true,httpStatus:200,data:{items:[account],complete:true,skipped:0}};},
  listTransactions:async()=>{calls++;return {ok:true,httpStatus:200,data:{items:txs(),complete:opts.complete??true,skipped:opts.skipped??0}};}};
}

test('sincronização idempotente: segunda leitura idêntica não duplica nem gera versões',async()=>{
 const ledger=fakeLedger();const data=()=>[tx(),tx({id:'tx-2',credit_debit_type:'DEBITO',transaction_amount:{amount:'49.9000',currency:'BRL'},partie_cnpj_cpf:null})];
 const first=await syncPolpConsent(deps(ledger,data),{plan,secret:SECRET});
 assert.equal(first.ok&&first.inserted,2);assert.equal(first.ok&&first.status,'success');
 const second=await syncPolpConsent(deps(ledger,data),{plan,secret:SECRET});
 assert.equal(second.ok&&second.inserted,0);assert.equal(second.ok&&second.unchanged,2);
 assert.equal(ledger.rows.size,2);assert.equal(ledger.versions.length,2);assert.deepEqual(ledger.finished.map(f=>f.status),['success','success']);
});
test('mudança do provedor gera nova revisão preservando a original; atualização mais antiga é ignorada',async()=>{
 const ledger=fakeLedger();
 await syncPolpConsent(deps(ledger,()=>[tx()]),{plan,secret:SECRET});
 const enriched=await syncPolpConsent(deps(ledger,()=>[tx({counterparty:{name:'Cliente Exemplo',alias:'Exemplo'},updated_at:'2026-10-16T00:00:00Z'})]),{plan,secret:SECRET});
 assert.equal(enriched.ok&&enriched.updated,1);assert.equal(ledger.rows.get('tx-1')?.revision,2);assert.deepEqual(ledger.versions.map(v=>v.revision),[1,2]);
 const stale=await syncPolpConsent(deps(ledger,()=>[tx({transaction_name:'Versão antiga',updated_at:'2026-10-15T00:00:00Z'})]),{plan,secret:SECRET});
 assert.equal(stale.ok&&stale.unchanged,1);assert.equal(ledger.rows.get('tx-1')?.counterparty_name,'Exemplo');
});
test('sincronização simultânea: segunda execução recebe "em andamento" sem chamar a Polp',async()=>{
 const ledger=fakeLedger();let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
 const slow=deps(ledger,()=>[tx()]);const original=slow.listAccounts;slow.listAccounts=async()=>{await gate;return original();};
 const p1=syncPolpConsent(slow,{plan,secret:SECRET});
 await new Promise(r=>setTimeout(r,5));
 const other=deps(ledger,()=>[tx()]);const p2=await syncPolpConsent(other,{plan,secret:SECRET});
 assert.equal(p2.ok,false);assert.match(!p2.ok?p2.error:'',/em andamento/);assert.equal(other.polpCalls(),0);
 release();assert.equal((await p1).ok,true);
});
test('falhas: contas indisponíveis → failed; página incompleta → partial (cursor não avança); erro inesperado → failed',async()=>{
 const l1=fakeLedger();const r1=await syncPolpConsent(deps(l1,()=>[tx()],{accountsOk:false}),{plan,secret:SECRET});
 assert.equal(r1.ok,false);assert.deepEqual(l1.finished[0],{status:'failed',code:'accounts_unavailable',skipped:0});assert.equal(l1.rows.size,0);
 const l2=fakeLedger();const r2=await syncPolpConsent(deps(l2,()=>[tx()],{complete:false,skipped:2}),{plan,secret:SECRET});
 assert.equal(r2.ok&&r2.status,'partial');assert.deepEqual(l2.finished[0],{status:'partial',code:'partial_read',skipped:2});assert.equal(l2.rows.size,1);
 const l3=fakeLedger();const d3=deps(l3,()=>[tx()]);d3.upsert=async()=>{throw new Error('boom');};
 const r3=await syncPolpConsent(d3,{plan,secret:SECRET});assert.equal(r3.ok,false);assert.equal(l3.finished[0]?.status,'failed');
 const l4=fakeLedger();const d4=deps(l4,()=>[tx()]);const r4=await syncPolpConsent(d4,{plan,secret:undefined});
 assert.equal(r4.ok,false);assert.equal(d4.polpCalls(),0);assert.equal(l4.finished.length,0);
});
test('lotes de no máximo 500 linhas por chamada',async()=>{
 const ledger=fakeLedger();const d=deps(ledger,()=>Array.from({length:1200},(_,i)=>tx({id:`tx-${i}`})));
 const sizes:number[]=[];const up=d.upsert;d.upsert=async(run,rows)=>{sizes.push(rows.length);return up(run,rows);};
 const r=await syncPolpConsent(d,{plan,secret:SECRET});
 assert.equal(r.ok&&r.inserted,1200);assert.deepEqual(sizes,[UPSERT_BATCH_SIZE,UPSERT_BATCH_SIZE,200]);
});
test('rotina agendada: desativada sem segredo forte; comparação exata',()=>{
 const strong='x'.repeat(40);
 assert.equal(authorizedJobRequest(`Bearer ${strong}`,undefined),false);
 assert.equal(authorizedJobRequest('Bearer curto','curto'),false);
 assert.equal(authorizedJobRequest(`Bearer ${strong}y`,strong),false);
 assert.equal(authorizedJobRequest(strong,strong),false);
 assert.equal(authorizedJobRequest(`Bearer ${strong}`,strong),true);
});
test('leitura para sincronização: parâmetros validados e documento lido apenas no servidor',async()=>{
 let url='';
 const r=await listPolpAccountTransactionsForSync(keys,'acc-1',{fromUpdatedAt:'2026-10-31T18:00:00Z',toUpdatedAt:'2026-11-02T18:00:00Z'},async u=>{url=String(u);return json({data:[tx()],meta:{next_cursor:null}});});
 const u=new URL(url);assert.equal(u.searchParams.get('fromUpdatedAt'),'2026-10-31T18:00:00.000Z');assert.equal(u.searchParams.get('fromDate'),null);
 assert.equal(r.ok&&r.data.items[0].partie_cnpj_cpf,'11.222.333/0001-81');
 assert.equal((await listPolpAccountTransactionsForSync(keys,'acc-1',{},async()=>json({data:[]}))).ok,false);
 assert.equal((await listPolpAccountTransactionsForSync(keys,'acc-1',{fromDate:'x'},async()=>json({data:[]}))).ok,false);
});
