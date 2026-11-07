// Classificação das movimentações bancárias (Fase 2). Lógica pura e determinística, compartilhada entre servidor e tela.
// Ordem de precedência: correção manual > regra confirmada pelo usuário > tipo informado pela Polp > categoria da Polp
// > fornecedor conhecido (nome explícito) > palavras-chave de investimento > sem classificação. Nunca inventa fornecedor.

export const BANK_KINDS=['receita_operacional','despesa_operacional','despesa_pessoal','entrada_pessoal','aplicacao','resgate','rendimento','transferencia_interna','emprestimo','nao_classificado'] as const;
export type BankKind=typeof BANK_KINDS[number];
export const KIND_LABEL:Record<BankKind,string>={receita_operacional:'Receita de clientes',despesa_operacional:'Despesa operacional',despesa_pessoal:'Despesa pessoal',entrada_pessoal:'Entrada pessoal',aplicacao:'Aplicação (RDB/investimento)',
 resgate:'Resgate (RDB/investimento)',rendimento:'Rendimento financeiro',transferencia_interna:'Transferência interna',emprestimo:'Empréstimo/financiamento',nao_classificado:'Não classificado'};
export const BUSINESS_CATEGORIES=['publicidade_marketing','softwares_assinaturas','inteligencia_artificial','hospedagem_infraestrutura','aluguel_comercial','fornecedores','equipe','impostos','despesas_administrativas','outras_despesas'] as const;
export const PERSONAL_CATEGORIES=['alimentacao','moradia','contas_domesticas','compras_pessoais','transporte_pessoal','outras_pessoais'] as const;
export const COST_CATEGORIES=[...BUSINESS_CATEGORIES,...PERSONAL_CATEGORIES] as const;
export type CostCategory=typeof COST_CATEGORIES[number];
export const CATEGORY_LABEL:Record<CostCategory,string>={publicidade_marketing:'Marketing e tráfego pago',softwares_assinaturas:'Ferramentas e softwares',inteligencia_artificial:'Ferramentas · inteligência artificial',
 hospedagem_infraestrutura:'Ferramentas · hospedagem e infraestrutura',aluguel_comercial:'Aluguel comercial',fornecedores:'Fornecedores',equipe:'Equipe',impostos:'Impostos',despesas_administrativas:'Despesas administrativas',outras_despesas:'Outras despesas operacionais',
 alimentacao:'Alimentação',moradia:'Moradia',contas_domesticas:'Contas domésticas',compras_pessoais:'Compras pessoais',transporte_pessoal:'Transporte pessoal',outras_pessoais:'Outras despesas particulares'};
export type Sphere='empresarial'|'pessoal'|'investimento'|'outras';
export const SPHERE_LABEL:Record<Sphere,string>={empresarial:'Empresarial',pessoal:'Pessoal',investimento:'Investimentos',outras:'Outras movimentações'};
export function sphereOf(kind:BankKind):Sphere{
 if(kind==='receita_operacional'||kind==='despesa_operacional')return 'empresarial';
 if(kind==='despesa_pessoal'||kind==='entrada_pessoal')return 'pessoal';
 if(kind==='aplicacao'||kind==='resgate'||kind==='rendimento')return 'investimento';
 return 'outras';
}
// Categoria só é válida para despesas, e precisa pertencer à esfera certa.
export function categoryAllowed(kind:BankKind,category:CostCategory|null):boolean{
 if(category===null)return true;
 if(kind==='despesa_operacional')return (BUSINESS_CATEGORIES as readonly string[]).includes(category);
 if(kind==='despesa_pessoal')return (PERSONAL_CATEGORIES as readonly string[]).includes(category);
 return false;
}

export type ClassSource='manual'|'regra'|'historico'|'tipo_polp'|'categoria_polp'|'fornecedor'|'descricao'|'padrao';
export type Confidence='alta'|'media'|'baixa';
// hint: sugestão ambígua (ex.: energia, aluguel) que exige decisão empresarial/pessoal — nunca confirmada automaticamente.
// confidence: força da sugestão da Pipeflow IA ('alta' pode ser pré-selecionada na revisão, mas nunca confirmada sozinha).
export type Classification={kind:BankKind;category:CostCategory|null;vendor:string|null;source:ClassSource;hint?:string|null;confidence?:Confidence|null};
export type ClassifiableRow={direction:'CREDITO'|'DEBITO'|null;type:string|null;categoryRef:string|null;description:string|null;counterparty:string|null};
export type ClassificationOverride={kind:BankKind;category:CostCategory|null;vendor:string|null};
export type ClassificationRule={field:'description'|'counterparty';pattern:string;direction:'CREDITO'|'DEBITO'|null;kind:BankKind;category:CostCategory|null;vendor:string|null};

