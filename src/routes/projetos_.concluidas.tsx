import { createFileRoute } from '@tanstack/react-router';
import { PipeflowImprovementsPage } from '@/components/crm/PipeflowImprovements';

export const Route=createFileRoute('/projetos_/concluidas')({head:()=>({meta:[{title:'Concluídas · Melhorias do Pipeflow — PipeFlow CRM'},{name:'description',content:'Melhorias do Pipeflow já concluídas.'},{property:'og:title',content:'Concluídas · Melhorias do Pipeflow — PipeFlow CRM'},{property:'og:description',content:'Melhorias do Pipeflow já concluídas.'},{property:'og:type',content:'website'},{name:'twitter:card',content:'summary'}]}),component:Page});
function Page(){return <PipeflowImprovementsPage view="concluidas"/>;}
