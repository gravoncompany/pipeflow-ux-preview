import { canPersonal, type FinanceRecord, type FinanceSnapshot } from './finance-management';
import {getRequest,setResponseHeader} from '@tanstack/react-start/server';
export async function financeAccess(personal:boolean) {
 const request=getRequest();
 if(request.headers.get('origin')!==new URL(request.url).origin)throw new Error('Origem não autorizada.');
 setResponseHeader('Cache-Control','no-store');
 const {requireClientsSession}=await import('./crm-clients.server');
 const db=await requireClientsSession();
 const {getPortalAccount}=await import('./gravon-portal-admin.server');
 const account=await getPortalAccount();
 if(personal&&(!account||!canPersonal(true,account.authorized,account.userId,account.userId)))throw new Error('Entre com sua conta administrativa verificada para acessar o financeiro pessoal.');
 return {db,scope:personal?`personal:${account?.userId}`:'crm:1',actor:account?.authorized?account.userId:'Gestor comercial',personalAllowed:account?.authorized===true};
}
export async function readManagement(personal:boolean):Promise<FinanceSnapshot> {
 const {db,scope,personalAllowed}=await financeAccess(personal);
 async function all(table:'finance_records'|'finance_audit'|'crm_client_charges'|'crm_client_payments'|'crm_clients',columns='*') {
  const rows:any[]=[];
  for(let offset=0;offset<10000;offset+=500){const q=table==='finance_records'||table==='finance_audit'?db.from(table).select(columns).eq('scope',scope).order('id').range(offset,offset+499):db.from(table).select(columns).order('id').range(offset,offset+499);const {data,error}=await q;if(error)throw new Error('Não foi possível carregar os registros financeiros.');rows.push(...(data??[]));if((data?.length??0)<500)return rows;}
  throw new Error('Volume financeiro excede a consulta segura. Restrinja o período antes de continuar.');
 }
 const [records,audit,charges,payments,clients]=await Promise.all([all('finance_records'),all('finance_audit','id,action,record_id,actor,created_at'),personal?[]:all('crm_client_charges'),personal?[]:all('crm_client_payments'),personal?[]:all('crm_clients','id,trade_name')]);
 await financeAccess(personal);
 return {records:records as FinanceRecord[],audit,charges,payments,clients,personalAllowed,personal};
}