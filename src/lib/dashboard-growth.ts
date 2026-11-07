import { contractActive, contractMrr, parseManagement, type CsManagement } from './customer-success-management';
import { presetRange, type Metric, ok, unavailable } from './dashboard';
export type GrowthClient = { id: string; status: string; created_at: string; management: unknown; updated_at: string | null };
export type GrowthHistory = { id: string; client_id: string; created_at: string; before_state: unknown; after_state: unknown };
const missing = () => unavailable('Dados insuficientes: faltam contratos ou histórico comparável.');
const dayOf = (v: string) => new Date(v).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
function managementOf(v: unknown): CsManagement | null {
  if (!v || typeof v !== 'object' || !('management' in v)) return null;
  const parsed = (() => { try { return parseManagement(v.management); } catch { return null; } })();
  return parsed;
}
function snapshot(c: GrowthClient, history: GrowthHistory[], day: string, today: string) {
  if (dayOf(c.created_at) > day) return { mrr: 0, active: false, recurring: false, terminal: false };
  const observed = history.filter(h => h.client_id === c.id && dayOf(h.created_at) <= day).sort((a,b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  // Current records cannot be projected into an unobserved past.
  const m = day === today ? managementOf({ management: c.management }) : managementOf(observed[0]?.after_state);
  if (!m || !m.contracts.length) return null;
  const activeContracts = m.contracts.filter(x => contractActive(x, day));
  const closed = m.accountStatus === 'encerrado' || (day === today && c.status === 'encerrado');
  const mrr = closed ? 0 : contractMrr(m.contracts, day) / 100;
  return { mrr, active: !closed && activeContracts.length > 0, recurring: mrr > 0, terminal: closed || m.contracts.every(x => ['cancelado','encerrado'].includes(x.status)) };
}
export function growthMetrics(clients: GrowthClient[], history: GrowthHistory[], from: string, to: string, today: string) {
  const unique = [...new Map(clients.map(c => [c.id,c])).values()];
  const end = unique.map(c => ({ c, s: snapshot(c, history, to, today) }));
  const hasContracts = unique.some(c => { const m = managementOf({management:c.management}); return Boolean(m?.contracts.length); });
  // Recurring agreements count even when other clients have none registered yet; coverage is reported.
  const complete = hasContracts && end.some(x => x.s !== null);
  const covered = end.filter(x => x.s !== null).length;
  const scope = covered < end.length ? ` Considera ${covered} de ${end.length} clientes com acordo registrado.` : '';
  const total = end.reduce((n,x) => n + (x.s?.mrr ?? 0),0);
  const active = end.filter(x => x.s?.active).length;
  const recurring = end.filter(x => x.s?.recurring).length;
  const base = unique.map(c => ({ c, s: snapshot(c, history, from, today) }));
  const cohort = base.filter(x => x.s?.active);
  const cohortEnd = cohort.map(x => end.find(e => e.c.id === x.c.id)?.s);
  const comparable = cohort.length > 0 && cohortEnd.every(s => s && (s.active || s.terminal));
  const retention = comparable ? ok(cohortEnd.filter(s => s?.active).length / cohort.length * 100, `${cohort.length} clientes ativos no início; contratos registrados.`) : missing();
  const churn = comparable ? ok(cohortEnd.filter(s => s?.terminal).length / cohort.length * 100, 'Cancelamentos/encerramentos da carteira inicial.') : missing();
  const startMrr = cohort.reduce((n,x) => n + (x.s?.mrr ?? 0), 0);
  const endMrr = cohortEnd.reduce((n,s) => n + (s?.mrr ?? 0), 0);
  const nrr = comparable && startMrr > 0 ? ok(endMrr / startMrr * 100, 'MRR atual da carteira inicial ÷ MRR inicial dela (inclui expansão, reduções e cancelamentos; exclui clientes novos).') : missing();
  const lost = comparable ? ok(cohortEnd.filter(s => s?.terminal).length, 'Clientes da carteira inicial cancelados/encerrados no período.') : missing();
  let expansion = 0;
  const changes: { clientId: string; date: string; delta: number }[] = [];
  for (const h of history) {
    const date = dayOf(h.created_at);
    if (date < from || date > to || !cohort.some(x => x.c.id === h.client_id)) continue;
    const before = managementOf(h.before_state), after = managementOf(h.after_state);
    if (!before || !after || before.accountStatus === 'encerrado' || after.accountStatus === 'encerrado') continue;
    const delta = (contractMrr(after.contracts,date) - contractMrr(before.contracts,date)) / 100;
    if (delta !== 0) changes.push({clientId:h.client_id,date,delta});
    if (delta > 0) expansion += delta;
  }
  const metrics: Record<'mrr'|'arr'|'active'|'ticket'|'retention'|'churn'|'expansion'|'nrr'|'lost',Metric> = {
    nrr, lost,
    mrr: complete ? ok(total,`Recorrência mensal contratada (inclui acordos sem contrato formal); não é receita recebida.${scope}`) : missing(),
    arr: complete ? ok(total * 12,`Projeção anual da MRR × 12.${scope}`) : missing(),
    active: complete ? ok(active,'Clientes únicos com contrato ativo; encerrados excluídos.') : missing(),
    ticket: complete && recurring > 0 ? ok(total / recurring, `${recurring} clientes ativos com recorrência.`) : missing(),
    retention,churn,expansion: comparable ? ok(expansion,'Aumentos de MRR auditados da carteira inicial; não são recebimentos.') : missing(),
  };
  const series = [];
  for (let month = from.slice(0,7); month <= to.slice(0,7);) {
    const next = new Date(`${month}-01T12:00:00Z`); next.setUTCMonth(next.getUTCMonth()+1);
    const last = new Date(next.getTime()-86400000).toISOString().slice(0,10);
    const date = last < to ? last : to;
    const monthFrom = `${month}-01` < from ? from : `${month}-01`;
    const states = unique.map(c => snapshot(c,history,date,today));
    const prev = unique.map(c => snapshot(c,history,new Date(Date.parse(`${monthFrom}T12:00:00Z`)-86400000).toISOString().slice(0,10),today));
    const full = hasContracts && states.some(s => s !== null);
    const pair = full && prev.every(s => s !== null);
    const mrr = states.reduce((n,s) => n+(s?.mrr ?? 0),0), count = states.filter(s => s?.recurring).length;
    series.push({month, mrr: full ? mrr : null, clients: full ? states.filter(s=>s?.active).length : null, ticket: full && count ? mrr/count : null,
      expansion: comparable ? changes.filter(c=>c.date>=monthFrom && c.date<=date && c.delta>0).reduce((n,c)=>n+c.delta,0) : null,
      won: pair ? states.filter((s,i)=>s?.active && !prev[i]?.active).length : null,
      lost: pair ? states.filter((s,i)=>s?.terminal && prev[i]?.active).length : null});
    month = next.toISOString().slice(0,7);
  }
  return { period:{from,to}, metrics, series, changes, coverage:{ clients:unique.length, withContracts:end.filter(x=>x.s).length }, topClients: end.filter(x => (x.s?.mrr ?? 0) > 0).sort((a,b) => (b.s?.mrr ?? 0) - (a.s?.mrr ?? 0)).slice(0,10).map(x => ({ id: x.c.id, mrr: x.s?.mrr ?? 0 })), asOf:to };
}
export type GrowthData = ReturnType<typeof growthMetrics>;
export function growthPeriod(p: '30d'|'90d'|'6m'|'12m', today: string) {
  if (p === '30d' || p === '90d') return presetRange(p,today);
  const d = new Date(`${today}T12:00:00Z`), originalDay=d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth()-(p==='6m'?6:12));
  const max = new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();
  d.setUTCDate(Math.min(originalDay,max)); d.setUTCDate(d.getUTCDate()+1);
  return {from:d.toISOString().slice(0,10),to:today};
}
