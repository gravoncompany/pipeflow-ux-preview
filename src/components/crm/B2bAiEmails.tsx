import { useEffect, useMemo, useRef, useState } from "react";
import { previewSessionHeaders } from "@/lib/crm-preview-session";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, Square, RefreshCw, Check, Settings2, Send, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  DISPATCH_ISSUE_LABEL, EMAIL_AI_BASES, EMAIL_BATCH_LIMIT, dispatchIssues, emailBatchInput,
  type AiEmailBatch, type AiEmailItem, type EmailBatchInput, type EmailCompany, type ProspectCampaign,
} from "@/lib/b2b-email-ai";
import {
  getCampaignProspectWorkspace, sendCampaignProspectEmails, getOutreachIntegrations, getPrepStatus, getProspectEmailWorkspace, listEmailFlowsForOutreach, prepareProspectEmailBatch, processPrepQueue,
  queueOutboundDrafts, recordProspectWhatsapp, saveProspectConfiguration, saveProspectEmailItem, saveProspectEmailTemplate, sendProspectEmails,
} from "@/lib/b2b-email-ai.functions";
import { scheduleWithinBrevoWindow } from "@/lib/b2b-email-ai";

const selectClass = "h-10 rounded-md border bg-background px-3 text-sm";
const SENDER_KEY = "pipeflow:b2b-sender";
const initialCampaign: Omit<ProspectCampaign,"id"> = {name:"Prospecção Gravon Company",city:"",state:"PR",segments:"Odontologia: 15; Estética: 15",quantity:30,frequency:"weekly",preferWebsite:true,preferInstagram:true,criteria:"",status:"configured"};
type Edit = { recipient: string; subject: string; body: string; whatsapp: string };
type SendResult = { id: string; name: string; state: string; message: string };

const batchLabel = (s: string) => s === "complete" ? "Concluído" : s === "paused" ? "Interrompido" : s === "pending" ? "Pendente" : s === "running" ? "Em geração" : s === "stopped" ? "Interrompido" : "Falha";
const sendLabel = (i: AiEmailItem) => i.send_state === "accepted" ? (i.scheduled_for && i.outbound_follow_up !== "sent" ? `Agendado para ${new Date(i.scheduled_for).toLocaleString("pt-BR")}` : "Enviado pela Brevo") : i.send_state === "reserved" ? "Enviando…" : i.send_state === "failed" ? `Recusado pela Brevo${i.send_error ? ` (${i.send_error})` : ""}` : i.send_state === "unknown" ? "Resultado desconhecido — não será reenviado" : "";

