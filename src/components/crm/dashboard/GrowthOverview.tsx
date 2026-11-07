import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { BarChart, Bar, AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, Legend } from 'recharts';
import { motion } from 'motion/react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { KpiCard, Sparkline } from '@/components/crm/ux/KpiCard';
import { ChartGradients, GlassTooltip, ChartEmpty, SERIES, labAxis, labGrid, labAnim } from '@/components/crm/ux/charts';
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
  return <div className={`surface surface-hover relative min-w-0 overflow-hidden rounded-xl border p-4 ${hero?'btn-brand border-transparent text-primary-foreground shadow-[0_16px_40px_-18px_var(--brand-glow)]':primary?'border-primary/15 bg-gradient-to-br from-primary/[0.06] to-card':'bg-card'}`}>
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
  const PRESETS=[['30d','30 dias'],['90d','90 dias'],['6m','6 meses'],['12m','12 meses']] as const;
  const mrrSeries=rows.map(r=>r.mrr).filter((v):v is number=>v!==null);
  const mrrDelta=mrrSeries.length>1&&mrrSeries[0]?Math.round((mrrSeries.at(-1)!-mrrSeries[0])/mrrSeries[0]*1000)/10:null;
  const spark=(key:string,src:typeof rows|typeof urows)=>(src as unknown as Record<string,number|null>[]).map(r=>r[key]).filter((v):v is number=>v!==null);
  const metricText=(m:Metric|undefined,f:(v:number)=>string)=>m&&m.value!==null?f(m.value):'—';
  const area=(data:Record<string,unknown>[],key:string,name:string,f:(v:number)=>string,gi=0)=><AreaChart data={data} margin={{top:8,right:8,left:0,bottom:0}}>{ChartGradients({prefix:`ch-${key}`})}<CartesianGrid {...labGrid}/><XAxis dataKey="label" {...labAxis}/><YAxis {...labAxis} width={72} tickFormatter={v=>f(Number(v))}/><Tooltip cursor={{stroke:'var(--primary)',strokeOpacity:0.25,strokeWidth:24}} content={<GlassTooltip format={f}/>}/><Area type="monotone" dataKey={key} name={name} stroke={SERIES[gi]} strokeWidth={2.5} fill={`url(#ch-${key}-g${gi})`} dot={false} activeDot={{r:5,strokeWidth:2,stroke:'var(--card)'}} connectNulls={false} {...labAnim}/></AreaChart>;
  return <section className="space-y-6" aria-label="Crescimento estratégico">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight"><span className="inline-flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary"><TrendingUp className="size-4"/></span>Inteligência financeira e comercial</h2>{period && <p className="mt-1 text-xs text-muted-foreground">{dateBR(period.from)} a {dateBR(period.to)}</p>}</div>
      <div className="flex items-center gap-2">
        <div role="radiogroup" aria-label="Período de crescimento" className="relative flex rounded-full border bg-card/80 p-1 shadow-sm backdrop-blur">
          {PRESETS.map(([v,l])=><button key={v} type="button" role="radio" aria-checked={preset===v} disabled={busy} onClick={()=>setPreset(v)} className={`relative rounded-full px-3 py-1 text-xs font-medium transition-colors ${preset===v?'text-primary-foreground':'text-muted-foreground hover:text-foreground'}`}>{preset===v&&<motion.span layoutId="growth-period" className="btn-brand absolute inset-0 rounded-full shadow" transition={{type:'spring',stiffness:500,damping:40}}/>}<span className="relative">{l}</span></button>)}
        </div>
        <Button aria-label="Atualizar crescimento" title="Atualizar crescimento" variant="outline" size="icon" className="rounded-full" disabled={busy} onClick={()=>{setAnalysis(null);void q.refetch();}}><RefreshCw className={q.isFetching?'animate-spin':''}/></Button>
      </div>
    </div>
    {q.isError && <p role="alert" className="text-sm text-destructive">{q.error.message}</p>}
    {!d?<div className="grid gap-3 lg:grid-cols-3"><div className="lab-skeleton h-44 rounded-2xl lg:col-span-2"/><div className="lab-skeleton h-44 rounded-2xl"/></div>:<>
      {/* Destaque: receita recorrente com tendência do período. */}
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="lab-rise relative overflow-hidden rounded-2xl p-5 text-primary-foreground shadow-[0_20px_50px_-20px_var(--brand-glow)] lg:col-span-2" style={{backgroundImage:'var(--brand-gradient)'}}>
          <div className="lab-float absolute -right-10 -top-16 size-56 rounded-full bg-white/10 blur-2xl" aria-hidden/>
          <div className="absolute -bottom-20 left-1/3 size-56 rounded-full bg-chart-2/30 blur-3xl" aria-hidden/>
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-primary-foreground/80">Receita recorrente mensal (MRR)</p>
              <p className="mt-1 text-4xl font-semibold tracking-tight tabular-nums">{metricText(d.metrics.mrr,brl)}</p>
              {mrrDelta!==null&&<span className="mt-2 inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-xs font-medium backdrop-blur">{mrrDelta>=0?'▲':'▼'} {mrrDelta>=0?'+':''}{mrrDelta.toLocaleString('pt-BR')}% no período exibido</span>}
            </div>
            <dl className="grid grid-cols-3 gap-5 text-sm">
              {([['ARR',metricText(d.metrics.arr,brl)],['Clientes ativos',metricText(d.metrics.active,int)],['Ticket médio',metricText(d.metrics.ticket,brl)]] as const).map(([k,v])=><div key={k}><dt className="text-xs text-primary-foreground/70">{k}</dt><dd className="mt-0.5 text-lg font-semibold tabular-nums">{v}</dd></div>)}
            </dl>
          </div>
          {mrrSeries.length>1&&<div className="relative mt-4 h-24"><Sparkline data={mrrSeries} color="white" className="h-24" /></div>}
        </div>
        <div className="grid gap-3">
          <KpiCard label="Retorno sobre gastos operacionais" value={metricText(d.unit.metrics.opReturn,pct)} tone="success" spark={spark('opReturn',urows)} hint={d.unit.metrics.opReturn?.note}/>
          <KpiCard label="Margem de contribuição" value={metricText(d.unit.metrics.margin,pct)} tone="primary" spark={spark('margin',urows)}/>
        </div>
      </div>

      <Tabs defaultValue="receita" className="space-y-4">
        <TabsList className="h-auto flex-wrap justify-start gap-1 rounded-full bg-muted/60 p-1">
          {([['receita','Receita e carteira'],['eficiencia','Eficiência e marketing'],['indicadores','Todos os indicadores']] as const).map(([v,l])=><TabsTrigger key={v} value={v} className="rounded-full px-4">{l}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="receita" className="mt-0 space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2"><ChartCard title="Crescimento mensal do MRR" note="Posições mensais registradas; sem projeção de histórico ausente.">{rows.some(r=>r.mrr!==null)?area(rows,'mrr','MRR',brl,0):<ChartEmpty/>}</ChartCard></div>
            <ChartCard title="Carteira de clientes" note="Clientes ativos por mês.">{rows.some(r=>r.clients!==null)?area(rows,'clients','Clientes',int,2):<ChartEmpty/>}</ChartCard>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Conquistados versus cancelados" note="Clientes únicos com alterações contratuais registradas.">{rows.some(r=>r.won!==null)?<BarChart data={rows} barGap={4} margin={{top:8,right:8,left:0,bottom:0}}>{ChartGradients({prefix:"ch-won"})}<CartesianGrid {...labGrid}/><XAxis dataKey="label" {...labAxis}/><YAxis {...labAxis} allowDecimals={false} width={32}/><Tooltip cursor={{fill:'var(--muted)',opacity:0.5}} content={<GlassTooltip format={int}/>}/><Legend iconType="circle" wrapperStyle={{fontSize:12}}/><Bar dataKey="won" name="Conquistados" fill="url(#ch-won-g0-bar)" radius={[6,6,0,0]} maxBarSize={22} {...labAnim}/><Bar dataKey="lost" name="Cancelados" fill="url(#ch-won-g3-bar)" radius={[6,6,0,0]} maxBarSize={22} {...labAnim}/></BarChart>:<ChartEmpty/>}</ChartCard>
            <ChartCard title="Ticket médio e expansão" note="Ticket por cliente ativo e receita de expansão auditada.">{rows.some(r=>r.ticket!==null)?<AreaChart data={rows} margin={{top:8,right:8,left:0,bottom:0}}>{ChartGradients({prefix:"ch-ticket"})}<CartesianGrid {...labGrid}/><XAxis dataKey="label" {...labAxis}/><YAxis {...labAxis} width={72} tickFormatter={v=>brl(Number(v))}/><Tooltip content={<GlassTooltip format={brl}/>}/><Legend iconType="circle" wrapperStyle={{fontSize:12}}/><Area type="monotone" dataKey="ticket" name="Ticket médio" stroke={SERIES[1]} strokeWidth={2.5} fill="url(#ch-ticket-g1)" dot={false} {...labAnim}/><Area type="monotone" dataKey="expansion" name="Expansão" stroke={SERIES[3]} strokeWidth={2} fill="url(#ch-ticket-g3)" dot={false} {...labAnim}/></AreaChart>:<ChartEmpty/>}</ChartCard>
          </div>
        </TabsContent>
        <TabsContent value="eficiencia" className="mt-0">
          <div className="grid gap-4 lg:grid-cols-2">{ucharts.map((c,i)=><ChartCard key={c.key} title={c.title} note="Por mês, com dados confirmados do Financeiro; meses sem dados ficam em branco.">{urows.some(r=>r[c.key]!==null)?area(urows,c.key,c.title,c.f,i%5):<ChartEmpty text="Dados insuficientes: faltam vendas classificadas ou despesas confirmadas."/>}</ChartCard>)}</div>
        </TabsContent>
        <TabsContent value="indicadores" className="mt-0 space-y-5">
          {ROWS.map((row,ri)=><div key={row.title} className="space-y-2"><h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{row.title}</h3><div className="lab-stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{row.items.map(([key,title,fmt])=>{const m=(row.src==='unit'?d.unit.metrics:d.metrics)[key as never] as Metric;return <GrowthKpi key={key} title={title} m={m} hero={key==='opReturn'} calc={row.src==='unit'?d.unit.calc[key as keyof typeof d.unit.calc]:undefined} primary={ri===0||key==='mrr'||key==='arr'} format={fmt ?? brl}/>;})}</div></div>)}
          <p className="text-xs text-muted-foreground">Fontes do período: receita confirmada {brl(d.unit.sources.revenue)} · custos variáveis (fornecedores/terceiros e impostos) {brl(d.unit.sources.variableCosts)} · custos e despesas operacionais totais {brl(d.unit.sources.opExpense)} · marketing e tráfego pago {brl(d.unit.sources.acquisition)} · clientes novos {d.unit.sources.newCustomers ?? 'pendente de classificação'}. Transferências, aplicações, empréstimos e repasses (inclusive HyperCash) não entram como receita.</p>
        </TabsContent>
      </Tabs>
      <p className="text-xs text-muted-foreground">Contratos registrados: {d.coverage.withContracts} de {d.coverage.clients} clientes · Posição em {dateBR(d.asOf)} · Receita contratada, não recebimentos.</p>
    </>}
    <section className="space-y-3 border-t pt-5" aria-labelledby="growth-insights"><div className="flex flex-wrap items-center justify-between gap-3"><h2 id="growth-insights" className="flex items-center gap-2 text-lg font-semibold"><PipeflowSymbol className="size-6" alt=""/>Análise estratégica</h2><Button variant="outline" onClick={()=>void run()} disabled={busy||!d||q.isFetching}><Sparkles/>{busy?'Analisando…':'Analisar com Pipeflow IA'}</Button></div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {analysis?<div className="space-y-4 text-sm"><p>{analysis.analysis.summary}</p><div className="grid gap-5 md:grid-cols-3">{[{title:'Oportunidades',items:analysis.analysis.opportunities},{title:'Pontos de atenção',items:analysis.analysis.attention},{title:'Recomendações',items:analysis.analysis.nextActions.map(x=>x.action)}].map(g=><div key={g.title}><h3 className="mb-2 font-semibold">{g.title}</h3><ul className="space-y-2">{g.items.map((x,i)=><li key={i} className="border-l-2 border-primary/30 pl-3">{x}</li>)}</ul></div>)}</div><ul className="space-y-1 text-xs text-muted-foreground">{analysis.analysis.limitations.map((x,i)=><li key={i}>{x}</li>)}</ul></div>:<p className="text-sm text-muted-foreground">{d?.metrics.mrr.value===null?'Dados insuficientes para avaliar receita recorrente.':'Análise ainda não solicitada.'}</p>}
    </section>
  </section>;
}
