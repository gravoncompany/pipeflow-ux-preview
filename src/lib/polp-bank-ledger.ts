// Movimentação bancária (Polp/Nubank PJ) já persistida pela Fase 1, para as caixas do Financeiro.
// Somente leitura: não cria nem altera lançamentos manuais, faturamento ou Universe. Lógica pura e compartilhada.

export type LedgerPeriod='mes_atual'|'mes_anterior'|'ultimos_30'|'ano_atual'|'ano_anterior';
export const LEDGER_PERIODS:{value:LedgerPeriod;label:string}[]=[
 {value:'mes_atual',label:'Mês atual'},{value:'mes_anterior',label:'Mês anterior'},{value:'ultimos_30',label:'Últimos 30 dias'},
 {value:'ano_atual',label:'Ano atual'},{value:'ano_anterior',label:'Ano anterior'},
];
const SP_OFFSET='-03:00'; // America/Sao_Paulo (sem horário de verão desde 2019)
const pad=(n:number)=>String(n).padStart(2,'0');
// Data civil em São Paulo para um instante.
export function spDate(now:number):{y:number;m:number;d:number}{
 const t=new Date(now-3*60*60*1000);
 return {y:t.getUTCFullYear(),m:t.getUTCMonth()+1,d:t.getUTCDate()};
}
const startOf=(y:number,m:number,d=1)=>new Date(`${y}-${pad(m)}-${pad(d)}T00:00:00${SP_OFFSET}`).toISOString();
// Intervalo [from, to) em ISO, alinhado ao calendário de São Paulo.
export function periodRange(period:LedgerPeriod,now:number):{from:string;to:string}{
 const {y,m,d}=spDate(now);
 const next=(yy:number,mm:number)=>mm===12?[yy+1,1]:[yy,mm+1];
 if(period==='mes_atual'){const [ny,nm]=next(y,m);return {from:startOf(y,m),to:startOf(ny,nm)};}
 if(period==='mes_anterior'){const [py,pm]=m===1?[y-1,12]:[y,m-1];return {from:startOf(py,pm),to:startOf(y,m)};}
 if(period==='ano_atual')return {from:startOf(y,1),to:startOf(y+1,1)};
 if(period==='ano_anterior')return {from:startOf(y-1,1),to:startOf(y,1)};
 const end=new Date(startOf(y,m,d));end.setUTCDate(end.getUTCDate()+1);
 const start=new Date(end);start.setUTCDate(start.getUTCDate()-30);
 return {from:start.toISOString(),to:end.toISOString()};
}

export type LedgerRow={id:string;transactionAt:string|null;description:string|null;amountCents:number|null;currency:string;direction:'CREDITO'|'DEBITO'|null;
 accountSuffix:string|null;category:string|null;type:string|null;counterparty:string|null};
export type LedgerSummary={incomeCents:number;expenseCents:number;netCents:number;counted:number;excluded:number;pendingReconciliation:number};
// Entradas = CREDITO, saídas = DEBITO; só BRL com valor e sentido válidos entram nos totais (módulo do valor).
// Ainda não há conciliação (Fase 3): toda movimentação considerada fica pendente de conciliação.
export function summarizeLedger(rows:LedgerRow[]):LedgerSummary{
 let income=0,expense=0,counted=0,excluded=0;
 for(const r of rows){
  if(r.amountCents===null||!Number.isSafeInteger(r.amountCents)||!r.direction||r.currency!=='BRL'){excluded++;continue;}
  if(r.direction==='CREDITO')income+=Math.abs(r.amountCents);else expense+=Math.abs(r.amountCents);
  counted++;
 }
 return {incomeCents:income,expenseCents:expense,netCents:income-expense,counted,excluded,pendingReconciliation:counted};
}
// Categoria só quando informada pela Polp (category_ref); nunca inventada.
export function categoryLabel(ref:string|null|undefined):string|null{
 if(!ref)return null;
 const words=ref.toLowerCase().split('_').filter(Boolean);
 if(!words.length)return null;
 const text=words.join(' ');
 return text.charAt(0).toUpperCase()+text.slice(1);
}
// Sincronização automática ao abrir o Financeiro: somente se não houver execução recente (padrão 6 h).
export const AUTO_SYNC_INTERVAL_MS=6*60*60*1000;
export function shouldAutoSync(lastSuccessAt:string|null,lastRunStatus:string|null,now:number):boolean{
 if(lastRunStatus==='running')return false;
 if(!lastSuccessAt)return true;
 const t=Date.parse(lastSuccessAt);
 return Number.isNaN(t)||now-t>=AUTO_SYNC_INTERVAL_MS;
}
