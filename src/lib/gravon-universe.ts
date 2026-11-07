import { z } from 'zod';
import { todaySP } from './finance-management';
import type { Json } from '@/integrations/supabase/types';
export const MONTHLY_TARGETS = [20000,30000,40000,50000,75000,100000,150000,250000,500000,1000000].map(v=>v*100);
export const LIFETIME_TARGETS = [100000,250000,500000,1000000,2000000,5000000,10000000].map(v=>v*100);
export type Journey = 'monthly'|'lifetime';
export interface UniverseReceipt {id:string;amount:number;date:string;description:string;origin:string;reference:string;status:'pendente'|'confirmada'|'cancelada';revision:number;editable:boolean}
export interface UniverseAward {journey:Journey;amount:number;period:string;awarded_at:string;evidence_total:number}
export interface UniverseSnapshot {receipts:UniverseReceipt[];awards:UniverseAward[];targets:Record<Journey,number[]>;settingsRevision:number;audit:{id:string;created_at:string;reason:string;before_data:Json;after_data:Json}[];asOf:string}
const money=z.number().int().positive().max(100_000_000_000);
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v,'Data inválida');
export const receiptFields=z.object({amount:money,date,description:z.string().trim().min(2).max(300),origin:z.string().trim().min(2).max(160),reference:z.string().trim().min(2).max(160).regex(/^[\p{L}\p{N} ._\/-]+$/u),status:z.enum(['pendente','confirmada','cancelada'])}).strict().superRefine((v,c)=>{if(v.status==='confirmada'&&v.date>todaySP())c.addIssue({code:'custom',path:['date'],message:'Receita futura deve permanecer pendente.'});});
export const receiptInput=z.object({id:z.string().uuid().nullable(),revision:z.number().int().min(0),event:z.string().uuid(),reason:z.string().trim().min(3).max(1000),fields:receiptFields,checked:z.literal(true)}).strict();
const targets=z.array(money).min(1).max(20).refine(a=>a.every((v,i)=>i===0||v>a[i-1]),'Metas devem estar em ordem crescente e sem repetição');
export const targetInput=z.object({monthly:targets,lifetime:targets,revision:z.number().int().min(0),event:z.string().uuid(),reason:z.string().trim().min(3).max(1000)}).strict();
export function universeMetrics(receipts:UniverseReceipt[],asOf=todaySP()) {
 const eligible=receipts.filter(r=>r.status==='confirmada'&&r.date<=asOf);
 const map=new Map<string,number>();for(const r of eligible)map.set(r.date.slice(0,7),(map.get(r.date.slice(0,7))??0)+r.amount);
 const months=[...map].sort(([a],[b])=>a.localeCompare(b)).map(([month,amount])=>({month,amount}));
 const currentMonth=asOf.slice(0,7);const d=new Date(`${currentMonth}-01T12:00:00Z`);d.setUTCMonth(d.getUTCMonth()-1);const previous=map.get(d.toISOString().slice(0,7))??0;
 const current=map.get(currentMonth)??0;return {months,current,previous,growth:previous>0?(current-previous)/previous*100:null,record:Math.max(0,...months.map(m=>m.amount)),accumulated:eligible.reduce((s,r)=>s+r.amount,0),hasData:eligible.length>0};
}
export function journeyProgress(journey:Journey,targets:number[],awards:UniverseAward[],metrics:ReturnType<typeof universeMetrics>) {
 const value=journey==='monthly'?metrics.record:metrics.accumulated;
 const next=targets.find(t=>!awards.some(a=>a.journey===journey&&a.amount===t)&&t>value)??null;
 return {value,next,percent:next?Math.min(100,Math.floor(value/next*100)):targets.length?100:0};
}
export function expectedAwards(receipts:UniverseReceipt[],targets:Record<Journey,number[]>,asOf:string):Omit<UniverseAward,'awarded_at'>[] {
 const m=universeMetrics(receipts,asOf);let accumulated=0;const result:Omit<UniverseAward,'awarded_at'>[]=[];
 for(const row of m.months){accumulated+=row.amount;for(const journey of ['monthly','lifetime'] as const)for(const amount of targets[journey])if((journey==='monthly'?row.amount:accumulated)>=amount&&!result.some(a=>a.journey===journey&&a.amount===amount))result.push({journey,amount,period:row.month,evidence_total:journey==='monthly'?row.amount:accumulated});}return result;
}
export const universeMoney=(cents:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:2}).format(cents/100);
export const shortMoney=(cents:number)=>cents>=100000000?`R$ ${cents/100000000} mi`:`R$ ${cents/100000} mil`;