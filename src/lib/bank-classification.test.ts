import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classify,bankTotals,expensesByCategory,topVendors,monthlyBreakdown,normalizeText,learnFromHistory,reviewStatus,type ClassifiableRow,type AggRow,type Classification,type HistoryEntry} from './bank-classification';

const r=(over:Partial<ClassifiableRow>={}):ClassifiableRow=>({direction:'DEBITO',type:'PIX',categoryRef:null,description:null,counterparty:null,...over});
const k=(row:ClassifiableRow)=>{const c=classify(row);return [c.kind,c.category,c.vendor,c.source];};

test('RDB e investimentos pelo tipo informado pelo banco (inclui caixinhas = saldo reservado)',()=>{
 assert.deepEqual(k(r({type:'APLICACAO_FINANCEIRA'})),['aplicacao',null,null,'tipo_polp']);
 assert.deepEqual(k(r({type:'RESGATE_APLIC_FINANCEIRA',direction:'CREDITO'})),['resgate',null,null,'tipo_polp']);
 assert.deepEqual(k(r({type:'RESGATE_APLIC_FINANCEIRA',direction:'DEBITO'})),['aplicacao',null,null,'tipo_polp']);
 assert.deepEqual(k(r({type:'RENDIMENTO_APLIC_FINANCEIRA',direction:'CREDITO'})),['rendimento',null,null,'tipo_polp']);
 assert.equal(classify(r({type:'TRANSFERENCIA_SALDO_RESERVADO',direction:'DEBITO'})).kind,'aplicacao');
 assert.equal(classify(r({type:'TRANSFERENCIA_SALDO_RESERVADO',direction:'CREDITO'})).kind,'resgate');
 assert.equal(classify(r({type:'OPERACAO_CREDITO',direction:'CREDITO'})).kind,'emprestimo');
});
test('categoria da Polp: investimento, poupança, conta própria, rendimento, impostos, tarifas, empréstimo',()=>{
 assert.equal(classify(r({categoryRef:'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS'})).kind,'aplicacao');
 assert.equal(classify(r({categoryRef:'TRANSFER_IN_SAVINGS',direction:'CREDITO'})).kind,'resgate');
 assert.equal(classify(r({categoryRef:'INCOME_INTEREST_EARNED',direction:'CREDITO'})).kind,'rendimento');
 assert.equal(classify(r({categoryRef:'TRANSFER_OUT_ACCOUNT_TRANSFER'})).kind,'transferencia_interna');
 assert.equal(classify(r({categoryRef:'TRANSFER_IN_ACCOUNT_TRANSFER',direction:'CREDITO'})).kind,'transferencia_interna');
 assert.deepEqual(k(r({categoryRef:'GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT'})),['despesa_operacional','impostos',null,'categoria_polp']);
 assert.deepEqual(k(r({categoryRef:'BANK_FEES_OTHER_BANK_FEES'})),['despesa_operacional','despesas_administrativas',null,'categoria_polp']);
 assert.equal(classify(r({categoryRef:'LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT'})).kind,'emprestimo');
 assert.deepEqual(k(r({categoryRef:'FOOD_AND_DRINK_RESTAURANT'})),['despesa_pessoal','alimentacao',null,'categoria_polp']); // consumo → sugestão pessoal
 assert.equal(classify(r({categoryRef:'OTHER_OTHER'})).kind,'nao_classificado');
 assert.equal(classify(r({categoryRef:'TRANSFER_OUT_TRANSFER_OUT_FROM_APPS'})).kind,'nao_classificado');
 assert.equal(classify(r({type:'PACOTE_TARIFA_SERVICOS'})).category,'despesas_administrativas');
 assert.equal(classify(r({type:'FOLHA_PAGAMENTO'})).category,'equipe');
});
test('fornecedores só por nome explícito; sem adivinhação',()=>{
 assert.deepEqual(k(r({description:'FACEBK *ADS 123'})),['despesa_operacional','publicidade_marketing','Meta Ads','fornecedor']);
 assert.equal(classify(r({description:'Google Ads Brasil'})).vendor,'Google Ads');
 assert.equal(classify(r({description:'GOOGLE *SERVICES'})).vendor,null);
 assert.equal(classify(r({description:'ANTHROPIC, PBC'})).vendor,'Claude (Anthropic)');
 assert.equal(classify(r({counterparty:'Claude Souza'})).vendor,null);
 assert.equal(classify(r({description:'OPENAI *CHATGPT SUBSCR'})).category,'inteligencia_artificial');
 assert.equal(classify(r({description:'LOVABLE LABS'})).vendor,'Lovable');
 assert.equal(classify(r({description:'HOSTINGER'})).category,'hospedagem_infraestrutura');
 assert.equal(classify(r({description:'ElevenLabs Inc'})).vendor,'ElevenLabs');
 assert.equal(classify(r({description:'CANVA* 1234'})).category,'softwares_assinaturas');
 assert.equal(classify(r({description:'FACEBOOK reembolso',direction:'CREDITO'})).kind,'receita_operacional'); // fornecedor só em saídas
});
test('palavras-chave de investimento na descrição; entradas sem indicação = receita a conciliar; saídas sem dados = não classificado',()=>{
 assert.equal(classify(r({description:'Aplicação RDB'})).kind,'aplicacao');
 assert.equal(classify(r({description:'Resgate RDB',direction:'CREDITO'})).kind,'resgate');
 assert.equal(classify(r({description:'Dinheiro guardado'})).kind,'aplicacao');
 assert.equal(classify(r({description:'Rendimento líquido',direction:'CREDITO'})).kind,'rendimento');
 assert.deepEqual(k(r({direction:'CREDITO',description:'Pix recebido'})),['receita_operacional',null,null,'padrao']);
 assert.deepEqual(k(r({description:'Pix enviado'})),['nao_classificado',null,null,'padrao']);
 assert.equal(classify(r({direction:null})).kind,'nao_classificado');
});
test('precedência: manual > regra confirmada > automático; regra normaliza texto e respeita sentido',()=>{
 const rules=[{field:'description' as const,pattern:'Pix enviado - Escritório Contábil',direction:'DEBITO' as const,kind:'despesa_operacional' as const,category:'fornecedores' as const,vendor:'Contabilidade'}];
 assert.deepEqual(k(r({description:'PIX ENVIADO - ESCRITORIO CONTABIL XYZ'})),['nao_classificado',null,null,'padrao']);
 const c=classify(r({description:'PIX ENVIADO - ESCRITORIO CONTABIL XYZ'}),rules);assert.deepEqual([c.kind,c.category,c.vendor,c.source],['despesa_operacional','fornecedores','Contabilidade','regra']);
 assert.equal(classify(r({description:'Pix enviado - Escritório Contábil',direction:'CREDITO'}),rules).source,'padrao');
 const m=classify(r({type:'APLICACAO_FINANCEIRA',description:'Pix enviado - Escritório Contábil'}),rules,{kind:'transferencia_interna',category:'equipe',vendor:null});
 assert.deepEqual([m.kind,m.category,m.source],['transferencia_interna',null,'manual']);
 assert.equal(normalizeText('  Ação   RÁPIDA '),'acao rapida');
});

