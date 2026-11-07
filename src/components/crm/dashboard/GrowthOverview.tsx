import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { BarChart, Bar, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend } from 'recharts';
import { RefreshCw, TrendingUp, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PipeflowSymbol } from '@/components/brand/PipeflowLogo';
import { getDashboardGrowth, analyzeDashboardGrowth } from '@/lib/dashboard.functions';
import { growthPeriod } from '@/lib/dashboard-growth';
import type { Metric } from '@/lib/dashboard';
import { brl, pct, int, ChartCard, C, axis, useToday, dateBR } from './dashboard-ui';
const ratio=(v:number)=>`${v.toLocaleString('pt-BR',{maximumFractionDigits:1})}x`;
const ROWS=[
  {title:'Indicadores estratégicos',src:'unit',items:[['opReturn','Retorno sobre gastos operacionais',pct],['opMargin','Margem operacional',pct],['roi','ROI de Marketing (aquisição)',pct],['cac','CAC',null],['ltv','LTV (ajustado pela margem)',null],['ltvCac','LTV/CAC',ratio],['margin','Margem de contribuição',pct]]},
  {title:'Receita e crescimento',src:'growth',items:[['mrr','MRR',null],['arr','ARR',null],['active','Clientes ativos',int],['ticket','Ticket médio',null],['expansion','Expansão de receita',null]]},
  {title:'Retenção',src:'growth',items:[['retention','Retention Rate',pct],['churn','Churn Rate',pct],['nrr','NRR · Retenção líquida de receita',pct],['lost','Clientes perdidos',int]]},
] as const;
type Calc={formula:string;period:string;revenue:{label:string;value:number}[];costs:{label:string;value:number}[];result:string};
function CalcButton({title,calc,hero}:{title:string;calc:Calc;hero?:boolean}) {
  const sum=(xs:{value:number}[])=>xs.reduce((n,x)=>n+x.value,0);
  return <Dialog><DialogTrigger asChild><button type="button" className={`mt-2 text-xs font-medium underline underline-offset-2 ${hero?'text-primary-foreground':'text-primary'}`}>Ver cálculo</button></DialogTrigger>
    <DialogContent className="max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader><div className="space-y-4 text-sm">
      <div><p className="font-medium">Fórmula</p><p className="text-muted-foreground">{calc.formula}</p></div>
      <div><p className="font-medium">Período</p><p className="text-muted-foreground">{calc.period}</p></div>
      {calc.revenue.length>0&&<div><p className="font-medium">Receitas incluídas · {brl(sum(calc.revenue))}</p><ul className="text-muted-foreground">{calc.revenue.map(x=><li key={x.label} className="flex justify-between gap-3"><span>{x.label}</span><span className="tabular-nums">{brl(x.value)}</span></li>)}</ul></div>}
      <div><p className="font-medium">Custos e despesas incluídos · {brl(sum(calc.costs))}</p>{calc.costs.length?<ul className="text-muted-foreground">{calc.costs.map(x=><li key={x.label} className="flex justify-between gap-3"><span>{x.label}</span><span className="tabular-nums">{brl(x.value)}</span></li>)}</ul>:<p className="text-muted-foreground">Nenhum no período.</p>}</div>
      <div><p className="font-medium">Resultado</p><p className="text-muted-foreground">{calc.result}</p></div>
      <p className="text-xs text-muted-foreground">Somente lançamentos confirmados; transferências, aplicações, empréstimos e repasses não entram. Cada movimentação conta uma vez.</p>
    </div></DialogContent></Dialog>;
}
function GrowthKpi({title,m,format,primary,hero,calc}:{title:string;m:Metric;format:(v:number)=>string;primary?:boolean;hero?:boolean;calc?:Calc}) {
  return <div className={`min-w-0 rounded-lg border p-4 ${hero?'border-primary bg-primary text-primary-foreground sm:col-span-2 xl:col-span-1 xl:row-span-1':primary?'border-primary/20 bg-primary/5':'bg-card'}`}>
    <p className={`text-sm font-medium ${hero?'text-primary-foreground/80':'text-muted-foreground'}`}>{title}</p>
    <p className={`mt-2 break-words font-semibold tabular-nums ${m.value===null?`text-sm ${hero?'text-primary-foreground/80':'text-muted-foreground'}`:hero?'text-4xl':'text-2xl'}`}>{m.value===null?'Dados insuficientes':format(m.value)}</p>
    <p className={`mt-2 text-xs leading-relaxed ${hero?'text-primary-foreground/80':'text-muted-foreground'}`}>{m.note}</p>
    {calc && <CalcButton title={title} calc={calc} hero={hero}/>}
  </div>;
}
export function GrowthOverview({onNeedsAuth}:{onNeedsAuth:()=>void}) {
  const today=useToday();
  const [preset,setPreset]=useState<'30d'|'90d'|'6m'|'12m'>('30d');
  const period=today?growthPeriod(preset,today):null;
  const load=useServerFn(getDashboardGrowth), analyze=useServerFn(analyzeDashboardGrowth);
  const q=useQuery({queryKey:['dashboard-growth',period?.from,period?.to],queryFn:()=>{if(!period)throw new Error('Período inválido');return load({data:period});},enabled:!!period,staleTime:60000});
  const [analysis,setAnalysis]=useState<Awaited<ReturnType<typeof analyzeDashboardGrowth>>|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{if(q.data?.needsAuth)onNeedsAuth();},[q.data,onNeedsAuth]);
  useEffect(()=>{setAnalysis(null);setError('');},[preset]);
  const d=q.data && !q.data.needsAuth?q.data.data:null;
  const run=async()=>{if(!period || busy)return;setBusy(true);setError('');try{const r=await analyze({data:period});setAnalysis(r);}catch(e){setError(e instanceof Error?e.message:'Não foi possível analisar.');}finally{setBusy(false);}};
  const rows=d?.series.map(s=>({...s,label:new Date(`${s.month}-15T12:00:00Z`).toLocaleDateString('pt-BR',{month:'short',year:'2-digit'})})) ?? [];
  const urows=d?.unit.series.map(s=>({...s,label:new Date(`${s.month}-15T12:00:00Z`).toLocaleDateString('pt-BR',{month:'short',year:'2-digit'})})) ?? [];
  const ucharts=[{title:'Evolução do retorno sobre gastos operacionais',key:'opReturn',f:pct},{title:'Evolução do CAC',key:'cac',f:brl},{title:'Evolução do LTV/CAC',key:'ltvCac',f:ratio},{title:'Evolução da margem de contribuição',key:'margin',f:pct}] as const;
  const charts=[{title:'Crescimento mensal do MRR',key:'mrr',money:true},{title:'Evolução da carteira de clientes',key:'clients',money:false},{title:'Evolução do ticket médio',key:'ticket',money:true},{title:'Receita de expansão',key:'expansion',money:true}] as const;
  return <section className="space-y-6" aria-label="Crescimento estratégico">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="flex items-center gap-2 text-lg font-semibold"><TrendingUp className="size-5 text-primary"/>Inteligência financeira e comercial</h2>{period && <p className="mt-1 text-xs text-muted-foreground">{dateBR(period.from)} a {dateBR(period.to)}</p>}</div>
      <div className="flex items-center gap-2"><Select value={preset} disabled={busy} onValueChange={v=>setPreset(v as typeof preset)}><SelectTrigger aria-label="Período de crescimento" className="w-44 bg-card"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="30d">Últimos 30 dias</SelectItem><SelectItem value="90d">Últimos 90 dias</SelectItem><SelectItem value="6m">Últimos 6 meses</SelectItem><SelectItem value="12m">Últimos 12 meses</SelectItem></SelectContent></Select><Button aria-label="Atualizar crescimento" title="Atualizar crescimento" variant="outline" size="icon" disabled={busy} onClick={()=>{setAnalysis(null);void q.refetch();}}><RefreshCw className={q.isFetching?'animate-spin':''}/></Button></div>
    </div>
    {q.isError && <p role="alert" className="text-sm text-destructive">{q.error.message}</p>}
    {!d?<p className="py-8 text-sm text-muted-foreground">Carregando contratos…</p>:<>
      {ROWS.map((row,ri)=><div key={row.title} className="space-y-2"><h3 className="text-sm font-semibold text-muted-foreground">{ri+1}. {row.title}</h3><div className={`grid gap-3 sm:grid-cols-2 ${row.items.length>=5?'xl:grid-cols-4':'xl:grid-cols-4'}`}>{row.items.map(([key,title,fmt])=>{const m=(row.src==='unit'?d.unit.metrics:d.metrics)[key as never] as Metric;return <GrowthKpi key={key} title={title} m={m} hero={key==='opReturn'} calc={row.src==='unit'?d.unit.calc[key as keyof typeof d.unit.calc]:undefined} primary={ri===0||key==='mrr'||key==='arr'} format={fmt ?? brl}/>;})}</div></div>)}
      <p className="text-xs text-muted-foreground">Fontes do período: receita confirmada {brl(d.unit.sources.revenue)} · custos variáveis (fornecedores/terceiros e impostos) {brl(d.unit.sources.variableCosts)} · custos e despesas operacionais totais {brl(d.unit.sources.opExpense)} · marketing e tráfego pago {brl(d.unit.sources.acquisition)} · clientes novos {d.unit.sources.newCustomers ?? 'pendente de classificação'}. Transferências, aplicações, empréstimos e repasses (inclusive HyperCash) não entram como receita.</p>
      <p className="text-xs text-muted-foreground">Contratos registrados: {d.coverage.withContracts} de {d.coverage.clients} clientes · Posição em {dateBR(d.asOf)} · Receita contratada, não recebimentos.</p>
      <div className="grid gap-4 lg:grid-cols-2">{ucharts.map(c=><ChartCard key={c.key} title={c.title} note="Por mês, com dados confirmados do Financeiro; meses sem dados ficam em branco.">{urows.some(r=>r[c.key]!==null)?<LineChart data={urows}><CartesianGrid stroke="var(--border)" vertical={false}/><XAxis dataKey="label" {...axis}/><YAxis {...axis} width={70} tickFormatter={v=>c.f(Number(v))}/><Tooltip formatter={v=>c.f(Number(v))}/><Line dataKey={c.key} name={c.title} stroke={C[0]} strokeWidth={2} dot={{r:4}} connectNulls={false}/></LineChart>:<div className="flex h-full items-center justify-center text-sm text-muted-foreground">Dados insuficientes</div>}</ChartCard>)}</div>
      <div className="grid gap-4 lg:grid-cols-2">{charts.map(c=><ChartCard key={c.key} title={c.title} note="Posições mensais registradas; sem projeção de histórico ausente.">{rows.some(r=>r[c.key]!==null)?<LineChart data={rows}><CartesianGrid stroke="var(--border)" vertical={false}/><XAxis dataKey="label" {...axis}/><YAxis {...axis} width={70} tickFormatter={v=>c.money?brl(v):int(v)}/><Tooltip formatter={v=>c.money?brl(Number(v)):int(Number(v))}/><Line dataKey={c.key} name={c.title} stroke={C[0]} strokeWidth={2} dot={{r:4}} connectNulls={false}/></LineChart>:<div className="flex h-full items-center justify-center text-sm text-muted-foreground">Dados insuficientes</div>}</ChartCard>)}
      <ChartCard title="Clientes conquistados versus cancelados" note="Clientes únicos com alterações contratuais registradas.">{rows.some(r=>r.won!==null)?<BarChart data={rows}><CartesianGrid stroke="var(--border)" vertical={false}/><XAxis dataKey="label" {...axis}/><YAxis {...axis} allowDecimals={false}/><Tooltip/><Legend/><Bar dataKey="won" name="Conquistados" fill={C[0]}/><Bar dataKey="lost" name="Cancelados" fill={C[1]}/></BarChart>:<div className="flex h-full items-center justify-center text-sm text-muted-foreground">Dados insuficientes</div>}</ChartCard></div>
    </>}
    <section className="space-y-3 border-t pt-5" aria-labelledby="growth-insights"><div className="flex flex-wrap items-center justify-between gap-3"><h2 id="growth-insights" className="flex items-center gap-2 text-lg font-semibold"><PipeflowSymbol className="size-6" alt=""/>Análise estratégica</h2><Button variant="outline" onClick={()=>void run()} disabled={busy||!d||q.isFetching}><Sparkles/>{busy?'Analisando…':'Analisar com Pipeflow IA'}</Button></div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {analysis?<div className="space-y-4 text-sm"><p>{analysis.analysis.summary}</p><div className="grid gap-5 md:grid-cols-3">{[{title:'Oportunidades',items:analysis.analysis.opportunities},{title:'Pontos de atenção',items:analysis.analysis.attention},{title:'Recomendações',items:analysis.analysis.nextActions.map(x=>x.action)}].map(g=><div key={g.title}><h3 className="mb-2 font-semibold">{g.title}</h3><ul className="space-y-2">{g.items.map((x,i)=><li key={i} className="border-l-2 border-primary/30 pl-3">{x}</li>)}</ul></div>)}</div><ul className="space-y-1 text-xs text-muted-foreground">{analysis.analysis.limitations.map((x,i)=><li key={i}>{x}</li>)}</ul></div>:<p className="text-sm text-muted-foreground">{d?.metrics.mrr.value===null?'Dados insuficientes para avaliar receita recorrente.':'Análise ainda não solicitada.'}</p>}
    </section>
  </section>;
}
