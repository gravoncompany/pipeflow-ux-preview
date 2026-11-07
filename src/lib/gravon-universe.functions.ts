import { createServerFn } from '@tanstack/react-start';
import { receiptInput,targetInput,MONTHLY_TARGETS,LIFETIME_TARGETS,type UniverseSnapshot } from './gravon-universe';
export const getUniverse=createServerFn({method:'POST'}).handler(async():Promise<UniverseSnapshot>=>{
 const {projectAccess}=await import('./crm-projects.server');const {db}=await projectAccess();
 const [r,a,s,h]=await Promise.all([db.from('universe_confirmed_sources').select('*').order('date',{ascending:false}).limit(10001),db.from('universe_awards').select('journey,amount,period,awarded_at,evidence_total').eq('company_key','crm:1').limit(1001),db.from('universe_settings').select('*').eq('company_key','crm:1').maybeSingle(),db.from('universe_audit').select('id,created_at,reason,before_data,after_data').eq('company_key','crm:1').order('created_at',{ascending:false}).limit(50)]);
 if(r.error||a.error||s.error||h.error||(r.data?.length??0)>10000||(a.data?.length??0)>1000)throw new Error('Não foi possível consultar o histórico completo do Universe.');
 await projectAccess();const {todaySP}=await import('./finance-management');
 return {receipts:(r.data??[]) as UniverseSnapshot['receipts'],awards:(a.data??[]) as UniverseSnapshot['awards'],targets:{monthly:s.data?.monthly??MONTHLY_TARGETS,lifetime:s.data?.lifetime??LIFETIME_TARGETS},settingsRevision:s.data?.revision??0,audit:h.data??[],asOf:todaySP()};
});
function failure(message:string):never {if(message.includes('universe_changed'))throw new Error('Os dados mudaram. Atualize antes de salvar.');if(message.includes('duplicate')||message.includes('unique'))throw new Error('Possível recebimento duplicado: confira a origem, referência, valor e data no histórico antes de cadastrar.');throw new Error('Não foi possível salvar. Confira os dados e sua autorização.');}
export const saveUniverseReceipt=createServerFn({method:'POST'}).inputValidator(v=>receiptInput.parse(v)).handler(async({data})=>{
 const {projectAccess}=await import('./crm-projects.server');const {db,actor}=await projectAccess();
 const {data:result,error}=await db.rpc('save_universe_receipt',{p_actor:actor.userId,p_event:data.event,p_id:data.id as string,p_revision:data.revision,p_reason:data.reason,p_data:data.fields});if(error)failure(error.message);await projectAccess();return result;
});
export const saveUniverseTargets=createServerFn({method:'POST'}).inputValidator(v=>targetInput.parse(v)).handler(async({data})=>{
 const {projectAccess}=await import('./crm-projects.server');const {db,actor}=await projectAccess();
 const {error}=await db.rpc('save_universe_targets',{p_actor:actor.userId,p_event:data.event,p_revision:data.revision,p_reason:data.reason,p_monthly:data.monthly,p_lifetime:data.lifetime});if(error)failure(error.message);await projectAccess();return {ok:true};
});
// ---- Fonte temporária: Google Sheets (somente leitura) ----
// Card do perfil: mesma autorização do Financeiro (sessão CRM completa). Somente totais; nenhum dado de cliente.
export const getUniverseSheetCard=createServerFn({method:'POST'}).inputValidator((v:unknown)=>(v&&typeof v==='object'&&'force' in v?{force:Boolean((v as {force:unknown}).force)}:{force:false})).handler(async({data})=>{
 const secret=process.env.CRM_SESSION_SECRET;const {hasFullCrmSession}=await import('./crm-session.server');
 if(!secret||!(await hasFullCrmSession(secret)))return {ok:false as const,error:'Entre com acesso completo.'};
 const {readUniverseSheet}=await import('./universe-sheet.server');const {universeCard}=await import('./universe-sheet');const {todaySP}=await import('./finance-management');
 const sheet=await readUniverseSheet(data.force);
 if(sheet.error)return {ok:false as const,error:sheet.error};
 return {ok:true as const,card:universeCard(sheet.revenue,todaySP()),syncedAt:sheet.syncedAt};
});


// Interface do laboratório (GravonUniverse): mesmo formato do getFinance, mas lido pelo leitor verificado (E–P, rótulos
// "Valor Total"/"Tráfego" conferidos). Valores em reais; mês vazio = null (nunca zero). Sessão CRM completa, como o Financeiro.
export type UniverseFinanceMonth={month:string;short:string;value:number|null;status:'value'|'empty'|'error';cell:string};
export const getUniverseFinance=createServerFn({method:'POST'}).inputValidator((v:unknown)=>(v&&typeof v==='object'&&'force' in v?{force:Boolean((v as {force:unknown}).force)}:{force:false})).handler(async({data}):Promise<{months:UniverseFinanceMonth[];traffic:UniverseFinanceMonth[];updatedAt:string|null;error:string|null;needsAuth:boolean}>=>{
 const secret=process.env.CRM_SESSION_SECRET;const {hasFullCrmSession}=await import('./crm-session.server');
 if(!secret||!(await hasFullCrmSession(secret)))return {months:[],traffic:[],updatedAt:null,error:null,needsAuth:true};
 const {readUniverseSheet}=await import('./universe-sheet.server');const {toFinanceMonths}=await import('./universe-sheet');
 const sheet=await readUniverseSheet(data.force);
 if(sheet.error)return {months:[],traffic:[],updatedAt:null,error:sheet.error,needsAuth:false};
 return {months:toFinanceMonths(sheet.revenue),traffic:toFinanceMonths(sheet.traffic),updatedAt:sheet.syncedAt,error:null,needsAuth:false};
});
