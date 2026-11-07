import {test} from 'node:test';
import assert from 'node:assert/strict';
import {credentialProblem,hypercashRequest,hypercashRead,allHypercashPages} from './hypercash-api';
import {hypercashReadiness} from './hypercash';

test('SK de Transações não autoriza assinaturas e HCP não autoriza Transações',()=>{
 assert.ok(credentialProblem('sk_fake_only_fixture','subscriptions'));
 assert.ok(credentialProblem('hcp_live_fake_only_fixture','transactions'));
 assert.equal(credentialProblem('hcp_live_fake_only_fixture','subscriptions'),null);
});
test('cada API usa seu host e autorização documentados, sem redirecionar',()=>{
 const catalog=hypercashRequest('/v1/subscriptions','fixture','subscriptions');
 assert.equal(catalog.url,'https://api-hypercash.fly.dev/v1/subscriptions');assert.equal(catalog.init.headers.Authorization,'Bearer fixture');assert.equal(catalog.init.redirect,'manual');
 const tx=hypercashRequest('/user/transactions','fixture','transactions');assert.equal(tx.url,'https://api.hypercashbrasil.com.br/api/user/transactions');assert.equal(tx.init.headers.Authorization,`Basic ${btoa('x:fixture')}`);
});
test('403 diferencia permissão, 429 não repete consulta e redirecionamento falha fechado',async()=>{
 for(const [status,code] of [[403,'permission'],[429,'rate_limit'],[302,'redirect']] as const){let calls=0;const read=async()=>{calls++;return new Response(null,{status});};assert.deepEqual(await hypercashRead('/v1/subscriptions','fixture','subscriptions',read as typeof fetch),{ok:false,http:status,code});assert.equal(calls,1);}
});
test('200 não-JSON ou success false não comprovam conexão',async()=>{
 for(const body of ['not json','{"success":false}']){const result=await hypercashRead('/v1/subscriptions','fixture','subscriptions',(async()=>new Response(body)) as typeof fetch);assert.equal(result.ok,false);}
});
test('paginação consulta todas as páginas inclusive acima do antigo corte de 200 assinaturas',async()=>{
 const paths:string[]=[];const read:typeof hypercashRead=async(path)=>{paths.push(path);const page=Number(new URL('https://test.local'+path).searchParams.get('page'));return {ok:true,body:{success:true,page,total:205,data:Array.from({length:page===3?5:100},(_,i)=>({id:String((page-1)*100+i)}))}};};
 const rows=await allHypercashPages('/v1/subscriptions','fixture',r=>r as {id:string},read);assert.equal(rows.length,205);assert.equal(paths.length,3);assert.equal(rows[204].id,'204');
});
test('página repetida, payload inválido e falha de cobrança nunca viram sucesso parcial',async()=>{
 const read:typeof hypercashRead=async()=>({ok:true,body:{success:true,total:2,data:[{id:'same'}]}});
 await assert.rejects(allHypercashPages('/v1/subscriptions','fixture',r=>r as {id:string},read),/repetida/);
 await assert.rejects(allHypercashPages('/v1/subscriptions','fixture',()=>null,read),/inválido/);
 await assert.rejects(allHypercashPages('/v1/subscriptions','fixture',r=>r as {id:string},async()=>({ok:false,http:401,code:'auth'})),/auth/);
});
test('SK verificada e registro ativo não autorizam assinaturas nem comprovam sincronização',()=>{
 const r=hypercashReadiness({hasSubscriptions:false,hasTransactions:true,active:true,subscriptionCheck:null,transactionCheck:'ok',syncStatus:null,syncedAt:null});assert.equal(r.canSync,false);assert.equal(r.transactions,'Transações verificadas');assert.equal(r.subscriptions,'Credencial HCP não cadastrada');assert.equal(r.sync,'Nunca sincronizada');
});
test('assinaturas só ficam prontas com credencial presente, teste aprovado e ativação',()=>{
 const base={hasSubscriptions:true,hasTransactions:false,active:true,subscriptionCheck:'ok',transactionCheck:null,syncStatus:null,syncedAt:null};assert.equal(hypercashReadiness(base).canSync,true);assert.equal(hypercashReadiness({...base,active:false}).canSync,false);assert.equal(hypercashReadiness({...base,subscriptionCheck:'falha:auth'}).canSync,false);assert.equal(hypercashReadiness(base).sync,'Nunca sincronizada');
});
test('sincronização exige conclusão registrada e data, nunca só credencial ou estado ativa',()=>{
 const base={hasSubscriptions:true,hasTransactions:true,active:true,subscriptionCheck:'ok',transactionCheck:'ok',syncStatus:'ok',syncedAt:null};assert.equal(hypercashReadiness(base).sync,'Sincronização não concluída');assert.equal(hypercashReadiness({...base,syncedAt:'2026-11-05T13:00:00Z'}).sync,'Sincronização concluída');
});