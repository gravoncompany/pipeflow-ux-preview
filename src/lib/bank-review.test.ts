import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classify,reviewStatus,dashboardTotals,monthlySeries,bankTotals,categoryAllowed,sphereOf,type ClassifiableRow,type DashRow,type Classification} from './bank-classification';
import {buildBankLedger,type LedgerDb} from './polp-bank-ledger.server';

const r=(over:Partial<ClassifiableRow>={}):ClassifiableRow=>({direction:'DEBITO',type:'PIX',categoryRef:null,description:null,counterparty:null,...over});
test('sugestões: iFood pessoal; Meta/Google Ads empresarial (tráfego); CELESC e aluguel ambíguos, nunca automáticos',()=>{
 const i=classify(r({description:'IFOOD *RESTAURANTE'}));assert.deepEqual([i.kind,i.category,i.vendor],['despesa_pessoal','alimentacao','iFood']);
 const m=classify(r({description:'FACEBK *ADS'}));assert.deepEqual([m.kind,m.category],['despesa_operacional','publicidade_marketing']);
 assert.equal(classify(r({description:'GOOGLE ADS'})).category,'publicidade_marketing');
 const c=classify(r({description:'CELESC DISTRIBUICAO'}));assert.equal(c.kind,'nao_classificado');assert.match(c.hint??'',/empresa ou pessoal/);
 const a=classify(r({description:'PAGAMENTO ALUGUEL OUTUBRO'}));assert.equal(a.kind,'nao_classificado');assert.match(a.hint??'',/comercial ou residencial/);
 assert.match(classify(r({categoryRef:'RENT_AND_UTILITIES_RENT'})).hint??'',/comercial ou residencial/);
 assert.match(classify(r({categoryRef:'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY'})).hint??'',/empresa ou pessoal/);
 assert.equal(classify(r({categoryRef:'TRANSPORTATION_TAXIS_AND_RIDE_SHARES'})).category,'transporte_pessoal');
 assert.equal(classify(r({categoryRef:'GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES'})).category,'compras_pessoais');
 assert.equal(classify(r({categoryRef:'GENERAL_MERCHANDISE_OFFICE_SUPPLIES'})).kind,'despesa_operacional');
});
test('esferas e categorias válidas por tipo',()=>{
 assert.equal(sphereOf('receita_operacional'),'empresarial');assert.equal(sphereOf('despesa_pessoal'),'pessoal');assert.equal(sphereOf('resgate'),'investimento');assert.equal(sphereOf('transferencia_interna'),'outras');
 assert.equal(categoryAllowed('despesa_operacional','publicidade_marketing'),true);assert.equal(categoryAllowed('despesa_operacional','alimentacao'),false);
 assert.equal(categoryAllowed('despesa_pessoal','alimentacao'),true);assert.equal(categoryAllowed('aplicacao','alimentacao'),false);
 const o=classify(r(),[],{kind:'despesa_pessoal',category:'publicidade_marketing',vendor:null});assert.equal(o.category,null); // categoria incompatível descartada
});
test('status: confirmado (aprovado, regra, conciliado, tipo do banco p/ investimento), corrigido, pendente; ambíguo sempre pendente',()=>{
 const cls=(c:Partial<Classification>):Classification=>({kind:'despesa_operacional',category:'outras_despesas',vendor:null,source:'fornecedor',...c});
 assert.equal(reviewStatus(cls({}),null,false),'pendente');
 assert.equal(reviewStatus(cls({}),{decision:'aprovado'},false),'confirmado');
 assert.equal(reviewStatus(cls({}),{decision:'corrigido'},false),'corrigido');
 assert.equal(reviewStatus(cls({source:'regra'}),null,false),'confirmado');
 assert.equal(reviewStatus(cls({kind:'aplicacao',category:null,source:'tipo_polp'}),null,false),'confirmado');
 assert.equal(reviewStatus(cls({kind:'despesa_operacional',source:'tipo_polp'}),null,false),'pendente');
 assert.equal(reviewStatus(cls({kind:'receita_operacional',category:null,source:'padrao'}),null,true),'confirmado');
 assert.equal(reviewStatus(cls({kind:'receita_operacional',category:null,source:'padrao'}),null,false),'pendente');
 assert.equal(reviewStatus(cls({kind:'nao_classificado',category:null,source:'descricao',hint:'x'}),null,false),'pendente');
});
const row=(amount:number,direction:'CREDITO'|'DEBITO',cls:Partial<Classification>,status:DashRow['status'],at='2026-11-10T12:00:00Z'):DashRow=>({amountCents:amount,currency:'BRL',direction,transactionAt:at,status,cls:{kind:'nao_classificado',category:null,vendor:null,source:'padrao',...cls}});
test('painel: só confirmados nas despesas; tráfego dentro das despesas (sem dupla contagem); pessoais e investimentos fora; pendentes separados',()=>{
 const rows=[row(300_00,'DEBITO',{kind:'despesa_operacional',category:'publicidade_marketing',vendor:'Meta Ads'},'confirmado'),row(100_00,'DEBITO',{kind:'despesa_operacional',category:'softwares_assinaturas'},'corrigido'),
  row(999_00,'DEBITO',{kind:'despesa_operacional',category:'fornecedores'},'pendente'),row(80_00,'DEBITO',{kind:'despesa_pessoal',category:'alimentacao'},'confirmado'),
  row(5000_00,'DEBITO',{kind:'aplicacao'},'confirmado'),row(4000_00,'CREDITO',{kind:'resgate'},'confirmado'),row(700_00,'CREDITO',{kind:'receita_operacional'},'pendente'),row(50_00,'CREDITO',{kind:'despesa_operacional',category:'publicidade_marketing'},'confirmado')];
 const d=dashboardTotals(rows,1500_00);
 assert.equal(d.operatingExpenseCents,300_00+100_00-50_00);assert.equal(d.trafficCents,300_00-50_00);assert.equal(d.revenueCents,1500_00);assert.equal(d.operatingResultCents,1500_00-350_00);
 assert.equal(d.personalConfirmedCents,80_00);assert.equal(d.pendingOutCents,999_00);assert.equal(d.pendingInCents,700_00);assert.equal(d.pendingCount,2);
 // Totais bancários continuam batendo com o extrato (todas as linhas, independentemente do status).
 const b=bankTotals(rows);assert.equal(b.bankOutCents,300_00+100_00+999_00+80_00+5000_00);assert.equal(b.bankInCents,4000_00+700_00+50_00);assert.equal(b.personalOutCents,80_00);
});
test('série mensal: faturamento oficial + despesas confirmadas; meses sem dados vazios',()=>{
 const s=monthlySeries([row(200_00,'DEBITO',{kind:'despesa_operacional',category:'publicidade_marketing'},'confirmado','2026-03-10T12:00:00Z'),row(90_00,'DEBITO',{kind:'despesa_operacional',category:'fornecedores'},'pendente','2026-03-11T12:00:00Z')],new Map([['2026-03',1000_00],['2026-05',500_00]]),2026);
 assert.deepEqual(s[2],{month:'2026-03',revenue:1000_00,expenses:200_00,result:800_00,traffic:200_00});
 assert.deepEqual(s[4],{month:'2026-05',revenue:500_00,expenses:0,result:500_00,traffic:0});
 assert.equal(s[0].revenue,null);assert.equal(s[11].expenses,null);
});

