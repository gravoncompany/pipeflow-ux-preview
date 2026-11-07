import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Search, Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getB2bDeskQuote, lookupB2b, lookupB2bPublic, searchB2bPublicNames, recoverB2bDeskData } from "@/lib/b2b-prospecting.functions";
import { ENRICHMENT_OPTIONS, mergeCompanyData, type QuoteInput } from "@/lib/b2b-hybrid";
import { cnpjInput, type CompanyData } from "@/lib/b2b-prospecting";

type Quote = Awaited<ReturnType<typeof getB2bDeskQuote>>;
export function B2bHybridLookup({ company, disabled, onResult }: {company:CompanyData;disabled:boolean;onResult:(company:CompanyData)=>void}) {
  const publicFn = useServerFn(lookupB2bPublic), quoteFn = useServerFn(getB2bDeskQuote), paidFn = useServerFn(lookupB2b), nameFn = useServerFn(searchB2bPublicNames);
  const recoverFn = useServerFn(recoverB2bDeskData);
  const [candidates,setCandidates] = useState<CompanyData[]>([]), [searched,setSearched] = useState(false);
  const [name,setName] = useState(company.tradeName || company.legalName), [purpose,setPurpose] = useState(false), [busy,setBusy] = useState(false), [error,setError] = useState("");
  const [selected,setSelected] = useState<QuoteInput["selected"]>([]);
  const [pending,setPending] = useState<{quote:Quote;input:QuoteInput}|null>(null);
  const [confirmed,setConfirmed] = useState(false);
  const [recoverAfter,setRecoverAfter] = useState(0);
  async function run(work:()=>Promise<void>) { if(busy) return; setBusy(true);setError("");try{await work();}catch(e){setError(e instanceof Error?e.message:"Consulta indisponível.");}finally{setBusy(false);} }
  async function requestQuote(keyType:"cnpj") {
    setPending(null);setConfirmed(false);
    await run(async()=>{const input={keyType,key:company.cnpj,selected};setPending({input,quote:await quoteFn({data:input})});});
  }
  const stale = pending?.input.keyType === "cnpj" && pending.input.key !== company.cnpj;
  return <section className="space-y-4 border-y py-4" aria-label="Pesquisa híbrida">
    <h3 className="text-sm font-semibold">Pesquisa pública e contatos</h3>
    <label className="flex gap-2 text-xs"><input type="checkbox" checked={purpose} onChange={e=>{setPurpose(e.target.checked);setConfirmed(false);}}/>Pesquisa para finalidade comercial legítima; dados pessoais somente quando necessários.</label>
    <Button variant="outline" size="sm" disabled={disabled||busy||!purpose||!cnpjInput.safeParse(company.cnpj).success} onClick={()=>void run(async()=>{
      setPending(null);setConfirmed(false);
      const result=await publicFn({data:{cnpj:company.cnpj,purposeConfirmed:true}});
      if(!result.ok){setError(result.message);return;}
      if(result.company) onResult(mergeCompanyData(company,result.company));
    })}><Search className="size-4"/>Consultar dados públicos por CNPJ</Button>
    <p className="text-xs text-muted-foreground">Minha Receita · BrasilAPI secundária · sem créditos DeskData · validade: 24 horas.</p>
    <div><Label htmlFor="b2b-hybrid-name">Nome empresarial — histórico privado</Label><Input id="b2b-hybrid-name" value={name} maxLength={150} onChange={e=>{setName(e.target.value);setCandidates([]);setSearched(false);setPending(null);setConfirmed(false);}}/></div>
    <Button size="sm" variant="outline" disabled={disabled||busy||!purpose||name.trim().length<2} onClick={()=>void run(async()=>{setPending(null);setConfirmed(false);setCandidates([]);setSearched(false);const result=await nameFn({data:{name,purposeConfirmed:true}});setCandidates(result.companies);setSearched(true);})}><Search className="size-4"/>Pesquisar nome no histórico</Button>
    {searched&&candidates.length===0&&<p role="status" className="text-xs text-muted-foreground">Nenhuma correspondência nas últimas 100 consultas públicas válidas. A pesquisa nacional gratuita por nome não está disponível nas fontes autorizadas verificadas.</p>}
    {candidates.map(candidate=><div key={candidate.cnpj} className="flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm"><span className="min-w-0 break-words">{candidate.legalName} · {candidate.cnpj}</span><Button size="sm" variant="outline" disabled={busy||disabled||!purpose} onClick={()=>{onResult(mergeCompanyData(company,candidate));setCandidates([]);setSearched(false);setPending(null);setConfirmed(false);}}>Selecionar empresa</Button></div>)}
    <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Empresa e sócios — DeskData</legend>
      {ENRICHMENT_OPTIONS.map(o=><label key={o.id} className="flex gap-2 text-xs"><input type="checkbox" checked={selected.includes(o.id)} onChange={e=>{setSelected(e.target.checked?[...selected,o.id]:selected.filter(s=>s!==o.id));setPending(null);setConfirmed(false);}}/>{o.label}</label>)}
      <label className="flex gap-2 text-xs text-muted-foreground"><input type="checkbox" disabled/>E-mails de sócios — contrato de resposta e contratação pendentes</label>
    </fieldset>
    <Button size="sm" disabled={disabled||busy||!purpose||!selected.length||!cnpjInput.safeParse(company.cnpj).success} onClick={()=>void requestQuote("cnpj")}><Sparkles className="size-4"/>Enriquecer contatos com DeskData</Button>
    {pending&&<div className="space-y-3 border-l-2 border-primary pl-3 text-sm">
      <p>Conjuntos: {pending.quote.datasets.join(", ")}</p>
      <p>Estimativa total: {pending.quote.estimatedCredits===null?"não confirmada":`${pending.quote.estimatedCredits} créditos`}{pending.quote.cached?" · resultado já obtido":""}</p>
      <p className="text-xs text-muted-foreground">Dados básicos incluem porte, capital social e CNAE quando retornados. Telefones de sócios incluem o quadro societário para associação fiscal exata. Saldo não comprova contratação; custos e dependências estão incluídos no total.</p>
      {pending.quote.blockedReason?<p role="status">{pending.quote.blockedReason}</p>:<>
        <label className="flex gap-2 text-xs"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Confirmo os conjuntos, a finalidade e o consumo estimado acima.</label>
        <Button size="sm" disabled={disabled||busy||!purpose||!confirmed||Boolean(stale)} onClick={()=>void run(async()=>{
          setConfirmed(false);
          const result=await paidFn({data:{keyType:pending.input.keyType,key:pending.input.key,confirmed:true,quote:pending.quote.quote}});
          if(!result.ok){setError(result.message);setPending({...pending,quote:{...pending.quote,previousOperation:true,blockedReason:"Resultado não confirmado. Recupere a mesma operação; não inicie outra cobrança."}});return;}
          if(result.pending){setPending({...pending,quote:{...pending.quote,previousOperation:true,blockedReason:result.recoverable?"Consulta em processamento (4008). Aguarde e recupere o resultado da mesma operação.":"Consulta em processamento sem identificador recuperável. Confira com a DeskData; não repita a consulta paga."}});setRecoverAfter(Date.now()+20000);return;}
          setPending(null);
          if(result.company)onResult(mergeCompanyData(company,result.company));else setError("Nenhum dado retornado. Não repita sem conferir o consumo.");
        })}>Confirmar consulta {pending.quote.cached?"armazenada":"paga"}</Button>
      </>}
      {pending.quote.previousOperation && <Button size="sm" variant="outline" disabled={disabled||busy||!purpose||Boolean(stale)} onClick={()=>void run(async()=>{
        if(Date.now()<recoverAfter){setError("Aguarde 20 segundos entre verificações da mesma consulta.");return;}
        setRecoverAfter(Date.now()+20000);
        const result=await recoverFn({data:pending.input});
        if(!result.ok){setError(result.message);return;}
        if(result.pending){setError("Consulta ainda em processamento. Nenhuma nova consulta paga foi enviada.");return;}
        setPending(null);
        if(result.company)onResult(mergeCompanyData(company,result.company));else setError("Consulta concluída sem dados. Não repita sem conferir o consumo.");
      })}>Recuperar consulta anterior</Button>}
    </div>}
    {busy&&<p role="status" className="flex items-center gap-2 text-xs"><Loader2 className="size-4 animate-spin"/>Consultando…</p>}
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    {company.evidence?.map((e,i)=><p key={i} className="break-words text-xs text-muted-foreground">{e.source} · {e.kind==="estimated"?"Estimativa":"Informado pela fonte, sujeito a revisão"} · {new Date(e.checkedAt).toLocaleString("pt-BR")} · {e.fields.join(", ")}</p>)}
  </section>;
}