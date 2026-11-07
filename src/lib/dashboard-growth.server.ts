import { requireClientsSession } from './crm-clients.server';
import { growthMetrics } from './dashboard-growth';
import { todaySaoPaulo } from './dashboard';
import { unitEconomics } from './dashboard-unit-economics';
export async function loadGrowth(from:string,to:string) {
  const db = await requireClientsSession();
  async function all<T>(page:(a:number,b:number)=>PromiseLike<{data:T[]|null;error:unknown}>) {
    const rows:T[]=[];
    for(let a=0;a<50000;a+=500){ const r=await page(a,a+499); if(r.error || !r.data) throw new Error('Não foi possível carregar os contratos completos.'); rows.push(...r.data); if(r.data.length<500)return rows; }
    throw new Error('Carteira acima do limite seguro.');
  }
  const [clients,states,history,sales,closed] = await Promise.all([
    all((a,b)=>db.from('crm_clients').select('id,status,created_at,trade_name').order('id').range(a,b)),
    all((a,b)=>db.from('crm_customer_success').select('client_id,management,updated_at').order('client_id').range(a,b)),
    all((a,b)=>db.from('crm_cs_history').select('id,client_id,created_at,before_state,after_state').order('id').range(a,b)),
    all((a,b)=>db.from('sale_classifications').select('lead_id,customer_key,sale_type,first_acquisition,closed_on').eq('company_key','crm:1').order('id').range(a,b)),
    all((a,b)=>db.from('leads').select('id,closed_at,entry_date').eq('stage','fechado').order('id').range(a,b)),
  ]);
  const byId=new Map(states.map(s=>[s.client_id,s]));
  const result=growthMetrics(clients.map(c=>({...c,management:byId.get(c.id)?.management ?? {},updated_at:byId.get(c.id)?.updated_at ?? null})),history,from,to,todaySaoPaulo());
  const names=new Map(clients.map(c=>[c.id,c.trade_name as string|null]));
  // Same confirmed-revenue and bank-classification rules as the Financeiro page.
  const { loadClassifiedRows, loadReceipts } = await import('./bank-overview.server');
  const [{ rows }, receipts] = await Promise.all([loadClassifiedRows(db as never, from, to), loadReceipts(db as never, from, to)]);
  const classified=new Set(sales.map(s=>s.lead_id));
  const unit=unitEconomics({
    rows, receipts, from, to,
    sales: sales.map(s=>({customerKey:s.customer_key,saleType:s.sale_type,firstAcquisition:s.first_acquisition,closedOn:String(s.closed_on).slice(0,10)})),
    pendingSales:(a,b)=>closed.filter(l=>{const d=String(l.closed_at ?? l.entry_date).slice(0,10);return d>=a && d<=b && !classified.has(l.id);}).length,
    arpa: result.metrics.ticket.value, churnPct: result.metrics.churn.value,
  });
  await requireClientsSession();
  return {...result, topClients: result.topClients.map(t=>({...t,name:names.get(t.id) ?? 'Cliente'})), unit};
}