// Leitura ponta a ponta com banco simulado (sem rede): decisões, regras inativas, conciliação, período e faturamento oficial.
function fakeDb(tables:Record<string,Record<string,unknown>[]>,missing:string[]=[]):LedgerDb{
 return {from(t:string){return {select(cols:string){const st={rows:[...(tables[t]??[])],err:missing.some(m=>t===m||cols.includes(m))};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- construtor de consultas simulado para teste
  const q:any={eq:(c:string,v:unknown)=>{st.rows=st.rows.filter(r=>r[c]===v);return q;},in:(c:string,v:unknown[])=>{st.rows=st.rows.filter(r=>v.includes(r[c]));return q;},
   gte:(c:string,v:string)=>{st.rows=st.rows.filter(r=>String(r[c])>=v);return q;},lt:(c:string,v:string)=>{st.rows=st.rows.filter(r=>String(r[c])<v);return q;},order:()=>q,limit:()=>q,
   range:(a:number,b:number)=>{st.rows=st.rows.slice(a,b+1);return q;},then:(res:(x:unknown)=>unknown)=>res(st.err?{data:null,error:{message:'missing'}}:{data:st.rows,error:null})};return q;}};}};
}
test('leitura do painel: decisões manuais preservadas, regra inativa ignorada, conciliado confirmado, faturamento oficial, período correto',async()=>{
 const tx=(id:string,o:Record<string,unknown>)=>({id,polp_transaction_id:id,company_key:'crm:1',transaction_at:'2026-11-05T15:00:00Z',description:null,amount_cents:10000,currency:'BRL',direction:'DEBITO',polp_account_id:'acc',category_ref:null,transaction_type:'PIX',counterparty_name:null,...o});
 const db=fakeDb({
  polp_bank_transactions:[tx('meta',{description:'FACEBK *ADS',amount_cents:30000}),tx('ifood',{description:'IFOOD',amount_cents:4500}),tx('rdb',{transaction_type:'APLICACAO_FINANCEIRA',amount_cents:500000}),
   tx('cliente',{direction:'CREDITO',amount_cents:120000,description:'PIX RECEBIDO'}),tx('contab',{description:'PIX ESCRITORIO CONTABIL',amount_cents:20000}),tx('antigo',{transaction_at:'2026-09-01T15:00:00Z',description:'FACEBK *ADS',amount_cents:7000})],
  polp_bank_classification_overrides:[{company_key:'crm:1',polp_transaction_id:'meta',kind:'despesa_operacional',category:'publicidade_marketing',vendor:'Meta Ads',revision:1,decision:'aprovado'},
   {company_key:'crm:1',polp_transaction_id:'ifood',kind:'despesa_pessoal',category:'alimentacao',vendor:'iFood',revision:2,decision:'corrigido'}],
  polp_bank_classification_rules:[{id:'r1',company_key:'crm:1',field:'description',pattern:'escritorio contabil',direction:'DEBITO',kind:'despesa_operacional',category:'fornecedores',vendor:null,active:false}],
  polp_bank_accounts:[{company_key:'crm:1',polp_account_id:'acc',number_suffix:'1234'}],polp_bank_balance_snapshots:[],
  polp_bank_reconciliations:[{company_key:'crm:1',polp_transaction_id:'cliente',target_type:'client_charge',charge_id:'ch1',mode:'manual'}],
  crm_client_charges:[{id:'ch1',description:'Plano mensal',client_id:'c1'}],crm_clients:[{id:'c1',trade_name:'Clínica X',legal_name:null}],
  universe_confirmed_sources:[{amount:120000,date:'2026-11-05',status:'confirmada'},{amount:80000,date:'2026-09-02',status:'confirmada'}],
 });
 const v=await buildBankLedger(db,'mes_atual',Date.parse('2026-11-20T12:00:00Z'));
 assert.equal(v.available,true);if(!v.available)return;
 const by=new Map(v.rows.map(x=>[x.transactionId,x]));
 assert.equal(v.rows.length,5); // 'antigo' (setembro) fica fora do período, mas entra na série anual
 assert.equal(by.get('meta')?.status,'confirmado');assert.equal(by.get('ifood')?.status,'corrigido');assert.equal(by.get('ifood')?.sphere,'pessoal');
 assert.equal(by.get('rdb')?.status,'confirmado');assert.equal(by.get('rdb')?.sphere,'investimento');
 assert.equal(by.get('cliente')?.status,'confirmado');assert.match(by.get('cliente')?.recon?.label??'',/Clínica X · Plano mensal/);
 assert.equal(by.get('contab')?.cls.source,'padrao');assert.equal(by.get('contab')?.status,'pendente'); // regra desativada não se aplica
 assert.equal(v.dashboard.revenueCents,120000);assert.equal(v.dashboard.operatingExpenseCents,30000);assert.equal(v.dashboard.trafficCents,30000);
 assert.equal(v.dashboard.operatingResultCents,90000);assert.equal(v.dashboard.personalConfirmedCents,4500);assert.equal(v.dashboard.pendingOutCents,20000);
 assert.equal(v.series.months[8].revenue,80000);assert.equal(v.series.months[8].expenses,0); // set/2026: Meta antigo ainda pendente
 assert.equal(v.reviewAvailable,true);assert.equal(v.rules[0].active,false);
 // Sem a 0081 (coluna decision ausente): continua funcionando, decisões antigas tratadas como corrigidas.
 const old=await buildBankLedger(fakeDb({...{polp_bank_transactions:[tx('meta',{description:'FACEBK *ADS'})],polp_bank_classification_overrides:[{company_key:'crm:1',polp_transaction_id:'meta',kind:'despesa_operacional',category:'publicidade_marketing',vendor:null,revision:1}],polp_bank_classification_rules:[],polp_bank_accounts:[],polp_bank_balance_snapshots:[],polp_bank_reconciliations:[],universe_confirmed_sources:[]}},['decision','active']),'mes_atual',Date.parse('2026-11-20T12:00:00Z'));
 assert.equal(old.available&&old.reviewAvailable,false);assert.equal(old.available&&old.rows[0].status,'corrigido');
});
