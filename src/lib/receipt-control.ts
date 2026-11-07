import { z } from "zod";
import { addDays, todaySP, type Charge, type ClientPayment } from "./finance-management";
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10)===v);
export const receiptConfig = z.object({ description:z.string().trim().min(2).max(300),amount:z.number().int().positive().max(10000000000),frequency:z.enum(["mensal","quinzenal_fixa","quinzenal","semanal"]),start:date,end:date,day1:z.number().int().min(1).max(31),day2:z.number().int().min(1).max(31),method:z.string().max(120) }).strict().refine(v=>v.end>=v.start&&Date.parse(v.end)-Date.parse(v.start)<=370*86400000,"Selecione até 370 dias.").refine(v=>v.frequency!=="quinzenal_fixa"||v.day1<v.day2,"O segundo vencimento deve ser depois do primeiro.");
export type ReceiptConfig = z.infer<typeof receiptConfig>;
export type ReceiptStatus = "pago"|"pendente"|"atrasado"|"parcial"|"conciliacao";
export const RECEIPT_LABELS:Record<ReceiptStatus,string> = {pago:"Pago",pendente:"Pendente",atrasado:"Atrasado",parcial:"Parcialmente pago",conciliacao:"Aguardando conciliação"};
export type ReceiptCharge = Charge & { recurrence:string;project_id?:string|null;receipt_schedule_id?:string|null;payment_method?:string|null;notes?:string|null };
export type ReceiptRow = ReceiptCharge & { amountCents:number;received:number;remaining:number;statusLabel:ReceiptStatus;overdue:boolean;payments:ClientPayment[] };
export function scheduleDates(c:ReceiptConfig) {
 const result:string[]=[];
 for(let d=c.start;d<=c.end;d=addDays(d,1)) {
  const day=Number(d.slice(8));const last=new Date(Date.UTC(Number(d.slice(0,4)),Number(d.slice(5,7)),0)).getUTCDate();
  const elapsed=Math.round((Date.parse(d)-Date.parse(c.start))/86400000);
  if(c.frequency==="semanal"?elapsed%7===0:c.frequency==="quinzenal"?elapsed%14===0:day===Math.min(c.day1,last)||(c.frequency==="quinzenal_fixa"&&day===Math.min(c.day2,last))) result.push(d);
 }
 return result;
}
export function receiptRows(charges:ReceiptCharge[],payments:ClientPayment[],waitingClients:Set<string>=new Set(),asOf=todaySP()):ReceiptRow[] {
 const seen=new Set<string>();const valid=payments.filter(p=>!seen.has(p.id)&&(seen.add(p.id),true)&&p.paid_at<=asOf);
 return charges.filter(c=>c.status!=="cancelado").map(c=>{
  const ps=valid.filter(p=>p.charge_id===c.id);const amountCents=Math.round(Number(c.amount)*100);const received=ps.reduce((s,p)=>s+Math.round(Number(p.amount)*100),0);const remaining=Math.max(0,amountCents-received);const overdue=remaining>0&&c.due_date<asOf;
  const statusLabel:ReceiptStatus = remaining===0?"pago":received>0?"parcial":waitingClients.has(c.client_id)?"conciliacao":overdue?"atrasado":"pendente";
  return {...c,amountCents,received,remaining,overdue,statusLabel,payments:ps};
 });
}
export function receiptSummary(rows:ReceiptRow[]) {
 const expected=rows.reduce((n,r)=>n+r.amountCents,0),received=rows.reduce((n,r)=>n+r.received,0),pending=rows.reduce((n,r)=>n+r.remaining,0),overdue=rows.filter(r=>r.overdue).reduce((n,r)=>n+r.remaining,0);
 return {expected,received,pending,overdue,percent:expected?Math.round(received/expected*1000)/10:0};
}

/** Columns are actual ordered due dates per client, not fixed calendar buckets.
 * Build from unfiltered period rows so filtering never renumbers a due date. */
export function receiptMonthGrid(rows:ReceiptRow[],month:string,recurrence:string) {
 const unique=new Map(rows.filter(r=>r.due_date.startsWith(`${month}-`)&&r.recurrence===recurrence).map(r=>[r.id,r]));
 const clients=new Map<string,ReceiptRow[]>();
 for(const row of unique.values()) clients.set(row.client_id,[...(clients.get(row.client_id)??[]),row]);
 const groups=[...clients].map(([clientId,list])=>{
  const dates=[...new Set(list.map(r=>r.due_date))].sort();
  return {clientId,cells:dates.map(date=>list.filter(r=>r.due_date===date).sort((a,b)=>a.id.localeCompare(b.id)))};
 });
 return {groups,columnCount:Math.max(0,...groups.map(g=>g.cells.length))};
}

/** Annual grid: one row per client, twelve fixed month cells (Jan–Dec). */
export function receiptYearGrid(rows:ReceiptRow[],year:number,recurrence:string) {
 const prefix=`${year}-`;
 const unique=new Map(rows.filter(r=>r.due_date.startsWith(prefix)&&r.recurrence===recurrence).map(r=>[r.id,r]));
 const clients=new Map<string,ReceiptRow[]>();
 for(const row of unique.values()) clients.set(row.client_id,[...(clients.get(row.client_id)??[]),row]);
 const groups=[...clients].map(([clientId,list])=>{
  const cells:ReceiptRow[][]=Array.from({length:12},()=>[]);
  for(const r of list) cells[Number(r.due_date.slice(5,7))-1].push(r);
  for(const cell of cells) cell.sort((a,b)=>a.due_date.localeCompare(b.due_date)||a.id.localeCompare(b.id));
  return {clientId,cells};
 });
 return {groups,columnCount:12};
}