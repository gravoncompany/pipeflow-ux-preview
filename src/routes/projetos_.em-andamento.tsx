import { createFileRoute } from '@tanstack/react-router';
import { PipeflowImprovementsPage } from '@/components/crm/PipeflowImprovements';

export const Route=createFileRoute('/projetos_/em-andamento')({head:()=>({meta:[{title:'Em andamento · Melhorias do Pipeflow — PipeFlow CRM'},{name:'description',content:'Melhorias do Pipeflow em desenvolvimento ou em teste.'},{property:'og:title',content:'Em andamento · Melhorias do Pipeflow — PipeFlow CRM'},{property:'og:description',content:'Melhorias do Pipeflow em desenvolvimento ou em teste.'},{property:'og:type',content:'website'},{name:'twitter:card',content:'summary'}]}),component:Page});
function Page(){return <PipeflowImprovementsPage view="andamento"/>;}
