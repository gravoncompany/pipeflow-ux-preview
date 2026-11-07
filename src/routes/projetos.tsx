import { createFileRoute } from '@tanstack/react-router';
import { PipeflowImprovementsPage } from '@/components/crm/PipeflowImprovements';

export const Route=createFileRoute('/projetos')({head:()=>({meta:[{title:'Pendentes · Melhorias do Pipeflow — PipeFlow CRM'},{name:'description',content:'Melhorias do Pipeflow ainda não iniciadas ou bloqueadas, com prioridade e próximo passo.'},{property:'og:title',content:'Pendentes · Melhorias do Pipeflow — PipeFlow CRM'},{property:'og:description',content:'Melhorias do Pipeflow ainda não iniciadas ou bloqueadas, com prioridade e próximo passo.'},{property:'og:type',content:'website'},{name:'twitter:card',content:'summary'}]}),component:Page});
function Page(){return <PipeflowImprovementsPage view="pendentes"/>;}