// Normalização para comparação: minúsculas, sem acentos, espaços simples.
export function normalizeText(value:string|null|undefined):string{
 return (value??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
}
// Fornecedores reconhecidos apenas por nome explícito (sem adivinhação). Google genérico não é classificado.
const VENDORS:{vendor:string;category:CostCategory;re:RegExp}[]=[
 {vendor:'Meta Ads',category:'publicidade_marketing',re:/\b(facebook|facebk|meta ads|meta platforms|fb ads|instagram ads)\b/},
 {vendor:'Google Ads',category:'publicidade_marketing',re:/\b(google ads|google \*ads|adwords)\b/},
 {vendor:'Lovable',category:'inteligencia_artificial',re:/\blovable\b/},
 {vendor:'Claude (Anthropic)',category:'inteligencia_artificial',re:/\banthropic\b|\bclaude\.ai\b/},
 {vendor:'OpenAI',category:'inteligencia_artificial',re:/\b(openai|chatgpt)\b/},
 {vendor:'ElevenLabs',category:'inteligencia_artificial',re:/\belevenlabs\b|\beleven labs\b/},
 {vendor:'Hostinger',category:'hospedagem_infraestrutura',re:/\bhostinger\b/},
 {vendor:'Canva',category:'softwares_assinaturas',re:/\bcanva\b/},
];
// Sugestões pessoais por nome explícito (sempre pendentes até a confirmação).
const PERSONAL_VENDORS:{vendor:string;category:CostCategory;re:RegExp}[]=[
 {vendor:'iFood',category:'alimentacao',re:/\bifood\b/},
 {vendor:'Rappi',category:'alimentacao',re:/\brappi\b/},
 {vendor:'Uber Eats',category:'alimentacao',re:/\buber ?eats\b/},
];
// Casos que exigem decisão empresarial/pessoal: nunca classificados automaticamente.
const AMBIGUOUS:{vendor:string|null;hint:string;re:RegExp}[]=[
 {vendor:'CELESC',hint:'Energia elétrica (CELESC): confirme se é da empresa ou pessoal',re:/\bcelesc\b/},
 {vendor:null,hint:'Aluguel: confirme se é comercial ou residencial',re:/\baluguel\b|\blocacao\b/},
 {vendor:null,hint:'Energia elétrica: confirme se é da empresa ou pessoal',re:/\benergia eletrica\b|\bcopel\b|\bcemig\b|\benel\b|\bcpfl\b/},
];
export function knownVendor(text:string):{vendor:string;category:CostCategory}|null{
 for(const v of VENDORS)if(v.re.test(text))return {vendor:v.vendor,category:v.category};
 return null;
}

// ---- Aprendizado com classificações confirmadas (Pipeflow IA) ----
// O histórico de confirmações do usuário reconhece pagadores/fornecedores recorrentes pelo favorecido
// normalizado. Sugestões aprendidas ficam sempre pendentes de confirmação; registros aprovados nunca mudam.
export type HistoryEntry={kind:BankKind;category:CostCategory|null;vendor:string|null;direction:'CREDITO'|'DEBITO'|null};
export function learnFromHistory(counterparty:string|null,direction:'CREDITO'|'DEBITO'|null,entries:HistoryEntry[]|undefined):Classification|null{
 const key=normalizeText(counterparty);
 if(key.length<3||!entries?.length)return null;
 const same=entries.filter(e=>!e.direction||e.direction===direction);
 if(!same.length)return null;
 const first=same[0];
 if(!same.every(e=>e.kind===first.kind&&e.category===first.category))return null; // histórico divergente: não sugere
 if(!categoryAllowed(first.kind,first.category))return null;
 return {kind:first.kind,category:first.category,vendor:first.vendor,source:'historico',confidence:same.length>=2?'alta':'media'};
}
// Repasses da HyperCash para a conta bancária são liquidação da plataforma: a receita já foi registrada
// na confirmação da cobrança. Nunca contar como nova receita (regra anti-duplicidade de faturamento).
const HYPERCASH_PAYOUT=/\bhyper\s?cash\b/;
const INVEST_IN=new Set(['TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS','TRANSFER_IN_SAVINGS']);
const INVEST_OUT=new Set(['TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS','TRANSFER_OUT_SAVINGS']);
const OWN_TRANSFER=new Set(['TRANSFER_IN_ACCOUNT_TRANSFER','TRANSFER_OUT_ACCOUNT_TRANSFER']);
function fromProviderCategory(ref:string,direction:'CREDITO'|'DEBITO'):Classification|null{
 const c=(kind:BankKind,category:CostCategory|null=null):Classification=>({kind,category,vendor:null,source:'categoria_polp'});
 if(INVEST_OUT.has(ref))return c('aplicacao');
 if(INVEST_IN.has(ref))return c('resgate');
 if(ref==='INCOME_INTEREST_EARNED'||ref==='INCOME_DIVIDENDS')return c('rendimento');
 if(OWN_TRANSFER.has(ref))return c('transferencia_interna');
 if(ref.startsWith('LOAN_'))return c('emprestimo');
 if(direction==='CREDITO')return ref.startsWith('INCOME')?c('receita_operacional'):null;
 if(ref==='GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT')return c('despesa_operacional','impostos');
 if(ref.startsWith('BANK_FEES'))return c('despesa_operacional','despesas_administrativas');
 if(ref==='GENERAL_SERVICES_ACCOUNTING_AND_FINANCIAL_PLANNING'||ref==='GENERAL_SERVICES_CONSULTING_AND_LEGAL')return c('despesa_operacional','fornecedores');
 if(ref==='GENERAL_MERCHANDISE_OFFICE_SUPPLIES'||ref.startsWith('GOVERNMENT_AND_NON_PROFIT'))return c('despesa_operacional','despesas_administrativas');
 if(ref==='RENT_AND_UTILITIES_RENT')return {...c('nao_classificado'),hint:'Aluguel: confirme se é comercial ou residencial'};
 if(ref.startsWith('RENT_AND_UTILITIES'))return {...c('nao_classificado'),hint:'Conta de consumo (energia, água, internet, telefone): confirme se é da empresa ou pessoal'};
 if(ref.startsWith('FOOD_AND_DRINK'))return c('despesa_pessoal','alimentacao');
 if(ref.startsWith('HOME_IMPROVEMENT'))return c('despesa_pessoal','moradia');
 if(ref.startsWith('GENERAL_MERCHANDISE'))return c('despesa_pessoal','compras_pessoais');
 if(ref.startsWith('TRANSPORTATION'))return c('despesa_pessoal','transporte_pessoal');
 if(ref.startsWith('ENTERTAINMENT')||ref.startsWith('PERSONAL_CARE')||ref.startsWith('MEDICAL')||ref.startsWith('TRAVEL'))return c('despesa_pessoal','outras_pessoais');
 if(ref==='OTHER'||ref==='OTHER_OTHER'||ref.startsWith('TRANSFER_'))return null;
 return c('despesa_operacional','outras_despesas');
}
export function classify(row:ClassifiableRow,rules:ClassificationRule[]=[],override:ClassificationOverride|null=null,history?:Map<string,HistoryEntry[]>):Classification{
 if(override)return {...override,category:categoryAllowed(override.kind,override.category)?override.category:null,source:'manual'};
 const desc=normalizeText(row.description),party=normalizeText(row.counterparty);
 for(const r of rules){
  const hay=r.field==='description'?desc:party;const pat=normalizeText(r.pattern);
  if(pat.length>=3&&hay.includes(pat)&&(!r.direction||r.direction===row.direction))return {kind:r.kind,category:categoryAllowed(r.kind,r.category)?r.category:null,vendor:r.vendor,source:'regra'};
 }
 // Repasse HyperCash (entrada): liquidação de receita já registrada — nunca nova receita.
 if(row.direction==='CREDITO'&&(HYPERCASH_PAYOUT.test(desc)||HYPERCASH_PAYOUT.test(party)))
  return {kind:'transferencia_interna',category:null,vendor:'HyperCash',source:'fornecedor',hint:'Repasse da HyperCash: a receita já foi registrada na confirmação da cobrança; confirme como liquidação para não duplicar o faturamento'};
 // Aprendizado: reconhece pagadores/fornecedores recorrentes a partir das confirmações anteriores.
 const learned=learnFromHistory(row.counterparty,row.direction,history?.get(party));
 if(learned)return learned;
 if(!row.direction)return {kind:'nao_classificado',category:null,vendor:null,source:'padrao'};
 const t=row.type??'';
 if(t==='APLICACAO_FINANCEIRA')return {kind:'aplicacao',category:null,vendor:null,source:'tipo_polp'};
 // O banco usa o mesmo tipo para os dois sentidos: saída ("Aplicação RDB") é aplicação; entrada é resgate.
 if(t==='RESGATE_APLIC_FINANCEIRA')return {kind:row.direction==='DEBITO'?'aplicacao':'resgate',category:null,vendor:null,source:'tipo_polp'};
 if(t==='RENDIMENTO_APLIC_FINANCEIRA')return {kind:'rendimento',category:null,vendor:null,source:'tipo_polp'};
 // Saldo reservado (caixinhas Nubank, aplicadas em RDB): guardar = aplicação; retirar = resgate.
 if(t==='TRANSFERENCIA_SALDO_RESERVADO')return {kind:row.direction==='DEBITO'?'aplicacao':'resgate',category:null,vendor:null,source:'tipo_polp'};
 if(t==='OPERACAO_CREDITO')return {kind:'emprestimo',category:null,vendor:null,source:'tipo_polp'};
 if(row.direction==='DEBITO'&&(t==='PACOTE_TARIFA_SERVICOS'||t==='TARIFA_SERVICOS_AVULSOS'||t==='ENCARGOS_JUROS_CHEQUE_ESPECIAL'))return {kind:'despesa_operacional',category:'despesas_administrativas',vendor:null,source:'tipo_polp'};
 if(row.direction==='DEBITO'&&t==='FOLHA_PAGAMENTO')return {kind:'despesa_operacional',category:'equipe',vendor:null,source:'tipo_polp'};
 const vendor=row.direction==='DEBITO'?knownVendor(`${desc} ${party}`):null;
 if(vendor)return {kind:'despesa_operacional',category:vendor.category,vendor:vendor.vendor,source:'fornecedor'};
 if(row.direction==='DEBITO'){
  const text=`${desc} ${party}`;
  const personal=PERSONAL_VENDORS.find(v=>v.re.test(text));
  if(personal)return {kind:'despesa_pessoal',category:personal.category,vendor:personal.vendor,source:'fornecedor'};
  const ambiguous=AMBIGUOUS.find(v=>v.re.test(text));
  if(ambiguous)return {kind:'nao_classificado',category:null,vendor:ambiguous.vendor,source:'descricao',hint:ambiguous.hint};
 }
 if(row.categoryRef){const c=fromProviderCategory(row.categoryRef,row.direction);if(c)return c;}
 if(/\brdb\b|\bcdb\b|aplicacao|dinheiro guardado|guardado na caixinha/.test(desc))return {kind:row.direction==='DEBITO'?'aplicacao':'resgate',category:null,vendor:null,source:'descricao'};
 if(/resgate|dinheiro resgatado|resgatado da caixinha/.test(desc))return {kind:'resgate',category:null,vendor:null,source:'descricao'};
 if(/rendimento/.test(desc)&&row.direction==='CREDITO')return {kind:'rendimento',category:null,vendor:null,source:'descricao'};
 // Entrada sem indicação contrária é receita operacional a conciliar (não é faturamento confirmado).
 if(row.direction==='CREDITO')return {kind:'receita_operacional',category:null,vendor:null,source:'padrao'};
 return {kind:'nao_classificado',category:null,vendor:null,source:'padrao'};
}

// ---- Agregação para as caixas ----
export type AggRow={amountCents:number|null;currency:string;direction:'CREDITO'|'DEBITO'|null;transactionAt:string|null;cls:Classification};
export type BankTotals={bankInCents:number;bankOutCents:number;cashChangeCents:number;operatingIncomeCents:number;operatingExpenseCents:number;operatingResultCents:number;
 investedCents:number;redeemedCents:number;netInvestedCents:number;yieldCents:number;internalTransfersCents:number;loansInCents:number;loansOutCents:number;
 unclassifiedOutCents:number;unclassifiedInCents:number;unclassifiedCount:number;personalOutCents:number;personalInCents:number;excluded:number;counted:number};
const valid=(r:AggRow)=>r.amountCents!==null&&Number.isSafeInteger(r.amountCents)&&r.direction!==null&&r.currency==='BRL';
export function bankTotals(rows:AggRow[]):BankTotals{
 const t:BankTotals={bankInCents:0,bankOutCents:0,cashChangeCents:0,operatingIncomeCents:0,operatingExpenseCents:0,operatingResultCents:0,investedCents:0,redeemedCents:0,netInvestedCents:0,
  yieldCents:0,internalTransfersCents:0,loansInCents:0,loansOutCents:0,unclassifiedOutCents:0,unclassifiedInCents:0,unclassifiedCount:0,personalOutCents:0,personalInCents:0,excluded:0,counted:0};
 for(const r of rows){
  if(!valid(r)){t.excluded++;continue;}
  const v=Math.abs(r.amountCents as number),credit=r.direction==='CREDITO';t.counted++;
  if(credit)t.bankInCents+=v;else t.bankOutCents+=v;
  switch(r.cls.kind){
   case 'receita_operacional':if(credit)t.operatingIncomeCents+=v;else t.operatingIncomeCents-=v;break; // estorno de receita reduz
   case 'despesa_operacional':if(credit)t.operatingExpenseCents-=v;else t.operatingExpenseCents+=v;break; // reembolso reduz
   case 'aplicacao':if(credit)t.redeemedCents+=v;else t.investedCents+=v;break;
   case 'resgate':if(credit)t.redeemedCents+=v;else t.investedCents+=v;break;
   case 'rendimento':t.yieldCents+=credit?v:-v;break;
   case 'transferencia_interna':t.internalTransfersCents+=v;break;
   case 'emprestimo':if(credit)t.loansInCents+=v;else t.loansOutCents+=v;break;
   case 'despesa_pessoal':case 'entrada_pessoal':if(credit)t.personalInCents+=v;else t.personalOutCents+=v;break;
   default:t.unclassifiedCount++;if(credit)t.unclassifiedInCents+=v;else t.unclassifiedOutCents+=v;
  }
 }
 t.cashChangeCents=t.bankInCents-t.bankOutCents;t.operatingResultCents=t.operatingIncomeCents-t.operatingExpenseCents;t.netInvestedCents=t.investedCents-t.redeemedCents;
 return t;
}
export function expensesByCategory(rows:AggRow[]):{category:CostCategory;label:string;cents:number;count:number}[]{
 const map=new Map<CostCategory,{cents:number;count:number}>();
 for(const r of rows){if(!valid(r)||r.cls.kind!=='despesa_operacional')continue;const c=r.cls.category??'outras_despesas';const v=Math.abs(r.amountCents as number)*(r.direction==='DEBITO'?1:-1);
  const cur=map.get(c)??{cents:0,count:0};cur.cents+=v;cur.count++;map.set(c,cur);}
 return [...map].map(([category,v])=>({category,label:CATEGORY_LABEL[category],...v})).sort((a,b)=>b.cents-a.cents);
}
export function topVendors(rows:AggRow[],limit=10):{vendor:string;cents:number;count:number}[]{
 const map=new Map<string,{cents:number;count:number}>();
 for(const r of rows){if(!valid(r)||r.cls.kind!=='despesa_operacional'||!r.cls.vendor)continue;const v=Math.abs(r.amountCents as number)*(r.direction==='DEBITO'?1:-1);
  const cur=map.get(r.cls.vendor)??{cents:0,count:0};cur.cents+=v;cur.count++;map.set(r.cls.vendor,cur);}
 return [...map].map(([vendor,v])=>({vendor,...v})).sort((a,b)=>b.cents-a.cents).slice(0,limit);
}
// Visão mensal (janeiro a dezembro do ano): meses sem nenhuma movimentação ficam sem dados (null), nunca zero.
export function monthlyBreakdown(rows:AggRow[],year:number):{month:string;totals:BankTotals|null}[]{
 const byMonth=new Map<string,AggRow[]>();
 for(const r of rows){if(!r.transactionAt)continue;const d=new Date(Date.parse(r.transactionAt)-3*60*60*1000);if(d.getUTCFullYear()!==year)continue;
  const key=`${year}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;byMonth.set(key,[...(byMonth.get(key)??[]),r]);}
 return Array.from({length:12},(_,i)=>{const key=`${year}-${String(i+1).padStart(2,'0')}`;const list=byMonth.get(key);return {month:key,totals:list?bankTotals(list):null};});
}

// ---- Revisão financeira: status e painel com valores confirmados ----
export type ReviewStatus='confirmado'|'pendente'|'corrigido';
export const STATUS_LABEL:Record<ReviewStatus,string>={confirmado:'Confirmado',pendente:'Pendente de revisão',corrigido:'Corrigido manualmente'};
const BANK_DECLARED=new Set<BankKind>(['aplicacao','resgate','rendimento','emprestimo']);
// Confirmado: aprovado manualmente, regra confirmada pelo administrador, recebimento conciliado ou tipo declarado pelo banco
// para investimentos/empréstimos. Sugestões por fornecedor, categoria da Polp, descrição ou padrão ficam pendentes.
export function reviewStatus(cls:Classification,override:{decision:'aprovado'|'corrigido'}|null,reconciled:boolean):ReviewStatus{
 if(override)return override.decision==='aprovado'?'confirmado':'corrigido';
 if(cls.hint)return 'pendente';
 if(reconciled&&cls.kind==='receita_operacional')return 'confirmado';
 if(cls.source==='regra')return 'confirmado';
 if(cls.source==='tipo_polp'&&BANK_DECLARED.has(cls.kind))return 'confirmado';
 return 'pendente';
}
export type DashRow=AggRow&{status:ReviewStatus};
const isConfirmed=(st:ReviewStatus)=>st!=='pendente';
export type DashboardTotals={revenueCents:number;operatingExpenseCents:number;trafficCents:number;operatingResultCents:number;
 pendingOutCents:number;pendingOutCount:number;pendingInCents:number;pendingInCount:number;personalConfirmedCents:number;confirmedCount:number;pendingCount:number};
// revenueCents vem da fonte oficial do faturamento confirmado (universe_confirmed_sources), não das entradas bancárias.
export function dashboardTotals(rows:DashRow[],revenueCents:number):DashboardTotals{
 const t:DashboardTotals={revenueCents,operatingExpenseCents:0,trafficCents:0,operatingResultCents:0,pendingOutCents:0,pendingOutCount:0,pendingInCents:0,pendingInCount:0,personalConfirmedCents:0,confirmedCount:0,pendingCount:0};
 for(const r of rows){
  if(!valid(r))continue;
  const v=Math.abs(r.amountCents as number),debit=r.direction==='DEBITO';
  if(!isConfirmed(r.status)){t.pendingCount++;if(debit){t.pendingOutCents+=v;t.pendingOutCount++;}else{t.pendingInCents+=v;t.pendingInCount++;}continue;}
  t.confirmedCount++;
  if(r.cls.kind==='despesa_operacional'){const signed=debit?v:-v;t.operatingExpenseCents+=signed;if(r.cls.category==='publicidade_marketing')t.trafficCents+=signed;}
  else if(r.cls.kind==='despesa_pessoal'&&debit)t.personalConfirmedCents+=v;
 }
 t.operatingResultCents=t.revenueCents-t.operatingExpenseCents;
 return t;
}
// Série mensal (jan–dez) para os gráficos. Mês sem nenhum dado (nem banco nem faturamento) fica null, nunca zero.
export function monthlySeries(rows:DashRow[],revenueByMonth:Map<string,number>,year:number):{month:string;revenue:number|null;expenses:number|null;result:number|null;traffic:number|null}[]{
 const exp=new Map<string,{e:number;t:number}>();const seen=new Set<string>();
 for(const r of rows){
  if(!r.transactionAt)continue;const d=new Date(Date.parse(r.transactionAt)-3*60*60*1000);if(d.getUTCFullYear()!==year)continue;
  const key=`${year}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;seen.add(key);
  if(!valid(r)||!isConfirmed(r.status)||r.cls.kind!=='despesa_operacional')continue;
  const v=Math.abs(r.amountCents as number)*(r.direction==='DEBITO'?1:-1);const cur=exp.get(key)??{e:0,t:0};cur.e+=v;if(r.cls.category==='publicidade_marketing')cur.t+=v;exp.set(key,cur);
 }
 return Array.from({length:12},(_,i)=>{const key=`${year}-${String(i+1).padStart(2,'0')}`;const has=seen.has(key)||revenueByMonth.has(key);
  if(!has)return {month:key,revenue:null,expenses:null,result:null,traffic:null};
  const revenue=revenueByMonth.get(key)??0,e=exp.get(key)??{e:0,t:0};return {month:key,revenue,expenses:e.e,result:revenue-e.e,traffic:e.t};});
}
