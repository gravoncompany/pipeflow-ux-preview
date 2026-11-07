import { z } from 'zod';

export const financeKinds = ['account','entry','goal','estimate','allocation','settlement','charge_meta','milestone'] as const;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v, 'Data inválida');
const money = z.number().int().min(0).max(100_000_000_000);
export const categories = ['receita','deducao','custo','comercial','administrativa','pessoal','transferencia'] as const;
export const recurrenceSchema = z.object({ frequency:z.enum(['unica','semanal','quinzenal','mensal','personalizada']), interval:z.number().int().min(1).max(365), count:z.number().int().min(1).max(24) }).strict();
const label = z.string().trim().min(2).max(300);
export const recordSchemas = {
 account:z.object({name:label,amount:money,referenceDate:date,conciliated:z.boolean(),note:z.string().max(2000)}).strict(),
 entry:z.object({name:label,amount:money,direction:z.enum(['in','out']),category:z.enum(categories),dueDate:date.nullable(),competence:date.nullable(),serviceMonths:z.number().int().min(1).max(36),accountId:z.string().uuid().nullable(),clientId:z.string().uuid().nullable(),supplier:z.string().max(300),status:z.enum(['pendente','atrasado_informado','cancelado']),note:z.string().max(2000),recurrence:recurrenceSchema,seriesKey:z.string().max(160).nullable(),occurrence:z.number().int().min(0).max(24),service:z.string().max(300).optional(),paymentMethod:z.string().max(160).optional(),contractStatus:z.enum(['ativa','pausada','encerrada']).optional()}).strict(),
 goal:z.object({name:label,amount:money,dueDate:date.nullable(),priority:z.enum(['alta','media','baixa']),status:z.enum(['ativa','concluida','arquivada']),position:z.number().int().min(0).max(10000),reserve:z.boolean(),note:z.string().max(2000)}).strict(),
 estimate:z.object({name:label,amount:money,category:z.enum(categories),periodicity:z.enum(['mensal','semanal','anual','extra']),dueDate:date.nullable(),includedInCard:z.boolean(),active:z.boolean(),note:z.string().max(2000)}).strict(),
 allocation:z.object({name:label,amount:money,accountId:z.string().uuid(),targetId:z.string().uuid(),direction:z.enum(['reserve','release']),date,confirmed:z.literal(true)}).strict(),
 settlement:z.object({name:label,amount:money,accountId:z.string().uuid(),targetId:z.string().uuid(),date:date.refine(v=>v<=todaySP(),'Liquidações futuras devem permanecer previstas.'),confirmed:z.literal(true),conciliated:z.boolean(),receiptPath:z.string().max(600).nullable(),note:z.string().max(2000)}).strict(),
 charge_meta:z.object({name:label,amount:money,chargeId:z.string().uuid(),competence:date.nullable(),serviceMonths:z.number().int().min(1).max(36),category:z.enum(categories),accountId:z.string().uuid().nullable()}).strict(),
 milestone:z.object({name:label,amount:money,day:z.union([z.literal(30),z.literal(60),z.literal(90)]),note:z.string().max(2000),done:z.boolean()}).strict(),
};
export type FinanceKind = typeof financeKinds[number];
export type Entry = z.infer<typeof recordSchemas.entry>;
export type Goal = z.infer<typeof recordSchemas.goal>;
export type Account = z.infer<typeof recordSchemas.account>;
export interface FinanceRecord { id:string; scope:string; kind:FinanceKind; data:Record<string,any>; revision:number; created_at:string; updated_at:string }
export interface Charge {id:string;client_id:string;description:string;amount:number;due_date:string;status:string;revision:number}
export interface ClientPayment {id:string;charge_id:string;amount:number;paid_at:string;finance_account_id?:string|null;finance_operation?:string|null}
export interface FinanceSnapshot { records:FinanceRecord[];charges:Charge[];payments:ClientPayment[];clients:{id:string;trade_name:string}[];audit:{id:string;action:string;record_id:string;actor:string;created_at:string}[];personalAllowed:boolean;personal:boolean }
export const financeWriteSchema = z.object({personal:z.boolean(),id:z.string().uuid().nullable(),kind:z.enum(financeKinds),revision:z.number().int().nonnegative(),operation:z.string().uuid(),record:z.unknown()}).strict().transform(v=>({...v,record:recordSchemas[v.kind].parse(v.record)}));
export function todaySP(now=new Date()) {return new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
export function addDays(d:string,n:number) {const v=new Date(`${d}T12:00:00Z`);v.setUTCDate(v.getUTCDate()+n);return v.toISOString().slice(0,10);}
export function addMonths(d:string,n:number) {const v=new Date(`${d}T12:00:00Z`);const day=v.getUTCDate();v.setUTCDate(1);v.setUTCMonth(v.getUTCMonth()+n);const last=new Date(Date.UTC(v.getUTCFullYear(),v.getUTCMonth()+1,0)).getUTCDate();v.setUTCDate(Math.min(day,last));return v.toISOString().slice(0,10);}
export function occurrenceDates(start:string,r:z.infer<typeof recurrenceSchema>) {return Array.from({length:r.frequency==='unica'?1:r.count},(_,i)=>r.frequency==='mensal'?addMonths(start,i):addDays(start,i*(r.frequency==='semanal'?7:r.frequency==='quinzenal'?14:r.interval)));}
export function cents(value:number) {return Math.round(value*100);}
export function allocationFor(records:FinanceRecord[],targetId?:string,accountId?:string) {return records.filter(r=>r.kind==='allocation'&&(!targetId||r.data.targetId===targetId)&&(!accountId||r.data.accountId===accountId)).reduce((s,r)=>s+(r.data.direction==='release'?-r.data.amount:r.data.amount),0);}
export function settledFor(records:FinanceRecord[],targetId:string) {return records.filter(r=>r.kind==='settlement'&&r.data.targetId===targetId).reduce((s,r)=>s+r.data.amount,0);}
export function goalProgress(records:FinanceRecord[],goal:FinanceRecord) {const reserved=allocationFor(records,goal.id);return {reserved,remaining:Math.max(0,goal.data.amount-reserved),percent:goal.data.amount>0?Math.min(100,Math.floor(reserved/goal.data.amount*100)):0,canComplete:goal.data.amount>0&&reserved>=goal.data.amount};}
export function accountBalance(records:FinanceRecord[],account:FinanceRecord,asOf=todaySP()) {return records.filter(r=>r.kind==='settlement'&&r.data.accountId===account.id&&r.data.date>account.data.referenceDate&&r.data.date<=asOf).reduce((s,r)=>{const e=records.find(e=>e.id===r.data.targetId&&e.kind==='entry');return s+(e?.data.direction==='in'?r.data.amount:-r.data.amount);},account.data.amount);}
export function paymentTotal(payments:ClientPayment[],id:string) {return payments.filter(p=>p.charge_id===id).reduce((s,p)=>s+cents(Number(p.amount)),0);}
export function ledger(snapshot:FinanceSnapshot) {const own=snapshot.records.filter(r=>r.kind==='entry'&&r.data.status!=='cancelado').map(r=>({id:r.id,name:r.data.name,amount:r.data.amount,remaining:Math.max(0,r.data.amount-settledFor(snapshot.records,r.id)),dueDate:r.data.dueDate as string|null,direction:r.data.direction as 'in'|'out',category:r.data.category,competence:r.data.competence as string|null,serviceMonths:r.data.serviceMonths,source:'manual',record:r,status:r.data.status}));
 const charges=snapshot.charges.filter(c=>c.status!=='cancelado').map(c=>{const m=snapshot.records.find(r=>r.kind==='charge_meta'&&r.data.chargeId===c.id);return {id:c.id,name:c.description,amount:cents(Number(c.amount)),remaining:c.status==='pago'?0:Math.max(0,cents(Number(c.amount))-paymentTotal(snapshot.payments,c.id)),dueDate:c.due_date,direction:'in' as const,category:m?.data.category??'receita',competence:m?.data.competence??null,serviceMonths:m?.data.serviceMonths??1,source:'cliente',record:m,status:c.status};});return [...own,...charges]; }
export function clientAccountReceipts(s:FinanceSnapshot,a:FinanceRecord,asOf=todaySP()) {return s.payments.filter(p=>p.finance_account_id===a.id&&p.paid_at>a.data.referenceDate&&p.paid_at<=asOf).reduce((n,p)=>n+cents(Number(p.amount)),0);}
export function overview(s:FinanceSnapshot,asOf=todaySP()) {const rows=ledger(s);const balance=s.records.filter(r=>r.kind==='account').reduce((n,a)=>n+accountBalance(s.records,a,asOf)+clientAccountReceipts(s,a,asOf),0);const reserved=allocationFor(s.records);const incoming=rows.filter(r=>r.direction==='in').reduce((n,r)=>n+r.remaining,0);const outgoing=rows.filter(r=>r.direction==='out').reduce((n,r)=>n+r.remaining,0);const overdue=rows.filter(r=>r.remaining>0&&(r.status==='atrasado_informado'||!!r.dueDate&&r.dueDate<asOf)).reduce((n,r)=>n+r.remaining,0);return {balance,reserved,free:balance-reserved,incoming,outgoing,overdue,projected:balance-reserved+incoming-outgoing,undated:rows.filter(r=>r.remaining>0&&!r.dueDate).length};}
export function projection(s:FinanceSnapshot,horizon:number,asOf=todaySP()) {let balance=overview(s,asOf).free;const rows=ledger(s);return Array.from({length:horizon+1},(_,i)=>{const date=addDays(asOf,i);const daily=rows.filter(r=>r.dueDate===date&&r.remaining>0);const incoming=daily.filter(r=>r.direction==='in').reduce((n,r)=>n+r.remaining,0);const outgoing=daily.filter(r=>r.direction==='out').reduce((n,r)=>n+r.remaining,0);balance+=incoming-outgoing;return {date,incoming,outgoing,balance};});}
export function recognized(amount:number,start:string,months:number,month:string) {const index=(Number(month.slice(0,4))-Number(start.slice(0,4)))*12+Number(month.slice(5,7))-Number(start.slice(5,7));if(index<0||index>=months)return 0;const base=Math.floor(amount/months);return base+(index<amount%months?1:0);}
export function dre(s:FinanceSnapshot,month:string) {const totals={receita:0,deducao:0,custo:0,comercial:0,administrativa:0};let missing=0;for(const row of ledger(s)){if(row.category==='pessoal'||row.category==='transferencia')continue;if(!row.competence){missing++;continue;}const value=recognized(row.amount,row.competence,row.serviceMonths,month);const key=row.category as keyof typeof totals;if(key in totals)totals[key]+=value;}const liquid=totals.receita-totals.deducao;const gross=liquid-totals.custo;return {...totals,liquid,gross,operating:gross-totals.comercial-totals.administrativa,missing};}
export function canPersonal(verified:boolean,admin:boolean,owner:string,caller:string) {return verified&&admin&&owner===caller;}
export const initialTools=[['CapCut',82],['Chat Center',50],['Canva',90],['Zapier',200],['Google Workspace',110],['ChatGPT',500],['Lovable',1000],['VPS',80]] as const;
export const initialPersonal=[['Aluguel residencial',5900],['Parcela do carro',764],['Energia',240],['Gás',150],['Cartões de crédito — total combinado',4000],['Empréstimo 1',300],['Empréstimo 2',160],['Celular',60],['Internet',119],['Combustível',1500]] as const;
export function estimateTotal(records:FinanceRecord[]) {return records.filter(r=>r.kind==='estimate'&&r.data.active&&!r.data.includedInCard).reduce((s,r)=>s+r.data.amount,0);}

// Faturamento confirmado: mesma regra da fonte única do Gravon Universe —
// liquidações confirmadas de entradas de receita sem cliente vinculado +
// pagamentos de clientes conciliados no Financeiro. Previsões nunca contam.
export interface ConfirmedReceipt {id:string;amount:number;date:string;name:string;source:'financeiro'|'cliente'}
export function confirmedReceipts(s:FinanceSnapshot,asOf=todaySP()):ConfirmedReceipt[] {
 const entries=new Map(s.records.filter(r=>r.kind==='entry').map(r=>[r.id,r]));
 const fromSettlements=s.records.filter(r=>r.kind==='settlement'&&r.data.confirmed===true&&r.data.date<=asOf).flatMap(r=>{
  const e=entries.get(r.data.targetId);
  if(!e||e.data.direction!=='in'||e.data.category!=='receita'||e.data.status==='cancelado'||e.data.clientId||r.data.amount<=0)return [];
  return [{id:`finance:${r.id}`,amount:r.data.amount as number,date:r.data.date as string,name:e.data.name as string,source:'financeiro' as const}];
 });
 const fromClients=s.payments.filter(p=>p.finance_operation&&p.finance_account_id&&Number(p.amount)>0&&p.paid_at<=asOf).map(p=>({id:`client:${p.id}`,amount:cents(Number(p.amount)),date:p.paid_at,name:'Recebimento de cliente',source:'cliente' as const}));
 return [...fromSettlements,...fromClients];
}
export function confirmedByMonth(s:FinanceSnapshot,asOf=todaySP()) {
 const map=new Map<string,number>();
 for(const r of confirmedReceipts(s,asOf))map.set(r.date.slice(0,7),(map.get(r.date.slice(0,7))??0)+r.amount);
 return [...map].sort(([a],[b])=>a.localeCompare(b)).map(([month,amount])=>({month,amount}));
}
/** Confirmed paid business expenses (no personal/transfer), one row per settlement, amounts in cents. */
export function settledExpenseItems(s:FinanceSnapshot,asOf=todaySP()):{date:string;amount:number}[] {
 const entries=new Map(s.records.filter(r=>r.kind==='entry').map(r=>[r.id,r]));
 return s.records.filter(r=>r.kind==='settlement'&&r.data.confirmed===true&&r.data.date<=asOf).flatMap(r=>{
  const e=entries.get(r.data.targetId);
  if(!e||e.data.direction!=='out'||e.data.status==='cancelado'||e.data.category==='pessoal'||e.data.category==='transferencia'||r.data.amount<=0)return [];
  return [{date:r.data.date as string,amount:r.data.amount as number}];
 });
}
export function settledExpensesByMonth(s:FinanceSnapshot,asOf=todaySP()) {
 const map=new Map<string,number>();
 for(const r of settledExpenseItems(s,asOf))map.set(r.date.slice(0,7),(map.get(r.date.slice(0,7))??0)+r.amount);
 return [...map].sort(([a],[b])=>a.localeCompare(b)).map(([month,amount])=>({month,amount}));
}
export function revenueStats(s:FinanceSnapshot,asOf=todaySP()) {
 const months=confirmedByMonth(s,asOf);
 const currentMonth=asOf.slice(0,7);
 const d=new Date(`${currentMonth}-01T12:00:00Z`);d.setUTCMonth(d.getUTCMonth()-1);const previousMonth=d.toISOString().slice(0,7);
 const current=months.find(m=>m.month===currentMonth)?.amount??0;
 const previous=months.find(m=>m.month===previousMonth)?.amount??0;
 const accumulated=months.reduce((n,m)=>n+m.amount,0);
 const average=months.length?Math.round(accumulated/months.length):0;
 const best=months.reduce<{month:string;amount:number}|null>((b,m)=>!b||m.amount>b.amount?m:b,null);
 const growth=previous>0?(current-previous)/previous*100:null;
 const expenses=settledExpensesByMonth(s,asOf).find(m=>m.month===currentMonth)?.amount??0;
 return {months,current,previous,accumulated,average,best,growth,expenses,hasData:months.length>0};
}
export function delinquency(s:FinanceSnapshot,asOf=todaySP()) {
 const rows=ledger(s).filter(r=>r.direction==='in');
 const pending=rows.filter(r=>r.remaining>0);
 const overdueRows=pending.filter(r=>r.status==='atrasado_informado'||!!r.dueDate&&r.dueDate<asOf);
 const nextWeek=pending.filter(r=>!!r.dueDate&&r.dueDate>=asOf&&r.dueDate<=addDays(asOf,7));
 const confirmed=confirmedReceipts(s,asOf).filter(r=>r.date.slice(0,7)===asOf.slice(0,7)).reduce((n,r)=>n+r.amount,0);
 const clientIds=new Set(overdueRows.map(r=>r.source==='cliente'?r.id:null).filter(Boolean));
 const clientNames=new Set(overdueRows.filter(r=>r.source==='cliente').map(r=>r.name));
 return {previstos:pending.reduce((n,r)=>n+r.remaining,0),confirmados:confirmed,atrasados:overdueRows.length,totalAtraso:overdueRows.reduce((n,r)=>n+r.remaining,0),proximos:nextWeek.length,clientesPendentes:clientNames.size||clientIds.size};
}
export interface RecurringSeries {key:string;name:string;clientId:string|null;service:string;paymentMethod:string;contractStatus:string;frequency:string;amount:number;nextDue:string|null;occurrences:number;pending:number;entries:FinanceRecord[]}
export function recurringSeries(s:FinanceSnapshot,asOf=todaySP()):RecurringSeries[] {
 const groups=new Map<string,FinanceRecord[]>();
 for(const r of s.records.filter(r=>r.kind==='entry'&&r.data.direction==='in'&&r.data.seriesKey)){
  const list=groups.get(r.data.seriesKey)??[];list.push(r);groups.set(r.data.seriesKey,list);
 }
 return [...groups].map(([key,entries])=>{
  const sorted=entries.slice().sort((a,b)=>(a.data.dueDate??'').localeCompare(b.data.dueDate??''));
  const first=sorted[0];
  const pendingEntries=sorted.filter(r=>r.data.status!=='cancelado'&&settledFor(s.records,r.id)<r.data.amount);
  const next=sorted.find(r=>r.data.status!=='cancelado'&&r.data.dueDate&&r.data.dueDate>=asOf&&settledFor(s.records,r.id)<r.data.amount);
  const active=sorted.find(r=>r.data.status!=='cancelado');
  return {key,name:first.data.name,clientId:first.data.clientId??null,service:first.data.service??'',paymentMethod:first.data.paymentMethod??'',contractStatus:active?.data.contractStatus??'ativa',frequency:first.data.recurrence?.frequency??'unica',amount:first.data.amount,nextDue:next?.data.dueDate??null,occurrences:entries.length,pending:pendingEntries.length,entries:sorted};
 }).sort((a,b)=>(a.nextDue??'9999').localeCompare(b.nextDue??'9999'));
}

// Importação de histórico (preparação): parser CSV "data;valor;descrição" e
// detecção de duplicidades contra liquidações e pagamentos já registrados.
export interface ImportRow {line:number;date:string;amount:number;description:string;duplicate:boolean;error:string|null}
export function parseFinanceImport(text:string):ImportRow[] {
 return text.split(/\r?\n/).map((raw,i)=>({raw:raw.trim(),i})).filter(({raw,i})=>raw&&!(i===0&&/data|valor|descri/i.test(raw)&&!/;\s*\d/.test(raw))).map(({raw,i})=>{
  const parts=raw.split(/[;\t]/).map(p=>p.trim());
  const base={line:i+1,date:'',amount:0,description:'',duplicate:false};
  if(parts.length<2)return {...base,error:'Linha incompleta: use data;valor;descrição.'};
  const [d,v,...rest]=parts;
  const m=d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)??d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m)return {...base,error:'Data inválida: use DD/MM/AAAA.'};
  const date=m[1].length===4?`${m[1]}-${m[2]}-${m[3]}`:`${m[3]}-${m[2]}-${m[1]}`;
  if(Number.isNaN(Date.parse(date)))return {...base,error:'Data inválida: use DD/MM/AAAA.'};
  const parsed=Number(v.replace(/[^\d,.-]/g,'').replace(/\.(?=\d{3}\b)/g,'').replace(',','.'));
  if(!Number.isFinite(parsed)||parsed<=0||parsed>100000000)return {...base,error:'Valor inválido.'};
  const amount=Math.round(parsed*100);
  const description=rest.join(' ').slice(0,300)||'Recebimento importado';
  return {line:i+1,date,amount,description,duplicate:false,error:null};
 });
}
export function detectImportDuplicates(rows:ImportRow[],s:FinanceSnapshot):ImportRow[] {
 const known=new Set<string>();
 for(const r of s.records.filter(r=>r.kind==='settlement'))known.add(`${r.data.date}|${r.data.amount}`);
 for(const p of s.payments)known.add(`${p.paid_at}|${cents(Number(p.amount))}`);
 const seen=new Set<string>();
 return rows.map(r=>{
  if(r.error)return r;
  const key=`${r.date}|${r.amount}`;
  const duplicate=known.has(key)||seen.has(key);
  seen.add(key);
  return {...r,duplicate};
 });
}