test('repasse HyperCash na entrada nunca é receita: liquidação da plataforma, pendente de confirmação',()=>{
 const c=classify(r({direction:'CREDITO',description:'Transferência recebida HYPERCASH PAGAMENTOS',counterparty:'HyperCash Ltda'}));
 assert.equal(c.kind,'transferencia_interna');
 assert.equal(c.vendor,'HyperCash');
 assert.ok(c.hint); // fica pendente até o usuário confirmar — anti-duplicidade de faturamento
 assert.equal(reviewStatus(c,null,false),'pendente');
 // Saídas para a HyperCash (tarifas) não caem na regra de repasse
 assert.notEqual(classify(r({description:'HyperCash tarifa'})).kind,'transferencia_interna');
});

test('aprendizado Pipeflow IA: reconhece pagador recorrente pelo histórico confirmado, sempre pendente',()=>{
 const history=new Map<string,HistoryEntry[]>([
  ['clinica sorriso',[{kind:'receita_operacional',category:null,vendor:null,direction:'CREDITO'},{kind:'receita_operacional',category:null,vendor:null,direction:'CREDITO'}]],
  ['fornecedor unico',[{kind:'despesa_operacional',category:'fornecedores',vendor:null,direction:'DEBITO'}]],
  ['divergente',[{kind:'receita_operacional',category:null,vendor:null,direction:'CREDITO'},{kind:'transferencia_interna',category:null,vendor:null,direction:'CREDITO'}]],
 ]);
 // 2 confirmações consistentes → confiança alta
 const alta=classify(r({direction:'CREDITO',counterparty:'Clínica Sorriso',description:'Pix recebido'}),[],null,history);
 assert.deepEqual([alta.kind,alta.source,alta.confidence],['receita_operacional','historico','alta']);
 assert.equal(reviewStatus(alta,null,false),'pendente'); // nunca confirmada automaticamente
 // 1 confirmação → confiança média
 const media=classify(r({counterparty:'Fornecedor Único',description:'Pix enviado'}),[],null,history);
 assert.deepEqual([media.kind,media.category,media.confidence],['despesa_operacional','fornecedores','media']);
 // histórico divergente não sugere
 assert.equal(classify(r({direction:'CREDITO',counterparty:'Divergente'}),[],null,history).source,'padrao');
 // regra confirmada continua tendo precedência sobre o aprendizado
 const rules=[{field:'counterparty' as const,pattern:'Clínica Sorriso',direction:null,kind:'receita_operacional' as const,category:null,vendor:'Clínica'}];
 assert.equal(classify(r({direction:'CREDITO',counterparty:'Clínica Sorriso'}),rules,null,history).source,'regra');
 // learnFromHistory: favorecido curto/ausente e categoria incompatível não sugerem
 assert.equal(learnFromHistory('ab','CREDITO',[{kind:'receita_operacional',category:null,vendor:null,direction:null}]),null);
 assert.equal(learnFromHistory(null,'CREDITO',[{kind:'receita_operacional',category:null,vendor:null,direction:null}]),null);
 assert.equal(learnFromHistory('Clínica','CREDITO',[{kind:'despesa_operacional',category:'alimentacao',vendor:null,direction:null}]),null);
});

