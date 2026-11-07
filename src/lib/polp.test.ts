import {test} from 'node:test';
import assert from 'node:assert/strict';
import {testPolpCatalog,createPolpConsent,getPolpConsent,recreatePolpConsent,listPolpAccounts,listPolpAccountTransactions,findNubankInstitution,listPolpConsents,polpErrorSummary} from './polp-api.server';
import {nubankBusinessStatus,validCpf,validCnpj,onlyDigits,consentStatusLabel,authLinkState,usableAuthUrl,canRecreateConsent,consentGuidance,selectExistingConsent,polpConsentErrorDetail,AUTH_URL_SAFETY_MARGIN_MS,type PolpInstitution,type PolpConsentView} from './polp';
import {polpCreateErrorMessage,polpRecreateErrorMessage,consentOutcome,readWarnings} from './polp.functions';
import {polpDocumentBinding,selectBoundConsent,createdConsentMatches,issueRenewalProof,verifyRenewalProof,renewConsentLink,consentMatchesBinding,type RenewDeps,type RenewalLease} from './polp-renewal.server';
import {moneyToCents,summarizeTransactions,type PolpConsent,type PolpTransaction} from './polp';
const nubank:PolpInstitution={id:'fixture-bank',name:'Nubank',type:'BOTH',status:'OPERATIONAL',credentials:['cpf','cnpj']};
const keys={clientId:'fixture-client',clientSecret:'fixture-secret'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
test('etapa inicial faz apenas GET catálogo, nunca consentimento, sincronização ou pagamentos',async()=>{
 let calls=0;const transport:typeof fetch=async(url,init)=>{calls++;assert.equal(url,'https://api.polp.com.br/api/v2/institutions');assert.equal(init?.method,'GET');assert.equal(init?.redirect,'manual');assert.equal(init?.body,undefined);assert.ok(init?.signal);return json({data:[nubank]});};
 const result=await testPolpCatalog(keys,transport);assert.equal(calls,1);assert.equal(result.status,'ok');assert.equal(result.nubankBusiness,'available');assert.equal(result.authentication,'not_verified');assert.deepEqual(Object.keys(result).sort(),['authentication','complete','credentialsConfigured','httpStatus','institutions','nubankBusiness','status'].sort());
});
test('ausência de chaves bloqueia chamadas',async()=>{let called=false;const r=await testPolpCatalog({},async()=>{called=true;return json({});});assert.equal(called,false);assert.equal(r.status,'missing_credentials');});
test('Nubank pessoal ou sem CNPJ não comprova suporte PJ',()=>{assert.equal(nubankBusinessStatus([{...nubank,type:'PERSONAL',credentials:['cpf']}],true),'not_found');assert.equal(nubankBusinessStatus([{...nubank,credentials:['cpf']}],true),'not_found');});
test('Nubank indisponível não é mostrado como operacional',()=>assert.equal(nubankBusinessStatus([{...nubank,status:'MAJOR_OUTAGE'}],true),'unavailable'));
test('paginação parcial não segue URLs e não afirma ausência de Nubank',async()=>{let calls=0;const r=await testPolpCatalog(keys,async()=>{calls++;return json({data:[],links:{next:'https://other.example/steal'}});});assert.equal(calls,1);assert.equal(r.complete,false);assert.equal(r.nubankBusiness,'unknown');});
test('401 e 403 não expõem resposta do provedor',async()=>{for(const status of [401,403]){const r=await testPolpCatalog(keys,async()=>json({message:'PRIVATE_PROVIDER_DETAIL'},status));assert.equal(r.authentication,'rejected');assert.equal(r.httpStatus,status);assert.equal(JSON.stringify(r).includes('PRIVATE_PROVIDER_DETAIL'),false);}});
test('redirecionamento e 429 não geram retries',async()=>{for(const status of [302,429,500]){let calls=0;const r=await testPolpCatalog(keys,async()=>{calls++;return new Response('',{status});});assert.equal(calls,1);assert.equal(r.status,'http_error');}});
test('respostas inválidas e excessivas falham fechadas',async()=>{for(const response of [json({data:[{...nubank,type:'UNKNOWN'}]}),json({data:Array.from({length:1001},()=>nubank)}),json({unexpected:'data'}),new Response('x'.repeat(1024*1024+1),{headers:{'content-type':'application/json'}})]){const r=await testPolpCatalog(keys,async()=>response);assert.equal(r.status,'invalid_response');assert.equal(r.institutions.length,0);}});
test('falha de transporte não vaza credenciais nem detalhes',async()=>{const r=await testPolpCatalog(keys,async()=>{throw new Error('PRIVATE_DETAIL');});assert.equal(r.status,'unavailable');assert.equal(JSON.stringify(r).includes('PRIVATE_DETAIL'),false);});
const consentFixture={id:'consent-1',institution_id:'fixture-bank',status:'AWAITING_AUTHORIZATION',execution_status:null,products:['ACCOUNT'],url_to_authenticate:'https://auth.example/abc',url_to_authenticate_expires_at:null};
test('validação de CPF/CNPJ e normalização de dígitos',()=>{
 assert.equal(validCpf('12345678901'),true);assert.equal(validCpf('1234567890'),false);assert.equal(validCpf('123456789012'),false);assert.equal(validCpf('1234567890a'),false);
 assert.equal(validCnpj('12345678000199'),true);assert.equal(validCnpj('1234567800019'),false);
 assert.equal(onlyDigits('12.345.678/0001-99'),'12345678000199');assert.equal(onlyDigits('(11) 91234-5678'),'11912345678');
});
test('rótulos de status do consentimento',()=>{
 assert.equal(consentStatusLabel('AWAITING_AUTHORIZATION'),'Aguardando autorização');
 assert.equal(consentStatusLabel('AUTHORISED'),'Conta conectada');
 assert.equal(consentStatusLabel('REJECTED'),'Autorização recusada');
 assert.equal(consentStatusLabel('EXPIRED'),'Consentimento expirado');
});
test('criação de consentimento envia somente leitura ACCOUNT com deduplicação e sem persistir documentos',async()=>{
 let calls=0;const transport:typeof fetch=async(url,init)=>{calls++;
  assert.equal(url,'https://api.polp.com.br/api/v2/consents');assert.equal(init?.method,'POST');assert.equal(init?.redirect,'manual');
  const body=JSON.parse(String(init?.body));
  assert.deepEqual(body.products,['ACCOUNT']);assert.equal(body.avoidDuplicates,true);assert.equal(body.institution_id,'fixture-bank');
  assert.equal(body.cpf,'12345678901');assert.equal(body.cnpj,'12345678000199');assert.equal(body.cliente_user_id,'pipeflow:v1:fixture-binding');
  assert.deepEqual(Object.keys(body).sort(),['avoidDuplicates','cliente_user_id','cnpj','cpf','institution_id','products'].sort());
  return json(consentFixture,201);};
 const r=await createPolpConsent(keys,{institutionId:'fixture-bank',cpf:'12345678901',cnpj:'12345678000199',clienteUserId:'pipeflow:v1:fixture-binding'},transport);
 assert.equal(calls,1);assert.equal(r.ok,true);if(r.ok){assert.equal(r.data.id,'consent-1');assert.equal(r.data.status,'AWAITING_AUTHORIZATION');}
});
test('criação sem credenciais não chama a API',async()=>{let called=false;const r=await createPolpConsent({},{institutionId:'x',cpf:'12345678901',cnpj:'12345678000199',clienteUserId:'pipeflow:v1:fixture-binding'},async()=>{called=true;return json({});});assert.equal(called,false);assert.equal(r.ok,false);if(!r.ok)assert.equal(r.reason,'missing_credentials');});
test('402 e 403 na criação falham fechados sem expor corpo do provedor',async()=>{
 for(const status of [402,403,422,500]){const r=await createPolpConsent(keys,{institutionId:'x',cpf:'12345678901',cnpj:'12345678000199',clienteUserId:'pipeflow:v1:fixture-binding'},async()=>json({message:'PRIVATE'},status));assert.equal(r.ok,false);if(!r.ok){assert.equal(r.reason,'http_error');assert.equal(r.httpStatus,status);}assert.equal(JSON.stringify(r).includes('PRIVATE'),false);}
});
test('consulta de status usa GET no consentimento exato',async()=>{
 const transport:typeof fetch=async(url,init)=>{assert.equal(url,'https://api.polp.com.br/api/v2/consents/consent-1');assert.equal(init?.method,'GET');assert.equal(init?.body,undefined);return json({...consentFixture,status:'AUTHORISED',execution_status:'SUCCESS'});};
 const r=await getPolpConsent(keys,'consent-1',transport);assert.equal(r.ok,true);if(r.ok)assert.equal(r.data.status,'AUTHORISED');
});
// Fixtures no formato da documentação Polp v2 (dados fictícios).
const polpAccount={id:'acc-1',consent_id:'consent-1',number:'12345',branch_code:'0001',check_digit:'6',type:'CONTA_DEPOSITO_A_VISTA',compe_code:'260',subtype:'INDIVIDUAL',currency:'BRL',identification:{},balance:{update_date_time:'2026-11-02T12:00:00Z',has_reserved_balance:false,available_amount:{amount:'1500.00',currency:'BRL'},blocked_amount:{amount:'0.00',currency:'BRL'},automatically_invested_amount:{amount:'200.00',currency:'BRL'},updated_at:'2026-11-02T12:00:00Z'},overdraft_limit:null,created_at:'2026-11-01T00:00:00Z',updated_at:'2026-11-02T12:00:00Z'};
const polpTx=(over:Record<string,unknown>={})=>({id:'tx-1',account_id:'acc-1',transaction_name:'Pix recebido',transaction_date_time:'2026-10-15T10:00:00Z',type:'PIX',credit_debit_type:'CREDITO',transaction_amount:{amount:'250.00',currency:'BRL'},type_additional_info:null,partie_cnpj_cpf:null,partie_person_type:null,counterparty:{name:'Cliente X',alias:null,tax_id:null},category_ref:null,created_at:'2026-10-15T10:01:00Z',updated_at:'2026-10-15T10:01:00Z',...over});
test('contas: saldo lido de balance.available_amount/blocked/automatically_invested (formato Polp v2)',async()=>{
 const transport:typeof fetch=async(url)=>{assert.equal(url,'https://api.polp.com.br/api/v2/consents/consent-1/accounts');return json({data:[polpAccount],meta:{next_cursor:null}});};
 const r=await listPolpAccounts(keys,'consent-1',transport);assert.equal(r.ok,true);
 if(r.ok){assert.equal(r.data.items.length,1);assert.equal(r.data.complete,true);const b=r.data.items[0].balance;assert.equal(b?.available_amount?.amount,'1500.00');assert.equal(b?.automatically_invested_amount?.amount,'200.00');assert.equal(b?.update_date_time,'2026-11-02T12:00:00Z');}
 const nob=await listPolpAccounts(keys,'consent-1',async()=>json({data:[{...polpAccount,balance:null}]}));assert.equal(nob.ok&&nob.data.items[0].balance,null);
});
test('transações: CREDITO/DEBITO aceitos, janela de 92 dias e filtros fromDate/toDate',async()=>{
 const from=new Date('2026-10-01T00:00:00Z').toISOString(),to=new Date('2026-11-01T00:00:00Z').toISOString();
 let calls=0;const transport:typeof fetch=async(url,init)=>{calls++;const u=new URL(String(url));assert.equal(u.pathname,'/api/v2/accounts/acc-1/transactions');assert.equal(u.searchParams.get('fromDate'),from);assert.equal(u.searchParams.get('toDate'),to);assert.equal(init?.method,'GET');return json({data:[polpTx(),polpTx({id:'tx-2',credit_debit_type:'DEBITO',transaction_amount:{amount:'99.90',currency:'BRL'}})],meta:{next_cursor:null}});};
 const r=await listPolpAccountTransactions(keys,'acc-1',{fromDate:from,toDate:to},transport);
 assert.equal(calls,1);assert.equal(r.ok,true);if(r.ok){assert.deepEqual(r.data.items.map(t=>t.credit_debit_type),['CREDITO','DEBITO']);assert.equal(r.data.items[0].type,'PIX');assert.equal(r.data.skipped,0);}
 const wide=await listPolpAccountTransactions(keys,'acc-1',{fromDate:new Date('2026-01-01').toISOString(),toDate:new Date('2026-11-01').toISOString()},transport);
 assert.equal(wide.ok,false);assert.equal(calls,1);
});
test('transação inválida é ignorada e contada, sem derrubar a página; sentido desconhecido vira null',async()=>{
 const r=await listPolpAccountTransactions(keys,'acc-1',{fromDate:'2026-10-01T00:00:00Z',toDate:'2026-10-31T00:00:00Z'},async()=>json({data:[polpTx(),{sem:'id'},polpTx({id:'tx-3',credit_debit_type:'OUTRO'})]}));
 assert.equal(r.ok,true);if(r.ok){assert.equal(r.data.items.length,2);assert.equal(r.data.skipped,1);assert.equal(r.data.items[1].credit_debit_type,null);}
});
test('paginação segue next_cursor de forma limitada e sinaliza resultado parcial',async()=>{
 const urls:string[]=[];
 const r=await listPolpAccountTransactions(keys,'acc-1',{fromDate:'2026-10-01T00:00:00Z',toDate:'2026-10-31T00:00:00Z'},async url=>{urls.push(String(url));return json({data:[polpTx({id:`tx-p${urls.length}`})],meta:{next_cursor:urls.length<2?'c1':null}});});
 assert.equal(r.ok&&r.data.items.length,2);assert.equal(r.ok&&r.data.complete,true);assert.equal(new URL(urls[1]).searchParams.get('cursor'),'c1');assert.ok(urls[1].includes('fromDate='));
 let calls=0;const capped=await listPolpAccountTransactions(keys,'acc-1',{fromDate:'2026-10-01T00:00:00Z',toDate:'2026-10-31T00:00:00Z'},async()=>{calls++;return json({data:[],meta:{next_cursor:`c${calls}`}});});
 assert.equal(calls,10);assert.equal(capped.ok&&capped.data.complete,false);
 let accCalls=0;const accCapped=await listPolpAccounts(keys,'consent-1',async()=>{accCalls++;return json({data:[],meta:{next_cursor:`a${accCalls}`}});});
 assert.equal(accCalls,5);assert.equal(accCapped.ok&&accCapped.data.complete,false);
});
test('falhas de leitura de contas/transações são reportadas, sem expor corpo do provedor',async()=>{
 for(const status of [401,404,500]){const r=await listPolpAccounts(keys,'consent-1',async()=>json({message:'PRIVATE'},status));assert.equal(r.ok,false);if(!r.ok){assert.equal(r.reason,'http_error');assert.equal(r.httpStatus,status);}assert.equal(JSON.stringify(r).includes('PRIVATE'),false);}
 const t=await listPolpAccountTransactions(keys,'acc-1',{fromDate:'2026-10-01T00:00:00Z',toDate:'2026-10-31T00:00:00Z'},async()=>{const e=new Error('x');e.name='TimeoutError';throw e;});assert.equal(!t.ok&&t.reason,'timeout');
 const w=readWarnings({accountsComplete:true,accountsSkipped:0,accountsOmitted:0,failedAccounts:[{reason:'http_error',httpStatus:500}],transactionsIncomplete:1,transactionsSkipped:2,excludedInvalidAmount:1,excludedNonBrl:0,excludedNoDirection:0});
 assert.equal(w.length,4);assert.match(w[0],/HTTP 500/);assert.match(w.join(' '),/incompletos/);
 assert.deepEqual(readWarnings({accountsComplete:true,accountsSkipped:0,accountsOmitted:0,failedAccounts:[],transactionsIncomplete:0,transactionsSkipped:0,excludedInvalidAmount:0,excludedNonBrl:0,excludedNoDirection:0}),[]);
});
test('valores: 2 a 4 casas (Open Finance), número, sinal; formatos ambíguos rejeitados',()=>{
 const v=(amount:string)=>moneyToCents({amount,currency:'BRL'});
 assert.equal(v('1500.00'),150000);assert.equal(v('250.0000'),25000);assert.equal(v('99.9000'),9990);assert.equal(v('0.1'),10);assert.equal(v('1500'),150000);
 assert.equal(v('1.234'),123);assert.equal(v('1.235'),124);assert.equal(v('0.0049'),0);assert.equal(v('-5.25'),-525);assert.equal(v('+7.10'),710);assert.equal(v(' 12.5000 '),1250);
 for(const bad of ['1,50','1.234,56','abc','','1e3','12.','.5','1.1234567','R$ 10,00'])assert.equal(v(bad),null,bad);
 assert.equal(moneyToCents(null),null);
});
test('schema de valor: número vira string, moeda vazia/ausente/minúscula vira BRL',async()=>{
 const r=await listPolpAccountTransactions(keys,'acc-1',{fromDate:'2026-10-01T00:00:00Z',toDate:'2026-10-31T00:00:00Z'},async()=>json({data:[
  polpTx({id:'a',transaction_amount:{amount:'10.0000',currency:''}}),polpTx({id:'b',transaction_amount:{amount:20.5,currency:'brl'}}),polpTx({id:'c',transaction_amount:{amount:'5.00'}}),polpTx({id:'d',transaction_amount:{amount:'1.00',currency:null}})]}));
 assert.equal(r.ok,true);if(r.ok){assert.deepEqual(r.data.items.map(t=>t.transaction_amount),[{amount:'10.0000',currency:'BRL'},{amount:'20.5',currency:'BRL'},{amount:'5.00',currency:'BRL'},{amount:'1.00',currency:'BRL'}]);
  const sum=summarizeTransactions(r.data.items);assert.equal(sum.counted,4);assert.equal(sum.incomeCents,3650);assert.equal(sum.excluded,0);}
});
test('totais exatos (sem erro de ponto flutuante) e exclusões contadas por motivo',()=>{
 const rows=[polpTx({transaction_amount:{amount:'0.1000',currency:'BRL'}}),polpTx({id:'b',transaction_amount:{amount:'0.2000',currency:'BRL'}}),polpTx({id:'c',credit_debit_type:'DEBITO',transaction_amount:{amount:'0.0500',currency:'BRL'}}),
  polpTx({id:'d',credit_debit_type:null}),polpTx({id:'e',transaction_amount:{amount:'10.00',currency:'USD'}}),polpTx({id:'f',transaction_amount:{amount:'x',currency:'BRL'}}),polpTx({id:'g',transaction_amount:null})] as PolpTransaction[];
 assert.deepEqual(summarizeTransactions(rows),{incomeCents:30,expenseCents:5,netCents:25,counted:3,excluded:4,excludedInvalidAmount:2,excludedNonBrl:1,excludedNoDirection:1});
 // Frações abaixo do centavo somam exatamente antes do arredondamento final.
 const tiny=Array.from({length:3},(_,i)=>polpTx({id:`t${i}`,transaction_amount:{amount:'0.0040',currency:'BRL'}})) as PolpTransaction[];
 assert.equal(summarizeTransactions(tiny).incomeCents,1);
 // Valor negativo com DEBITO conta como saída em módulo.
 assert.equal(summarizeTransactions([polpTx({credit_debit_type:'DEBITO',transaction_amount:{amount:'-30.0000',currency:'BRL'}})] as PolpTransaction[]).expenseCents,3000);
 assert.deepEqual(summarizeTransactions([]),{incomeCents:0,expenseCents:0,netCents:0,counted:0,excluded:0,excludedInvalidAmount:0,excludedNonBrl:0,excludedNoDirection:0});
 const big=Array.from({length:5000},(_,i)=>polpTx({id:`big${i}`,transaction_amount:{amount:'999999999.9999',currency:'BRL'}})) as PolpTransaction[];
 assert.equal(summarizeTransactions(big).incomeCents,499999999999950);
});
test('busca do Nubank exige instituição operacional com CPF e CNPJ',async()=>{
 const ok=await findNubankInstitution(keys,async()=>json({data:[nubank]}));assert.equal(ok.ok,true);if(ok.ok)assert.equal(ok.data.id,'fixture-bank');
 const off=await findNubankInstitution(keys,async()=>json({data:[{...nubank,status:'DEGRADED_PERFORMANCE'}]}));assert.equal(off.ok,false);
});

test('resposta envelopada em data é aceita e preserva o ID',async()=>{
 const body={data:{id:'01a19d8b-4d74-72e0-bb80-924d348db177',institution_id:'bank',status:'AWAITING_AUTHORIZATION',execution_status:null,products:['ACCOUNT'],url_to_authenticate:'https://auth.example/x',url_to_authenticate_expires_at:'2026-11-02T19:35:14.000000Z',status_label:'x',flags:[]}};
 const r=await createPolpConsent(keys,{institutionId:'bank',cpf:'12345678901',cnpj:'12345678000199',clienteUserId:'pipeflow:v1:fixture-binding'},async()=>json(body,201));
 assert.equal(r.ok,true);if(r.ok){assert.equal(r.data.id,'01a19d8b-4d74-72e0-bb80-924d348db177');assert.equal(r.data.status,'AWAITING_AUTHORIZATION');}
});
test('execution_status desconhecido não descarta consentimento criado',async()=>{
 const r=await getPolpConsent(keys,'consent-123',async()=>json({data:{id:'consent-123',institution_id:'b',status:'AUTHORISED',execution_status:'NOVO_VALOR'}}));
 assert.equal(r.ok,true);if(r.ok)assert.equal(r.data.execution_status,null);
});
test('lista de consentimentos existentes é lida',async()=>{
 const r=await listPolpConsents(keys,async()=>json({data:[{id:'consent-123',institution_id:'b',status:'AWAITING_AUTHORIZATION'}],links:{},meta:{}}));
 assert.equal(r.ok,true);if(r.ok)assert.equal(r.data[0]?.id,'consent-123');
});
test('resumo de erro mascara documentos e links',()=>{
 const s=polpErrorSummary({message:'CPF 123.456.789-01 inválido https://x.y/z a@b.com',errors:{cnpj:['x']}});
 assert.equal(JSON.stringify(s).includes('123.456'),false);assert.equal(JSON.stringify(s).includes('https'),false);assert.deepEqual(s.fields,['cnpj']);
});
test('mensagens distintas por causa',()=>{
 assert.match(polpCreateErrorMessage('http_error',422),/dados enviados/);
 assert.match(polpCreateErrorMessage('invalid_response',201),/pode ter sido criado/);
 assert.match(polpCreateErrorMessage('timeout',null),/a tempo/);
 assert.match(polpCreateErrorMessage('http_error',500),/temporária/);
});


// ---- Validade do link, renovação e reaproveitamento (respostas simuladas; nenhuma chamada real) ----
const NOW=Date.parse('2026-11-02T18:00:00Z');
const inMin=(m:number)=>new Date(NOW+m*60000).toISOString();
const awaiting=(expiresAt:string|null,url='https://auth.example/link')=>({id:'consent-123',institution_id:'bank',status:'AWAITING_AUTHORIZATION' as const,url_to_authenticate:url,url_to_authenticate_expires_at:expiresAt,status_label:null,error:null});
const view:PolpConsentView={id:'row-1',consentId:'consent-123',institutionName:'Nubank',status:'AWAITING_AUTHORIZATION',executionStatus:null,urlExpiresAt:null,lastCheckedAt:new Date(NOW).toISOString()};

test('link válido: dentro da validade (com margem) é exibido',()=>{
 assert.equal(authLinkState(inMin(45),NOW),'valid');
 assert.equal(usableAuthUrl(awaiting(inMin(45)),NOW),'https://auth.example/link');
 const out=consentOutcome(view,awaiting(inMin(45)),null,NOW);
 assert.equal(out.ok,true);if(out.ok){assert.equal(out.authUrl,'https://auth.example/link');assert.equal(out.authUrlExpiresAt,inMin(45));assert.equal(out.notice,null);}
});
test('link expirado, perto de expirar ou sem validade nunca é exibido',()=>{
 for(const exp of [inMin(-1),inMin(-120),new Date(NOW+AUTH_URL_SAFETY_MARGIN_MS-1000).toISOString()]){
  assert.equal(authLinkState(exp,NOW),'expired');assert.equal(usableAuthUrl(awaiting(exp),NOW),null);
 }
 for(const exp of [null,'','não-é-data']){assert.equal(authLinkState(exp,NOW),'unknown');assert.equal(usableAuthUrl(awaiting(exp),NOW),null);}
 const out=consentOutcome(view,awaiting(inMin(-5)),null,NOW);
 assert.equal(out.ok,true);if(out.ok){assert.equal(out.authUrl,null);assert.equal(out.authUrlExpiresAt,null);assert.match(out.notice??'',/expirou/);assert.equal(JSON.stringify(out).includes('auth.example'),false);}
});
test('link recusado/expirado/autorizado não é exibido; somente recusado, expirado ou link vencido podem ser renovados',()=>{
 for(const status of ['REJECTED','EXPIRED','AUTHORISED']){assert.equal(usableAuthUrl({...awaiting(inMin(45)),status},NOW),null);}
 assert.equal(canRecreateConsent('AUTHORISED',inMin(-10),NOW),false);
 assert.equal(canRecreateConsent('AWAITING_AUTHORIZATION',inMin(45),NOW),false);
 assert.equal(canRecreateConsent('AWAITING_AUTHORIZATION',inMin(-1),NOW),true);
 assert.equal(canRecreateConsent('AWAITING_AUTHORIZATION',null,NOW),true);
 assert.equal(canRecreateConsent('REJECTED',inMin(45),NOW),true);
 assert.equal(canRecreateConsent('EXPIRED',null,NOW),true);
 assert.match(consentGuidance('REJECTED',null,NOW)??'',/recusada/);
 assert.match(consentGuidance('EXPIRED',null,NOW)??'',/expirou/);
 assert.equal(consentGuidance('AUTHORISED',null,NOW),null);
 assert.equal(consentGuidance('AWAITING_AUTHORIZATION',inMin(45),NOW),null);
});
test('renovação usa POST /consents/{id}/recreate somente com products ACCOUNT e devolve novo link válido',async()=>{
 let calls=0;const transport:typeof fetch=async(url,init)=>{calls++;
  assert.equal(url,'https://api.polp.com.br/api/v2/consents/consent-123/recreate');assert.equal(init?.method,'POST');assert.equal(init?.redirect,'manual');assert.ok(init?.signal);
  assert.deepEqual(JSON.parse(String(init?.body)),{products:['ACCOUNT']});
  return json({data:{...awaiting(inMin(60),'https://auth.example/novo'),status_label:'Aguardando autorização'}});};
 const r=await recreatePolpConsent(keys,'consent-123',transport);
 assert.equal(calls,1);assert.equal(r.ok,true);
 if(r.ok){assert.equal(r.data.status,'AWAITING_AUTHORIZATION');const out=consentOutcome(view,r.data,null,NOW);assert.equal(out.ok&&out.authUrl,'https://auth.example/novo');assert.equal(out.ok&&out.detail.statusLabel,'Aguardando autorização');}
});
test('renovação falha fechada: sem chaves, ID divergente, HTTP de erro e timeout, sem retries nem vazamento',async()=>{
 let called=false;const none=await recreatePolpConsent({},'consent-123',async()=>{called=true;return json({});});assert.equal(called,false);assert.equal(!none.ok&&none.reason,'missing_credentials');
 const other=await recreatePolpConsent(keys,'consent-123',async()=>json({data:{...awaiting(inMin(60)),id:'consent-999'}}));assert.equal(!other.ok&&other.reason,'invalid_response');
 for(const status of [404,422,429,500]){let calls=0;const r=await recreatePolpConsent(keys,'consent-123',async()=>{calls++;return json({message:'CPF 123.456.789-01 PRIVATE'},status);});assert.equal(calls,1);assert.equal(r.ok,false);if(!r.ok){assert.equal(r.reason,'http_error');assert.equal(r.httpStatus,status);}assert.equal(JSON.stringify(r).includes('PRIVATE'),false);}
 const t=await recreatePolpConsent(keys,'consent-123',async()=>{const e=new Error('x');e.name='TimeoutError';throw e;});assert.equal(!t.ok&&t.reason,'timeout');
 assert.match(polpRecreateErrorMessage('timeout',null),/Atualizar status/);
 assert.match(polpRecreateErrorMessage('http_error',422),/Nenhum novo link/);
 assert.match(polpRecreateErrorMessage('http_error',404),/não encontrado/);
 assert.match(polpRecreateErrorMessage('http_error',402),/Assinatura/);
});
test('erro e rótulo do consentimento chegam sanitizados, sem documentos, e-mails ou links',async()=>{
 const r=await getPolpConsent(keys,'consent-123',async()=>json({data:{...awaiting(inMin(-5)),status:'REJECTED',status_label:'Rejeitado',error:{code:'CONSENT_REJECTED',message:'CNPJ 12.345.678/0001-99 sem acesso; ver https://x.y/z ou a@b.com'}}}));
 assert.equal(r.ok,true);if(r.ok){assert.equal(r.data.status_label,'Rejeitado');assert.match(r.data.error??'',/CONSENT_REJECTED/);for(const leak of ['12.345','https','a@b.com'])assert.equal((r.data.error??'').includes(leak),false);}
 assert.equal(polpConsentErrorDetail(null),null);assert.equal(polpConsentErrorDetail(['x']),null);assert.equal(polpConsentErrorDetail({other:1}),null);
});
test('reaproveitamento escolhe conexão ativa, nunca outra instituição, e sinaliza recusados para renovação explícita',()=>{
 const rows=[{id:'a',institution_id:'bank',status:'AWAITING_AUTHORIZATION',created_at:'2026-11-01T10:00:00Z'},{id:'b',institution_id:'bank',status:'AWAITING_AUTHORIZATION',created_at:'2026-11-02T10:00:00Z'},{id:'c',institution_id:'other',status:'AUTHORISED',created_at:'2026-11-02T11:00:00Z'},{id:'d',institution_id:'bank',status:'REJECTED',created_at:'2026-11-02T12:00:00Z'}];
 assert.deepEqual(selectExistingConsent(rows,'bank'),{kind:'active',consent:rows[1]});
 const withAuth=[...rows,{id:'e',institution_id:'bank',status:'AUTHORISED',created_at:'2026-10-01T00:00:00Z'}];
 assert.equal(selectExistingConsent(withAuth,'bank')?.consent.id,'e');
 assert.deepEqual(selectExistingConsent([rows[3]],'bank'),{kind:'renewable',consent:rows[3]});
 assert.equal(selectExistingConsent([rows[2]],'bank'),null);
});


// ---- Vínculo por CNPJ/representante e renovações simultâneas (respostas simuladas) ----
const SECRET='fixture-session-secret';
const CPF_A='11111111111',CNPJ_A='11222333000181',CNPJ_B='99888777000166';
test('vínculo é opaco, determinístico e distinto por CNPJ e representante',async()=>{
 const a=await polpDocumentBinding(CPF_A,CNPJ_A,SECRET);
 assert.equal(a,await polpDocumentBinding(CPF_A,CNPJ_A,SECRET));
 assert.notEqual(a,await polpDocumentBinding(CPF_A,CNPJ_B,SECRET));
 assert.notEqual(a,await polpDocumentBinding('22222222222',CNPJ_A,SECRET));
 assert.notEqual(a,await polpDocumentBinding(CPF_A,CNPJ_A,'outro-segredo'));
 assert.match(a,/^pipeflow:v1:[0-9a-f]{64}$/);for(const doc of [CPF_A,CNPJ_A])assert.equal(a.includes(doc),false);
 await assert.rejects(polpDocumentBinding(CPF_A,CNPJ_A,undefined));
});
test('criação envia o vínculo em cliente_user_id e lê o vínculo devolvido',async()=>{
 const binding=await polpDocumentBinding(CPF_A,CNPJ_A,SECRET);
 const r=await createPolpConsent(keys,{institutionId:'bank',cpf:CPF_A,cnpj:CNPJ_A,clienteUserId:binding},async(_u,init)=>{assert.equal(JSON.parse(String(init?.body)).cliente_user_id,binding);return json({data:{...awaiting(inMin(60)),cliente_user_id:binding}},201);});
 assert.equal(r.ok,true);if(r.ok)assert.equal(consentMatchesBinding(r.data,binding),true);
});
test('CNPJ diferente: lista não reaproveita nem oferece renovação de consentimento de outra empresa ou sem vínculo',async()=>{
 const bindA=await polpDocumentBinding(CPF_A,CNPJ_A,SECRET),bindB=await polpDocumentBinding(CPF_A,CNPJ_B,SECRET);
 const rows=[{...awaiting(inMin(60)),id:'consent-b-active',cliente_user_id:bindB,created_at:'2026-11-02T10:00:00Z'},{...awaiting(inMin(-10)),id:'consent-legacy',cliente_user_id:'gravon-pipeflow',created_at:'2026-11-02T11:00:00Z'},{...awaiting(null),id:'consent-b-rejected',status:'REJECTED' as const,cliente_user_id:bindB,created_at:'2026-11-02T12:00:00Z'}];
 assert.equal(selectBoundConsent(rows,'bank',bindA),null);
 assert.equal(selectBoundConsent(rows,'bank',bindB)?.consent.id,'consent-b-active');
 const mine={...awaiting(null),id:'consent-a-expired',status:'EXPIRED' as const,cliente_user_id:bindA,created_at:'2026-11-01T00:00:00Z'};
 assert.deepEqual(selectBoundConsent([...rows,mine],'bank',bindA),{kind:'renewable',consent:mine});
 assert.equal(selectBoundConsent([mine],'other-bank',bindA),null);
});
test('resposta do POST com vínculo de outra empresa ou outra instituição é rejeitada; antigo sem vínculo é aceito (avoidDuplicates)',async()=>{
 const bindA=await polpDocumentBinding(CPF_A,CNPJ_A,SECRET),bindB=await polpDocumentBinding(CPF_A,CNPJ_B,SECRET);
 assert.equal(createdConsentMatches({...awaiting(inMin(60)),cliente_user_id:bindA} as PolpConsent,'bank',bindA),true);
 assert.equal(createdConsentMatches({...awaiting(inMin(60)),cliente_user_id:'gravon-pipeflow'} as PolpConsent,'bank',bindA),true);
 assert.equal(createdConsentMatches({...awaiting(inMin(60)),cliente_user_id:bindB} as PolpConsent,'bank',bindA),false);
 assert.equal(createdConsentMatches({...awaiting(inMin(60)),cliente_user_id:bindA} as PolpConsent,'other-bank',bindA),false);
});
test('prova de renovação: assinada, vinculada ao consentimento e com validade',async()=>{
 const bind=await polpDocumentBinding(CPF_A,CNPJ_A,SECRET);
 const proof=await issueRenewalProof('consent-123',bind,SECRET,NOW);
 assert.equal(await verifyRenewalProof(proof,'consent-123',SECRET,NOW+1000),bind);
 assert.equal(await verifyRenewalProof(proof,'consent-999',SECRET,NOW),null);
 assert.equal(await verifyRenewalProof(proof,'consent-123','outro-segredo',NOW),null);
 assert.equal(await verifyRenewalProof(proof,'consent-123',SECRET,NOW+3*60*60*1000),null);
 const env=JSON.parse(proof);const tampered=JSON.stringify({...env,payload:env.payload.replace('consent-123','consent-999')});
 assert.equal(await verifyRenewalProof(tampered,'consent-999',SECRET,NOW),null);
 for(const bad of ['','x','{}','{"payload":1}'])assert.equal(await verifyRenewalProof(bad,'consent-123',SECRET,NOW),null);
 for(const doc of [CPF_A,CNPJ_A])assert.equal(proof.includes(doc),false);
});

// Lease simulado com a mesma semântica da RPC: claim atômico, falha se houver lease ativo; release só com o mesmo id.
function fakeLeaseStore(){
 const leases=new Map<string,{id:string;until:number}>();let seq=0;let clock=NOW;
 return {leases,tick:(ms:number)=>{clock+=ms;},
  claim:async(consentId:string):Promise<RenewalLease>=>{const cur=leases.get(consentId);if(cur&&cur.until>clock)return {ok:false,reason:'busy'};const id=`lease-${++seq}`;leases.set(consentId,{id,until:clock+90000});return {ok:true,leaseId:id};},
  release:async(consentId:string,leaseId:string)=>{if(leases.get(consentId)?.id===leaseId)leases.delete(consentId);}};
}
async function renewalScenario(opts:{status?:PolpConsent['status'];expiresAt?:string|null;owner?:string;recreateDelayMs?:number;recreateFails?:'timeout'|'http'}={}){
 const bindA=await polpDocumentBinding(CPF_A,CNPJ_A,SECRET);
 const store=fakeLeaseStore();let state:PolpConsent={...awaiting(opts.expiresAt===undefined?inMin(-10):opts.expiresAt),status:opts.status??'AWAITING_AUTHORIZATION',cliente_user_id:opts.owner??bindA} as PolpConsent;
 let recreateCalls=0,saves=0;
 const deps:RenewDeps<{saved:number}>={
  claimLease:store.claim,releaseLease:store.release,now:()=>NOW,
  getConsent:async()=>({ok:true,data:state,httpStatus:200}),
  recreate:async()=>{recreateCalls++;await new Promise(r=>setTimeout(r,opts.recreateDelayMs??5));
   if(opts.recreateFails==='timeout')return {ok:false,httpStatus:null,reason:'timeout'};
   if(opts.recreateFails==='http')return {ok:false,httpStatus:422,reason:'http_error'};
   state={...state,status:'AWAITING_AUTHORIZATION',url_to_authenticate:'https://auth.example/novo',url_to_authenticate_expires_at:inMin(60)};return {ok:true,data:state,httpStatus:200};},
  save:async()=>({saved:++saves}),
 };
 return {deps,store,bindA,input:{consentId:'consent-123',institutionId:'bank',binding:bindA},calls:()=>recreateCalls};
}
test('renovação do próprio consentimento expirado gera exatamente um novo link e libera o lease',async()=>{
 const s=await renewalScenario();
 const r=await renewConsentLink(s.deps,s.input);
 assert.equal(r.ok,true);if(r.ok){assert.equal(r.renewed,true);assert.equal(usableAuthUrl(r.consent,NOW),'https://auth.example/novo');}
 assert.equal(s.calls(),1);assert.equal(s.store.leases.size,0);
});
test('tentativas simultâneas: só uma renova; as demais recebem "renovação em andamento" sem chamar a Polp',async()=>{
 const s=await renewalScenario({recreateDelayMs:30});
 const results=await Promise.all(Array.from({length:5},()=>renewConsentLink(s.deps,s.input)));
 assert.equal(s.calls(),1);
 assert.equal(results.filter(r=>r.ok&&r.renewed).length,1);
 const busy=results.filter(r=>!r.ok);assert.equal(busy.length,4);for(const b of busy)assert.match(!b.ok?b.error:'',/em andamento/);
 // Depois de concluída, nova tentativa vê o link válido e não renova de novo.
 const again=await renewConsentLink(s.deps,s.input);
 assert.equal(again.ok&&again.renewed,false);assert.match(again.ok?again.notice??'':'',/ainda é válido/);assert.equal(s.calls(),1);
});
test('renovação nunca ocorre para consentimento de outra empresa (vínculo diferente)',async()=>{
 const other=await polpDocumentBinding(CPF_A,CNPJ_B,SECRET);
 const s=await renewalScenario({owner:other});
 const r=await renewConsentLink(s.deps,s.input);
 assert.equal(r.ok,false);assert.match(!r.ok?r.error:'',/outra empresa/);assert.equal(s.calls(),0);assert.equal(s.store.leases.size,0);
});
test('renovação não recria autorizado nem link válido',async()=>{
 for(const opts of [{status:'AUTHORISED' as const},{expiresAt:inMin(50)}]){const s=await renewalScenario(opts);const r=await renewConsentLink(s.deps,s.input);assert.equal(r.ok&&r.renewed,false);assert.equal(s.calls(),0);}
});
test('lease indisponível (migração pendente) falha fechada sem chamar a Polp',async()=>{
 const s=await renewalScenario();s.deps.claimLease=async()=>({ok:false,reason:'unavailable'});
 const r=await renewConsentLink(s.deps,s.input);assert.equal(r.ok,false);assert.match(!r.ok?r.error:'',/migração pendente/);assert.equal(s.calls(),0);
});
test('timeout mantém o lease (resultado desconhecido); erro definitivo libera',async()=>{
 const t=await renewalScenario({recreateFails:'timeout'});
 const r1=await renewConsentLink(t.deps,t.input);assert.equal(r1.ok,false);assert.equal(t.store.leases.size,1);
 const r2=await renewConsentLink(t.deps,t.input);assert.match(!r2.ok?r2.error:'',/em andamento/);assert.equal(t.calls(),1);
 t.store.tick(91000);const r3=await renewConsentLink(t.deps,t.input);assert.equal(t.calls(),2);assert.equal(r3.ok,false);
 const h=await renewalScenario({recreateFails:'http'});
 const r4=await renewConsentLink(h.deps,h.input);assert.match(!r4.ok?r4.error:'',/HTTP 422/);assert.equal(h.store.leases.size,0);
});
test('listagem segue next_cursor de forma limitada',async()=>{
 const urls:string[]=[];
 const r=await listPolpConsents(keys,async url=>{urls.push(String(url));const page=urls.length;return json({data:[{id:`consent-p${page}x`,institution_id:'bank',status:'EXPIRED'}],meta:{next_cursor:page<2?`c${page}`:null}});});
 assert.equal(r.ok,true);if(r.ok){assert.equal(r.data.length,2);assert.equal(r.complete,true);}
 assert.equal(urls[1],'https://api.polp.com.br/api/v2/consents?cursor=c1');
 let calls=0;const capped=await listPolpConsents(keys,async()=>{calls++;return json({data:[],meta:{next_cursor:`c${calls}`}});});
 assert.equal(calls,5);assert.equal(capped.ok&&capped.complete,false);
});
