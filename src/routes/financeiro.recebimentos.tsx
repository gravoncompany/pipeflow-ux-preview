import { createFileRoute } from "@tanstack/react-router";
import { ReceiptControl, parseReceiptSearch } from "@/components/crm/ReceiptControl";
export const Route=createFileRoute("/financeiro/recebimentos")({validateSearch:parseReceiptSearch,head:()=>({meta:[{title:"Controle de Recebimentos — Pipeflow CRM"},{name:"description",content:"Cobranças mensais, quinzenais e semanais, pagamentos e conciliações de clientes."},{property:"og:title",content:"Controle de Recebimentos — Pipeflow CRM"},{property:"og:description",content:"Controle financeiro dos recebimentos reais dos clientes do Pipeflow."},{property:"og:type",content:"website"},{name:"twitter:card",content:"summary"}]}),component:Page});
function Page(){const search=Route.useSearch();return <ReceiptControl search={search}/>;}