function waLink(digits: string, text: string) {
  const d = digits.replace(/\D/g, ""); const full = d.length >= 10 && !d.startsWith("55") ? `55${d}` : d;
  return /^55\d{10,11}$/.test(full) ? `https://wa.me/${full}?text=${encodeURIComponent(text)}` : "";
}
export function B2bAiEmails({companies,request,onConsume,outboundLeadIds=[],campaignMode=false}:{companies:EmailCompany[];request:{nonce:number;companies:EmailCompany[]}|null;onConsume:()=>void;outboundLeadIds?:string[];campaignMode?:boolean}) {
  const integrations=useServerFn(getOutreachIntegrations), prepStatus=useServerFn(getPrepStatus), flowsFn=useServerFn(listEmailFlowsForOutreach), queueFn=useServerFn(queueOutboundDrafts), processFn=useServerFn(processPrepQueue), waFn=useServerFn(recordProspectWhatsapp);
  const integ=useQuery({queryKey:["b2b-outreach-integrations"],queryFn:()=>integrations(),retry:false,staleTime:60_000});
  const prep=useQuery({queryKey:["b2b-prep-status"],queryFn:()=>prepStatus(),retry:false});
  const flows=useQuery({queryKey:["b2b-outreach-flows"],queryFn:()=>flowsFn(),retry:false,staleTime:60_000});
  const [scheduleAt,setScheduleAt]=useState(""),[flowId,setFlowId]=useState("");
  const read=useServerFn(getProspectEmailWorkspace), prepare=useServerFn(prepareProspectEmailBatch), saveItem=useServerFn(saveProspectEmailItem), sendFn=useServerFn(sendProspectEmails), saveConfig=useServerFn(saveProspectConfiguration), saveTemplate=useServerFn(saveProspectEmailTemplate);
  const readCampaign = useServerFn(getCampaignProspectWorkspace);
  const sendCampaign = useServerFn(sendCampaignProspectEmails);
  const campaignBatch = useRef<string | null>(null);
  const workspace = useQuery({
    queryKey: campaignMode ? ["b2b-ai-emails", "campaign", request?.nonce] : ["b2b-ai-emails"],
    queryFn: () => campaignMode ? readCampaign({ data: { batchId: campaignBatch.current } }) : read(),
    retry: false,
    gcTime: 0,
  });
  const [setup,setSetup]=useState<EmailCompany[]|null>(null),[sender,setSender]=useState(""),[authorized,setAuthorized]=useState(false);
  const [bases,setBases]=useState<EmailBatchInput["bases"]>({odontologia:{subject:EMAIL_AI_BASES.odontologia.subject,body:EMAIL_AI_BASES.odontologia.body},estetica:{subject:EMAIL_AI_BASES.estetica.subject,body:EMAIL_AI_BASES.estetica.body}});
  const [modelOpen,setModelOpen]=useState(false),[modelKey,setModelKey]=useState<"odontologia"|"estetica">("odontologia");
  const [campaign,setCampaign]=useState<Omit<ProspectCampaign,"id"> & {id?:string}>(initialCampaign),[campaignOpen,setCampaignOpen]=useState(false);
  const [regenerate,setRegenerate]=useState<AiEmailItem|null>(null);
  const [edits,setEdits]=useState<Record<string,Edit>>({});
  const [confirmSend,setConfirmSend]=useState(false),[results,setResults]=useState<SendResult[]|null>(null);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState("");
  const abort=useRef<AbortController|null>(null);
  useEffect(()=>{ try{ setSender(localStorage.getItem(SENDER_KEY)??""); }catch{/* sem armazenamento */} },[]);
  useEffect(()=>{ if(request){setSetup(request.companies);setAuthorized(false);setRegenerate(null);onConsume();} },[request,onConsume]);
  useEffect(()=>{if(workspace.data?.templates.length) setBases(old=>{
    const next={...old};for(const row of workspace.data.templates){const key=row.key as string;if(key==="odontologia"||key==="estetica")next[key]={subject:row.subject,body:row.body};}return next;
  });},[workspace.data?.templates]);
  useEffect(()=>()=>abort.current?.abort(),[]);
  async function work(fn:()=>Promise<void>){if(busy)return;setBusy(true);setError("");try{await fn();}catch(e){setError(e instanceof Error?e.message:"Não foi possível concluir.");}finally{setBusy(false);}}
  async function run(id:string){
    const controller=new AbortController();abort.current=controller;
    try{
      const response=await fetch("/api/public/b2b/email-generate",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json",...previewSessionHeaders()},body:JSON.stringify({id}),signal:controller.signal});
      if(!response.ok){const data=await response.json();throw new Error(data.message||`Geração indisponível (HTTP ${response.status}).`);}
      if(!response.body)throw new Error("A geração não retornou resultados.");
      const reader=response.body.getReader();const decoder=new TextDecoder();let buffer="";let completed=0;
      while(true){const chunk=await reader.read();if(chunk.done)break;buffer+=decoder.decode(chunk.value,{stream:true});let newline=buffer.indexOf("\n");
        while(newline>=0){const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);newline=buffer.indexOf("\n");if(!line)continue;const event=JSON.parse(line);
          if(event.type==="generating")setMessage(`Escrevendo o e-mail de ${event.name}…`);
          if(event.type==="draft"){completed++;setMessage(`${completed} e-mail(s) prontos para revisão.`);await workspace.refetch();}
          if(event.type==="error")throw new Error(event.message);
          if(event.type==="complete")setMessage("Rascunhos prontos. Revise e aprove abaixo; nada foi enviado.");
        }
      }
    }catch(e){if(!controller.signal.aborted)throw e;setMessage("Geração interrompida. Os rascunhos concluídos foram preservados.");}
    finally{abort.current=null;await workspace.refetch();}
  }

  const batches:AiEmailBatch[]=workspace.data?.batches??[];
  const suppressed=useMemo(()=>new Set(workspace.data?.suppressed??[]),[workspace.data?.suppressed]);
  const current=(i:AiEmailItem):Edit=>edits[i.id]??{recipient:i.suggested_recipient??i.recipient,subject:i.subject,body:i.body,whatsapp:i.whatsapp_text??""};
  // Diferente do que está salvo (inclui destinatário sugerido ainda não salvo): precisa aprovar de novo.
  const dirty=(i:AiEmailItem)=>{const e=current(i);return e.recipient.trim().toLowerCase()!==(i.recipient??"")||e.subject!==i.subject||e.body!==i.body||e.whatsapp!==(i.whatsapp_text??"");};
  const latest=batches[0];
  const allItems=batches.flatMap(b=>b.items);
  function rowIssues(i:AiEmailItem, list:AiEmailItem[]){
    const r=current(i).recipient.trim().toLowerCase();
    const others=new Set(list.filter(x=>x.id!==i.id&&x.send_state==="none").map(x=>current(x).recipient.trim().toLowerCase()).filter(Boolean));
    const issues=dispatchIssues(i,r,suppressed,others);
    if(dirty(i)&&!issues.includes("not_reviewed")&&i.send_state==="none")issues.push("not_reviewed");
    return issues;
  }
  const latestItems=latest?.items??[];
  const readyToSend=latestItems.filter(i=>i.state==="reviewed"&&!dirty(i)&&rowIssues(i,latestItems).length===0);
  const approvable=latestItems.filter(i=>i.send_state==="none"&&["draft","reviewed"].includes(i.state)&&rowIssues(i,latestItems).every(x=>x==="not_reviewed")&&(i.state==="draft"||dirty(i)));
  const pendingEmail=latestItems.filter(i=>rowIssues(i,latestItems).includes("missing_email")).length;

  async function saveRow(i:AiEmailItem, reviewed:boolean){
    const e=current(i);
    await saveItem({data:{id:i.id,revision:i.revision,subject:e.subject,body:e.body,recipient:e.recipient.trim().toLowerCase(),whatsapp:e.whatsapp,reviewed}});
    setEdits(old=>{const n={...old};delete n[i.id];return n;});
  }
  function startPrepare(list:EmailCompany[]){setSetup(list);setAuthorized(false);setRegenerate(null);setResults(null);}

  return <section className="space-y-5 border-t pt-6" aria-label="Disparo com Pipeflow IA">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-xl font-semibold"><Sparkles className="size-5 text-primary"/>Disparo para as selecionadas</h2><p className="mt-1 text-sm text-muted-foreground">A Pipeflow IA escreve um e-mail por empresa a partir da mensagem inicial da Gravon. Você revisa e só então envia pela Brevo.</p></div>
      <div className="flex flex-wrap gap-2">
        {!campaignMode&&<DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" disabled={busy}><Settings2 className="size-4"/>Ajustes</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end"><DropdownMenuItem onSelect={()=>setModelOpen(true)}>Mensagem inicial (modelos base)</DropdownMenuItem><DropdownMenuItem onSelect={()=>{setCampaign(initialCampaign);setCampaignOpen(true);}}>Configurar campanha recorrente</DropdownMenuItem></DropdownMenuContent>
        </DropdownMenu>}
        <Button variant="outline" disabled={busy||workspace.isFetching} onClick={()=>void workspace.refetch()} title="Atualizar rascunhos" aria-label="Atualizar rascunhos"><RefreshCw className="size-4"/></Button>
      </div>
    </header>
    {integ.data&&<ul className="grid gap-2 sm:grid-cols-3" aria-label="Estado das integrações">{integ.data.map(x=><li key={x.id} className="rounded-lg border p-2 text-xs" title={x.detail}><p className="flex items-center gap-1.5 font-medium"><span className={`size-2 rounded-full ${x.ok?"bg-primary":"bg-destructive"}`} aria-hidden/>{x.label}: {x.ok?"OK":"Atenção"}</p><p className="mt-0.5 line-clamp-2 text-muted-foreground">{x.detail}</p></li>)}</ul>}
    {!campaignMode&&prep.data&&<p className="text-xs text-muted-foreground">Fila automática do Outbound (Lead Novo): {prep.data.counts.queued+prep.data.counts.running} na fila · {prep.data.counts.done} preparados · {prep.data.counts.failed} com falha{prep.data.runner?.ai_blocked_reason?` · pausada: ${prep.data.runner.ai_blocked_reason}`:""}</p>}
    <div className="flex flex-wrap items-center gap-3">
      {outboundLeadIds.length>0&&<Button variant="outline" disabled={busy} onClick={()=>void work(async()=>{
        const first=await queueFn({data:{leadIds:outboundLeadIds.slice(0,30)}});let total=first.drafts;let out:{processed:number;drafts:number}=first;
        for(let n=0;n<6&&out.processed>0;n++){await workspace.refetch();out=await processFn();total+=out.drafts;}
        await Promise.all([workspace.refetch(),prep.refetch()]);setMessage(total?`${total} rascunho(s) preparados para os cards a abordar. Revise abaixo; nada foi enviado.`:"Nenhum card novo para preparar (cada card é preparado uma única vez).");
      })}><Sparkles className="size-4"/>Preparar cards a abordar ({Math.min(outboundLeadIds.length,30)})</Button>}
      <Button disabled={busy||!companies.length||companies.length>EMAIL_BATCH_LIMIT} onClick={()=>startPrepare(companies)}><Send className="size-4"/>Preparar disparo ({companies.length}/{EMAIL_BATCH_LIMIT})</Button>
      {busy&&abort.current&&<Button variant="outline" onClick={()=>abort.current?.abort()}><Square className="size-4"/>Interromper</Button>}
      {companies.length>EMAIL_BATCH_LIMIT&&<span className="text-sm text-destructive">Selecione no máximo {EMAIL_BATCH_LIMIT} empresas por disparo.</span>}
    </div>
    {message&&<p role="status" className="text-sm text-primary">{message}</p>}{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}{workspace.isError&&<p role="alert" className="text-sm text-destructive">Não foi possível carregar os rascunhos privados.</p>}

    {latest&&<div className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="font-semibold">Prévia do disparo</h3><p className="text-xs text-muted-foreground">{new Date(latest.created_at).toLocaleString("pt-BR")} · {latestItems.length} empresa(s) · {batchLabel(latest.state)} · {readyToSend.length} pronta(s) para enviar{pendingEmail?` · ${pendingEmail} sem e-mail`:""}</p></div>
        <div className="flex flex-wrap gap-2">
          {latest.state==="pending"&&<Button variant="outline" size="sm" disabled={busy} onClick={()=>void work(()=>run(latest.id))}>Gerar rascunhos</Button>}
          <Button variant="outline" size="sm" disabled={busy||!approvable.length} onClick={()=>void work(async()=>{for(const i of approvable)await saveRow(i,true);await workspace.refetch();setMessage(`${approvable.length} e-mail(s) aprovados. Nada foi enviado ainda.`);})}><Check className="size-4"/>Aprovar completos ({approvable.length})</Button>
          <Button size="sm" disabled={busy||!readyToSend.length} onClick={()=>{setResults(null);setConfirmSend(true);}}><Send className="size-4"/>Enviar via Brevo ({readyToSend.length})</Button>
        </div>
      </div>
      <ul className="divide-y rounded-lg border">
        {latestItems.map(i=>{const e=current(i),issues=rowIssues(i,latestItems),locked=i.send_state!=="none"||!["draft","reviewed"].includes(i.state);const sent=sendLabel(i);
          return <li key={i.id} className="space-y-2 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{i.company.name}</span>
              <span className="text-xs text-muted-foreground">{[i.company.segment,i.company.city].filter(Boolean).join(" · ")}</span>
              {sent?<span className={`rounded-full px-2 py-0.5 text-xs ${i.send_state==="accepted"?"bg-primary text-primary-foreground":"bg-destructive/10 text-destructive"}`}>{sent}</span>
                :i.state==="reviewed"&&!dirty(i)?<span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">Aprovado</span>:null}
              {(i.outbound_follow_up==="review"||i.outbound_follow_up==="pending")&&<span className="text-xs text-muted-foreground">{i.outbound_follow_up==="review"?"Vínculo no Outbound precisa de revisão.":"Registro no Outbound pendente."}</span>}
              {i.state==="failed"&&<span className="text-xs text-destructive">{i.error_message||"Falha na geração"}</span>}
              {(i.state==="pending"||i.state==="generating")&&<span className="text-xs text-muted-foreground">{i.state==="generating"?"Escrevendo…":"Aguardando geração"}</span>}
              {!sent&&issues.filter(x=>x!=="not_reviewed"&&x!=="not_generated").map(x=><span key={x} className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">{DISPATCH_ISSUE_LABEL[x]}</span>)}
            </div>
            {["draft","reviewed"].includes(i.state)&&<div className="grid gap-2 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
              <div><Label htmlFor={`rcp-${i.id}`} className="text-xs">Destinatário</Label><Input id={`rcp-${i.id}`} type="email" placeholder="email@empresa.com.br" disabled={locked||busy} readOnly={campaignMode} value={e.recipient} onChange={ev=>setEdits(o=>({...o,[i.id]:{...e,recipient:ev.target.value}}))}/></div>
              <div><Label htmlFor={`sub-${i.id}`} className="text-xs">Assunto</Label><Input id={`sub-${i.id}`} maxLength={200} disabled={locked||busy} value={e.subject} onChange={ev=>setEdits(o=>({...o,[i.id]:{...e,subject:ev.target.value}}))}/></div>
              <div className="md:col-span-2"><Label htmlFor={`body-${i.id}`} className="text-xs">E-mail</Label><Textarea id={`body-${i.id}`} rows={7} maxLength={6000} disabled={locked||busy} value={e.body} onChange={ev=>setEdits(o=>({...o,[i.id]:{...e,body:ev.target.value}}))}/></div>
              {(i.personalization_fact||i.context_status==="insufficient")&&<p className="text-xs text-muted-foreground md:col-span-2"><span className="font-medium text-foreground">Fato usado:</span> {i.personalization_fact||"nenhum fato específico encontrado"}{i.personalization_source?` · Fonte: ${i.personalization_source}`:""}</p>}
              {!campaignMode&&<div className="md:col-span-2"><Label htmlFor={`wa-${i.id}`} className="text-xs">Mensagem curta de WhatsApp</Label><Textarea id={`wa-${i.id}`} rows={3} maxLength={1000} disabled={busy||Boolean(i.whatsapp_sent_at)} value={e.whatsapp} onChange={ev=>setEdits(o=>({...o,[i.id]:{...e,whatsapp:ev.target.value}}))}/>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">{i.whatsapp_sent_at?<span className="text-primary">WhatsApp registrado em {new Date(i.whatsapp_sent_at).toLocaleString("pt-BR")}</span>:(()=>{const link=waLink(i.company.whatsapp??"",e.whatsapp);return <>{link?<Button size="sm" variant="outline" asChild><a href={link} target="_blank" rel="noreferrer">Abrir no WhatsApp</a></Button>:<span className="text-muted-foreground">Sem WhatsApp identificado para esta empresa.</span>}<Button size="sm" variant="ghost" disabled={busy||!e.whatsapp.trim()||dirty(i)} title={dirty(i)?"Salve a edição antes":undefined} onClick={()=>void work(async()=>{const r=await waFn({data:{id:i.id}});await workspace.refetch();setMessage(r.recorded?`${i.company.name}: envio pelo WhatsApp registrado no card.`:"Já registrado.");})}>Registrar envio pelo WhatsApp</Button></>;})()}</div>
              </div>}
            </div>}
            {!locked&&<div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy||issues.some(x=>x!=="not_reviewed"&&x!=="missing_email")||e.subject.trim().length<1||e.body.trim().length<10} onClick={()=>void work(async()=>{await saveRow(i,true);await workspace.refetch();setMessage(`${i.company.name}: aprovado. Nada foi enviado ainda.`);})}><Check className="size-4"/>{i.state==="reviewed"&&!dirty(i)?"Aprovado":"Salvar e aprovar"}</Button>
              {dirty(i)&&<Button size="sm" variant="ghost" disabled={busy} onClick={()=>setEdits(o=>{const n={...o};delete n[i.id];return n;})}>Desfazer edição</Button>}
              {!campaignMode&&<Button size="sm" variant="ghost" disabled={busy} onClick={()=>{setRegenerate(i);setSetup([i.company]);setAuthorized(false);}}><RotateCcw className="size-4"/>Reescrever</Button>}
            </div>}
          </li>;})}
      </ul>
      {pendingEmail>0&&<p className="text-xs text-muted-foreground">Empresas sem e-mail ficam fora do disparo. Informe o endereço no campo Destinatário se você o tiver; as demais seguem normalmente.</p>}
      {results&&<div className="rounded-lg border p-3 text-sm" role="status"><p className="font-medium">Resultado do disparo</p><ul className="mt-2 space-y-1">{results.map(r=><li key={r.id} className={r.state==="accepted"?"text-primary":"text-destructive"}>{(r.name||latestItems.find(x=>x.id===r.id)?.company.name)??"E-mail"}: {r.message}</li>)}</ul></div>}
    </div>}

    {batches.length>1&&<details className="text-sm"><summary className="cursor-pointer font-medium text-primary">Disparos anteriores ({batches.length-1})</summary>
      <ul className="mt-2 divide-y">{batches.slice(1).map(b=><li key={b.id} className="py-2"><p className="font-medium">{new Date(b.created_at).toLocaleString("pt-BR")} · {b.items.length} empresas · {batchLabel(b.state)}</p><p className="text-xs text-muted-foreground">{b.items.map(i=>`${i.company.name}: ${sendLabel(i)||(i.state==="reviewed"?"aprovado, não enviado":i.state==="draft"?"rascunho":i.state)}`).join(" · ")}</p></li>)}</ul>
    </details>}
    {!batches.length&&!allItems.length&&workspace.isSuccess&&<p className="text-sm text-muted-foreground">Selecione empresas e clique em Preparar disparo. Nenhum modelo precisa ser escolhido antes.</p>}

    <Dialog open={Boolean(setup)} onOpenChange={v=>{if(!v&&!busy)setSetup(null);}}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>{regenerate?"Reescrever e-mail":"Preparar disparo"}</DialogTitle><DialogDescription>{setup?.length} empresa(s) · a Pipeflow IA adapta a abertura e o exemplo de cada e-mail usando nome, cidade, segmento e o site público. Nada é enviado nesta etapa.</DialogDescription></DialogHeader>
      <ul className="max-h-40 overflow-y-auto text-sm text-muted-foreground">{setup?.map(c=><li key={c.key}>{c.name}{c.email?"":" · sem e-mail"}</li>)}</ul>
      <Label htmlFor="ai-email-sender">Seu nome (assinatura)</Label><Input id="ai-email-sender" value={sender} onChange={e=>setSender(e.target.value)}/>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={authorized} onChange={e=>setAuthorized(e.target.checked)}/>Tenho base legal para usar estes dados e autorizo o custo de IA desta geração.</label>
      {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button disabled={busy||!authorized||sender.trim().length<2||!setup?.length||setup.length>EMAIL_BATCH_LIMIT} onClick={()=>void work(async()=>{
        try{localStorage.setItem(SENDER_KEY,sender.trim());}catch{/* opcional */}
        const input=emailBatchInput.parse({companies:setup,sender,template:"auto",bases,authorized,...(regenerate?{regenerate:{id:regenerate.id,revision:regenerate.revision}}:{})});
        const result=await prepare({data:input});
        if (campaignMode) campaignBatch.current = result.id;
        setSetup(null);setRegenerate(null);await workspace.refetch();await run(result.id);
      })}><Sparkles className="size-4"/>Gerar {setup?.length} rascunho(s)</Button>
    </DialogContent></Dialog>

    <Dialog open={confirmSend} onOpenChange={v=>{if(!busy)setConfirmSend(v);}}><DialogContent><DialogHeader><DialogTitle>Enviar {readyToSend.length} e-mail(s) pela Brevo?</DialogTitle><DialogDescription>Cada empresa recebe o seu e-mail revisado, uma única vez. Ao confirmar, o primeiro contato aceito das empresas do Maps será registrado no Outbound. Descadastrados e endereços já abordados ficam fora.</DialogDescription></DialogHeader>
      <ul className="max-h-48 overflow-y-auto text-sm">{readyToSend.map(i=><li key={i.id}>{i.company.name} → {i.recipient}</li>)}</ul>
      <Label htmlFor="b2b-schedule">Agendar (opcional, de 5 min a 72 h)</Label><Input id="b2b-schedule" type="datetime-local" value={scheduleAt} onChange={e=>setScheduleAt(e.target.value)}/>
      {scheduleAt&&!scheduleWithinBrevoWindow(new Date(scheduleAt).toISOString())&&<p className="text-xs text-destructive">Escolha um horário entre 5 minutos e 72 horas a partir de agora.</p>}
      <Label htmlFor="b2b-flow">Follow-ups (Fluxo de E-mail, opcional)</Label><select id="b2b-flow" className={selectClass} value={flowId} onChange={e=>setFlowId(e.target.value)}><option value="">Sem follow-up</option>{flows.data?.map(f=><option key={f.id} value={f.id}>{f.name}{f.state!=="active"?" (pausado)":""}</option>)}</select>
      <p className="text-xs text-muted-foreground">Os follow-ups param sozinhos quando o contato responde por e-mail ou pelo WhatsApp.</p>
      {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button disabled={busy||!readyToSend.length} onClick={()=>void work(async()=>{
        const sched=scheduleAt?new Date(scheduleAt).toISOString():null;
        if(!scheduleWithinBrevoWindow(sched)){setError("Escolha um horário entre 5 minutos e 72 horas a partir de agora.");return;}
        const out=await (campaignMode?sendCampaign:sendFn)({data:{items:readyToSend.map(i=>({id:i.id,revision:i.revision})),confirmed:true,scheduledAt:sched,flowId:flowId||null}});
        if(!out.ok){setError(`Envio bloqueado: ${out.blocked.join(" ")}`);return;}
        setResults(out.results);setConfirmSend(false);await workspace.refetch();
        const ok=out.results.filter(r=>r.state==="accepted").length;setMessage(`${ok} de ${out.results.length} e-mail(s) ${sched?"agendados":"aceitos"} pela Brevo.${out.flow?` ${out.flow.added} card(s) entraram no fluxo de follow-up.`:""}`);
      })}><Send className="size-4"/>{busy?"Enviando…":scheduleAt?"Confirmar agendamento":"Confirmar envio"}</Button>
    </DialogContent></Dialog>

    <Dialog open={modelOpen} onOpenChange={setModelOpen}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Mensagem inicial da Gravon</DialogTitle><DialogDescription>Opcional. A IA usa esta base e adapta a abertura e o exemplo a cada empresa. Segmento escolhido automaticamente.</DialogDescription></DialogHeader><select className={selectClass} aria-label="Segmento do modelo" value={modelKey} onChange={e=>setModelKey(e.target.value as typeof modelKey)}><option value="odontologia">Odontologia e geral</option><option value="estetica">Estética</option></select><Label>Assunto base</Label><Input aria-label="Assunto base" value={bases[modelKey].subject} onChange={e=>setBases({...bases,[modelKey]:{...bases[modelKey],subject:e.target.value}})}/><Label>Conteúdo base</Label><Textarea aria-label="Conteúdo base" className="min-h-64" value={bases[modelKey].body} onChange={e=>setBases({...bases,[modelKey]:{...bases[modelKey],body:e.target.value}})}/><Button disabled={busy} onClick={()=>void work(async()=>{await saveTemplate({data:{key:modelKey,...bases[modelKey]}});setModelOpen(false);setMessage("Mensagem base salva.");})}>Salvar</Button></DialogContent></Dialog>
    <Dialog open={campaignOpen} onOpenChange={setCampaignOpen}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Configurar campanha</DialogTitle><DialogDescription>Configuração inativa. Pesquisa e envio não serão executados.</DialogDescription></DialogHeader><Label>Nome</Label><Input aria-label="Nome da campanha" value={campaign.name} onChange={e=>setCampaign({...campaign,name:e.target.value})}/><Label>Segmentos e distribuição</Label><Input aria-label="Segmentos e distribuição" value={campaign.segments} onChange={e=>setCampaign({...campaign,segments:e.target.value})}/><div className="grid grid-cols-2 gap-3"><div><Label>Cidade/região</Label><Input aria-label="Cidade da campanha" value={campaign.city} onChange={e=>setCampaign({...campaign,city:e.target.value})}/></div><div><Label>UF</Label><Input aria-label="UF da campanha" maxLength={2} value={campaign.state} onChange={e=>setCampaign({...campaign,state:e.target.value.toUpperCase()})}/></div></div><Label>Empresas por execução</Label><Input aria-label="Empresas por execução" type="number" min={1} max={30} value={campaign.quantity} onChange={e=>setCampaign({...campaign,quantity:Number(e.target.value)})}/><Label>Frequência</Label><select aria-label="Frequência da campanha" className={selectClass} value={campaign.frequency} onChange={e=>setCampaign({...campaign,frequency:e.target.value as ProspectCampaign["frequency"]})}><option value="daily">Diária</option><option value="weekly">Semanal</option><option value="fortnightly">Quinzenal</option><option value="monthly">Mensal</option></select><label className="flex gap-2"><input type="checkbox" checked={campaign.preferWebsite} onChange={e=>setCampaign({...campaign,preferWebsite:e.target.checked})}/>Preferir site</label><label className="flex gap-2"><input type="checkbox" checked={campaign.preferInstagram} onChange={e=>setCampaign({...campaign,preferInstagram:e.target.checked})}/>Preferir Instagram</label><Label>Critérios de qualificação</Label><Textarea aria-label="Critérios de qualificação" value={campaign.criteria} onChange={e=>setCampaign({...campaign,criteria:e.target.value})}/><Label>Estado</Label><select aria-label="Estado da campanha" className={selectClass} value={campaign.status} onChange={e=>setCampaign({...campaign,status:e.target.value as ProspectCampaign["status"]})}><option value="configured">Configurada, inativa</option><option value="paused">Pausada</option><option value="ended">Encerrada</option></select>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}<Button disabled={busy} onClick={()=>void work(async()=>{await saveConfig({data:campaign});setCampaignOpen(false);await workspace.refetch();setMessage("Campanha salva, sem ativar pesquisa ou envio.");})}>Salvar configuração inativa</Button>
      {workspace.data?.campaigns.length?<div className="divide-y border-t pt-2">{workspace.data.campaigns.map(row=>{const c=row.config as ProspectCampaign;return <button type="button" key={row.id} className="block w-full py-2 text-left text-sm hover:text-primary" onClick={()=>setCampaign({...c,id:row.id,status:row.status as ProspectCampaign["status"]})}>{c.name} · {c.city}/{c.state} · editar</button>;})}</div>:null}
    </DialogContent></Dialog>
  </section>;
}