const row=(amount:number,direction:'CREDITO'|'DEBITO',cls:Partial<Classification>,at='2026-11-10T12:00:00Z'):AggRow=>({amountCents:amount,currency:'BRL',direction,transactionAt:at,cls:{kind:'nao_classificado',category:null,vendor:null,source:'padrao',...cls}});
test('cada tipo alimenta a caixa certa; investimentos, transferências e empréstimos fora do resultado operacional',()=>{
 const t=bankTotals([
  row(300_00,'CREDITO',{kind:'receita_operacional'}),row(50_00,'DEBITO',{kind:'receita_operacional'}), // estorno reduz receita
  row(120_00,'DEBITO',{kind:'despesa_operacional',category:'inteligencia_artificial',vendor:'OpenAI'}),row(20_00,'CREDITO',{kind:'despesa_operacional',category:'inteligencia_artificial',vendor:'OpenAI'}), // reembolso reduz despesa
  row(1000_00,'DEBITO',{kind:'aplicacao'}),row(400_00,'CREDITO',{kind:'resgate'}),row(5_00,'CREDITO',{kind:'rendimento'}),
  row(200_00,'DEBITO',{kind:'transferencia_interna'}),row(700_00,'CREDITO',{kind:'emprestimo'}),row(30_00,'DEBITO',{kind:'nao_classificado'}),
  {amountCents:null,currency:'BRL',direction:'CREDITO',transactionAt:null,cls:{kind:'receita_operacional',category:null,vendor:null,source:'padrao'}},
 ]);
 assert.equal(t.bankInCents,300_00+20_00+400_00+5_00+700_00);assert.equal(t.bankOutCents,50_00+120_00+1000_00+200_00+30_00);
 assert.equal(t.cashChangeCents,t.bankInCents-t.bankOutCents);
 assert.equal(t.operatingIncomeCents,250_00);assert.equal(t.operatingExpenseCents,100_00);assert.equal(t.operatingResultCents,150_00);
 assert.equal(t.investedCents,1000_00);assert.equal(t.redeemedCents,400_00);assert.equal(t.netInvestedCents,600_00);assert.equal(t.yieldCents,5_00);
 assert.equal(t.internalTransfersCents,200_00);assert.equal(t.loansInCents,700_00);assert.equal(t.unclassifiedOutCents,30_00);assert.equal(t.unclassifiedCount,1);
 assert.equal(t.excluded,1);assert.equal(t.counted,10);
});
test('gastos por categoria, ranking de fornecedores e visão mensal sem zeros inventados',()=>{
 const rows=[row(120_00,'DEBITO',{kind:'despesa_operacional',category:'inteligencia_artificial',vendor:'OpenAI'}),row(80_00,'DEBITO',{kind:'despesa_operacional',category:'inteligencia_artificial',vendor:'Claude (Anthropic)'}),
  row(300_00,'DEBITO',{kind:'despesa_operacional',category:'publicidade_marketing',vendor:'Meta Ads'}),row(50_00,'DEBITO',{kind:'despesa_operacional',category:null}),
  row(999_00,'DEBITO',{kind:'aplicacao'}),row(100_00,'CREDITO',{kind:'receita_operacional'},'2026-03-05T12:00:00Z')];
 assert.deepEqual(expensesByCategory(rows).map(c=>[c.category,c.cents]),[['publicidade_marketing',300_00],['inteligencia_artificial',200_00],['outras_despesas',50_00]]);
 assert.deepEqual(topVendors(rows).map(v=>v.vendor),['Meta Ads','OpenAI','Claude (Anthropic)']);
 const months=monthlyBreakdown(rows,2026);
 assert.equal(months.length,12);assert.equal(months[0].totals,null);assert.equal(months[2].totals?.operatingIncomeCents,100_00);
 assert.equal(months[10].totals?.operatingExpenseCents,550_00);assert.equal(months[10].totals?.investedCents,999_00);assert.equal(months[11].totals,null);
 // Fuso de São Paulo: 01/12 às 01:00 UTC ainda é novembro.
 assert.equal(monthlyBreakdown([row(10_00,'CREDITO',{kind:'receita_operacional'},'2026-12-01T01:00:00Z')],2026)[10].totals?.operatingIncomeCents,10_00);
});
