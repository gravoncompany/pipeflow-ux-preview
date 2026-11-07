import { financeAccess } from "./finance-management.server";
import type { ReceiptCharge, ReceiptConfig } from "./receipt-control";
import type { ClientPayment } from "./finance-management";
export async function readReceiptControl(gatewayKey?: string, sheetsKey?: string) {
 const {db,scope}=await financeAccess(false);
 async function all(table:string,columns="*") {
  const rows:Record<string,unknown>[]=[];
  for(let offset=0;offset<20000;offset+=500){const {data,error}=await (db as unknown as import("@supabase/supabase-js").SupabaseClient).from(table).select(columns).order(table==="polp_bank_client_links"||table==="polp_bank_reconciliations"?"polp_transaction_id":"id").range(offset,offset+499);if(error)throw new Error("Não foi possível consultar os recebimentos.");rows.push(...(data as unknown as Record<string,unknown>[]??[]));if((data?.length??0)<500)return rows;}
  throw new Error("Volume acima do limite seguro de consulta.");
 }
 const [clients,charges,payments,schedules,projects,links,recons,accounts,audit]=await Promise.all([
  all("crm_clients","id,trade_name,status"),all("crm_client_charges"),all("crm_client_payments"),all("crm_receipt_schedules"),all("crm_client_projects","id,client_id,name"),all("polp_bank_client_links"),all("polp_bank_reconciliations"),db.from("finance_records").select("id,data").eq("scope",scope).eq("kind","account"),db.from("crm_receipt_audit").select("*").order("created_at",{ascending:false}).limit(300)
 ]);
 if(accounts.error||audit.error)throw new Error("Não foi possível consultar contas e histórico.");
 const reconciled=new Set(recons.filter(r=>r.company_key===scope).map(r=>String(r.polp_transaction_id)));
 const waiting=links.filter(l=>l.company_key===scope&&!reconciled.has(String(l.polp_transaction_id)));
 const bank: {id:string;clientId:string;date:string;amount:number;description:string}[]=[];
 for(let i=0;i<waiting.length;i+=100){const batch=waiting.slice(i,i+100);const [tx,ov]=await Promise.all([db.from("polp_bank_transactions").select("polp_transaction_id,transaction_at,amount_cents,description,direction,currency").eq("company_key",scope).in("polp_transaction_id",batch.map(x=>String(x.polp_transaction_id))),db.from("polp_bank_classification_overrides").select("polp_transaction_id,kind,decision").eq("company_key",scope).in("polp_transaction_id",batch.map(x=>String(x.polp_transaction_id)))]);if(tx.error||ov.error)throw new Error("Não foi possível consultar conciliações pendentes.");for(const t of tx.data??[]){const o=ov.data?.find(o=>o.polp_transaction_id===t.polp_transaction_id);const link=batch.find(l=>l.polp_transaction_id===t.polp_transaction_id);if(o?.kind==="receita_operacional"&&t.direction==="CREDITO"&&t.currency==="BRL"&&t.transaction_at&&link)bank.push({id:t.polp_transaction_id,clientId:String(link.client_id),date:new Intl.DateTimeFormat("sv-SE",{timeZone:"America/Sao_Paulo"}).format(new Date(t.transaction_at)),amount:Number(t.amount_cents),description:t.description??"Recebimento bancário"});}}
 const { readReceiptRoster } = await import("./receipt-sheet.server");
 const roster = await readReceiptRoster(gatewayKey, sheetsKey);
 await financeAccess(false);
 return {roster:roster.rows,rosterError:roster.error,clients:clients as unknown as {id:string;trade_name:string;status:string}[],charges:charges as unknown as ReceiptCharge[],payments:payments as unknown as ClientPayment[],schedules:schedules as unknown as {id:string;client_id:string;project_id:string|null;config:ReceiptConfig;revision:number}[],projects:projects as unknown as {id:string;client_id:string;name:string}[],bank,accounts:(accounts.data??[]).map(a=>({id:a.id,name:String((a.data as {name?:string}).name??"Conta")})),audit:audit.data??[],reconciliations:recons.map(r=>({paymentId:String(r.client_payment_id??""),chargeId:String(r.charge_id??"")}))};
}