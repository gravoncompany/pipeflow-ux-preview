import {createServerFn} from '@tanstack/react-start';
import {z} from 'zod';
import {financeWriteSchema, recordSchemas, occurrenceDates} from './finance-management';

export const getFinanceManagement=createServerFn({method:'POST'}).inputValidator(v=>z.object({personal:z.boolean()}).strict().parse(v)).handler(async({data})=>{
 const {readManagement}=await import('./finance-management.server');return readManagement(data.personal);
});
export const saveFinanceRecord=createServerFn({method:'POST'}).inputValidator(v=>financeWriteSchema.parse(v)).handler(async({data})=>{
 const {financeAccess}=await import('./finance-management.server');const {db,scope,actor}=await financeAccess(data.personal);
 if(data.kind==='settlement'&&data.record&&'receiptPath' in data.record&&data.record.receiptPath&&!data.record.receiptPath.startsWith(`${scope}/`))throw new Error('Comprovante fora do escopo autorizado.');
 const {data:id,error}=await db.rpc('save_finance_record',{p_scope:scope,p_actor:actor,p_operation:data.operation,p_id:data.id as any,p_kind:data.kind,p_revision:data.revision,p_data:data.record as any});
 if(error){const messages:Record<string,string>={finance_changed:'O registro foi alterado. Atualize antes de salvar.',insufficient_free_balance:'Saldo livre insuficiente para esta reserva.',goal_not_funded:'A meta ainda não tem o valor integral reservado.',overpayment:'O valor supera o saldo restante.',insufficient_reserved:'A retirada supera o valor reservado.',settled_entry_immutable:'Um lançamento com liquidações não pode ser substituído.',operation_conflict:'A confirmação já foi utilizada para outra operação.'};throw new Error(Object.entries(messages).find(([k])=>error.message.includes(k))?.[1]??'Não foi possível salvar. Confira valores, autorização e confirmação.');}
 return {id};
});
export const analyzeFinance=createServerFn({method:'POST'}).inputValidator(v=>z.object({personal:z.boolean(),question:z.string().trim().min(2).max(2000)}).strict().parse(v)).handler(async({data})=>{
 const {readManagement,financeAccess}=await import('./finance-management.server');const snapshot=await readManagement(data.personal);
 const {analyzeFinancialSnapshot}=await import('./ai/gravon-finance.server');const text=await analyzeFinancialSnapshot(snapshot,data.question);await financeAccess(data.personal);return {text};
});
export const createFinanceSeries=createServerFn({method:'POST'}).inputValidator(v=>z.object({personal:z.boolean(),operation:z.string().uuid(),entry:recordSchemas.entry,confirmed:z.literal(true)}).strict().parse(v)).handler(async({data})=>{
 const {financeAccess}=await import('./finance-management.server');const {db,scope,actor}=await financeAccess(data.personal);
 if(!data.entry.dueDate)throw new Error('Informe o primeiro vencimento para gerar a recorrência.');
 const entries=occurrenceDates(data.entry.dueDate,data.entry.recurrence).map((dueDate,i)=>({...data.entry,dueDate,competence:data.entry.competence?occurrenceDates(data.entry.competence,data.entry.recurrence)[i]:null,seriesKey:data.operation,occurrence:i}));
 const {data:id,error}=await db.rpc('create_finance_series',{p_scope:scope,p_actor:actor,p_operation:data.operation,p_entries:entries});if(error)throw new Error('Não foi possível gerar a recorrência; atualize antes de repetir.');return {id,count:entries.length};
});
export const registerFinanceClientPayment=createServerFn({method:'POST'}).inputValidator(v=>z.object({operation:z.string().uuid(),chargeId:z.string().uuid(),accountId:z.string().uuid(),amount:z.number().int().positive().max(10000000000),date:recordSchemas.settlement.shape.date,confirmed:z.literal(true)}).strict().parse(v)).handler(async({data})=>{
 const {financeAccess}=await import('./finance-management.server');const {db,actor}=await financeAccess(false);
 const {data:id,error}=await db.rpc('register_finance_client_payment',{p_actor:actor,p_operation:data.operation,p_charge:data.chargeId,p_account:data.accountId,p_amount:data.amount/100,p_date:data.date,p_confirmed:true});if(error)throw new Error('Pagamento não registrado: confira o valor restante e a confirmação.');return {id};
});
async function deterministicUuid(seed:string) {
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(seed))).slice(0,16);
 bytes[6]=(bytes[6]&0x0f)|0x40;bytes[8]=(bytes[8]&0x3f)|0x80;
 const hex=[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
 return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export const importFinanceHistory=createServerFn({method:'POST'}).inputValidator(v=>z.object({batch:z.string().uuid(),accountId:z.string().uuid(),rows:z.array(z.object({line:z.number().int().min(1),date:recordSchemas.settlement.shape.date,amount:z.number().int().positive().max(10000000000),description:z.string().trim().min(2).max(300)}).strict()).min(1).max(500),confirmed:z.literal(true)}).strict().parse(v)).handler(async({data})=>{
 const {financeAccess}=await import('./finance-management.server');const {db,scope,actor}=await financeAccess(false);
 const {data:account}=await db.from('finance_records').select('id').eq('scope',scope).eq('kind','account').eq('id',data.accountId).maybeSingle();
 if(!account)throw new Error('Conta financeira indisponível para a importação.');
 let imported=0;const failures:number[]=[];
 for(const row of data.rows){
  const entry={name:row.description,amount:row.amount,direction:'in',category:'receita',dueDate:row.date,competence:row.date,serviceMonths:1,accountId:data.accountId,clientId:null,supplier:'',status:'pendente',note:`Importado do histórico externo · lote ${data.batch}`,recurrence:{frequency:'unica',interval:1,count:1},seriesKey:null,occurrence:0};
  const {data:entryId,error:entryError}=await db.rpc('save_finance_record',{p_scope:scope,p_actor:actor,p_operation:await deterministicUuid(`${data.batch}:e:${row.line}`),p_id:null as any,p_kind:'entry',p_revision:0,p_data:entry});
  if(entryError||!entryId){failures.push(row.line);continue;}
  const settlement={name:`Liquidação: ${row.description}`,amount:row.amount,accountId:data.accountId,targetId:entryId,date:row.date,confirmed:true,conciliated:false,receiptPath:null,note:'Importado do histórico externo'};
  const {error:settlementError}=await db.rpc('save_finance_record',{p_scope:scope,p_actor:actor,p_operation:await deterministicUuid(`${data.batch}:s:${row.line}`),p_id:null as any,p_kind:'settlement',p_revision:0,p_data:settlement});
  if(settlementError){failures.push(row.line);continue;}
  imported++;
 }
 if(failures.length===data.rows.length)throw new Error('Nenhuma linha importada: confira a conta e os valores.');
 return {imported,failed:failures};
});
export const getFinanceAudit=createServerFn({method:'POST'}).inputValidator(v=>z.object({personal:z.boolean(),id:z.string().uuid()}).strict().parse(v)).handler(async({data})=>{
 const {financeAccess}=await import('./finance-management.server');const {db,scope}=await financeAccess(data.personal);
 const {data:rows,error}=await db.from('finance_audit').select('id,action,actor,created_at,before_data,after_data').eq('scope',scope).eq('record_id',data.id).order('created_at',{ascending:false}).limit(100);if(error)throw new Error('Histórico indisponível.');return {rows:rows??[]};
});
export const createFinanceReceipt=createServerFn({method:'POST'}).inputValidator(v=>z.object({personal:z.boolean(),name:z.string().min(1).max(200),type:z.enum(['application/pdf','image/jpeg','image/png']),size:z.number().int().min(1).max(10*1024*1024)}).strict().parse(v)).handler(async({data})=>{
 const {financeAccess}=await import('./finance-management.server');const {db,scope}=await financeAccess(data.personal);const ext=data.type==='application/pdf'?'pdf':data.type==='image/png'?'png':'jpg';const path=`${scope}/${crypto.randomUUID()}.${ext}`;
 const {data:upload,error}=await db.storage.from('finance-receipts').createSignedUploadUrl(path);if(error||!upload)throw new Error('Não foi possível preparar o comprovante.');return {path,token:upload.token};
});
export const readFinanceReceipt=createServerFn({method:'POST'}).inputValidator(v=>z.object({personal:z.boolean(),id:z.string().uuid()}).strict().parse(v)).handler(async({data})=>{
 const {financeAccess}=await import('./finance-management.server');const {db,scope}=await financeAccess(data.personal);const {data:record,error}=await db.from('finance_records').select('data').eq('scope',scope).eq('kind','settlement').eq('id',data.id).single();const value=record?.data as any;const path=value?.receiptPath;if(error||typeof path!=='string'||!path.startsWith(`${scope}/`))throw new Error('Comprovante indisponível.');const {data:link,error:failed}=await db.storage.from('finance-receipts').createSignedUrl(path,300);if(failed||!link)throw new Error('Comprovante indisponível.');return {url:link.signedUrl};
});