import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { importB2b, lookupB2bPublic, searchB2bPublicNames } from "@/lib/b2b-prospecting.functions";
import { bulkMoveCrmLeads } from "@/lib/crm-leads.functions";
import type { CompanyData, Place, SearchInput } from "@/lib/b2b-prospecting";
import { placeToCompany, companyEmails, companyPhones, pickCnpjCandidate, mergeIdentified, type CnpjStatus } from "@/lib/b2b-bulk";
import { collectEmails, collectPhones, gmailList, toCsv, chunk, bulkSummaryText } from "@/lib/bulk-actions";
import type { Stage } from "@/lib/crm-types";
import { copyText } from "@/lib/clipboard";

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type PipelineOption = { id: string; name: string; stages: Stage[] };
// Barra de ações em massa da Prospecção B2B. Copiar e-mails não depende de Gmail nem Brevo: copia para a área de
// transferência no formato aceito pelo campo Cco do Gmail.
export function B2bBulkBar({ selected, places, prepared, search, pipelines, mainStages, busy, onPrepared, onCnpjStatus, onImported, onCreatedLeads, onClear }: {
  selected: string[]; places: Place[]; prepared: Record<string, CompanyData>; search: SearchInput | null; pipelines: PipelineOption[]; mainStages: Stage[]; busy: boolean;
  onPrepared: (updates: Record<string, CompanyData>) => void; onCnpjStatus: (updates: Record<string, CnpjStatus>) => void; onImported: (count: number) => void; onCreatedLeads?: (leadIds: string[]) => void; onClear: () => void;
}) {
  const importFn = useServerFn(importB2b), nameFn = useServerFn(searchB2bPublicNames), publicFn = useServerFn(lookupB2bPublic), moveFn = useServerFn(bulkMoveCrmLeads);
  const [msg, setMsg] = useState(""), [err, setErr] = useState(""), [working, setWorking] = useState("");
  const [dialog, setDialog] = useState(false), [pipelineId, setPipelineId] = useState("main"), [stageId, setStageId] = useState(""), [confirmed, setConfirmed] = useState(false);
  const placeById = new Map(places.map(p => [p.id, p]));
  const chosen = selected.filter(id => placeById.has(id) || prepared[id]);
  const stagesOf = (id: string) => id === "main" ? mainStages : pipelines.find(p => p.id === id)?.stages ?? [];
  const stages = stagesOf(pipelineId).filter(s => s.id !== "fechado");
  const disabled = busy || Boolean(working);

  async function copyEmails() {
    setErr(""); setMsg("");
    const { emails } = collectEmails(chosen.map(id => companyEmails(prepared[id])));
    if (!emails.length) { setMsg("Nenhum e-mail disponível nas empresas selecionadas. O Google Maps não informa e-mails: eles aparecem após identificar o CNPJ ou preencher na revisão."); return; }
    setMsg(await copyText(gmailList(emails)) ? `${emails.length} e-mail(s) copiado(s) com sucesso${emails.length < chosen.length ? ` (${chosen.length - emails.length} empresa(s) sem e-mail válido)` : ""}. Cole no campo Cco do Gmail.` : "Não foi possível acessar a área de transferência neste navegador.");
  }
  async function copyPhones() {
    setErr(""); setMsg("");
    const phones = collectPhones(chosen.map(id => companyPhones(placeById.get(id), prepared[id])));
    if (!phones.length) { setMsg("Nenhum telefone disponível nas empresas selecionadas."); return; }
    setMsg(await copyText(phones.join("\n")) ? `${phones.length} telefone(s) copiado(s), um por linha.` : "Não foi possível acessar a área de transferência neste navegador.");
  }
  function exportCsv() {
    const rows = chosen.map(id => { const p = placeById.get(id), c = prepared[id];
      return [c?.tradeName || p?.name || "", c?.legalName || "", c?.cnpj || "", companyEmails(c).join(", "), companyPhones(p, c).join(", "), c?.website || p?.website || "", c?.instagram || p?.instagram || "", c?.address || p?.address || "", p?.mapsUrl || "", c?.segment || p?.category || ""]; });
    download(`prospeccao-b2b-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(["Empresa", "Razão social", "CNPJ", "E-mails", "Telefones", "Site", "Instagram", "Endereço", "Google Maps", "Segmento"], rows));
    setMsg(`${rows.length} contato(s) exportado(s) em CSV.`);
  }
  // Identificação de CNPJ sem custo: procura no histórico privado de consultas públicas por nome + cidade/UF e só
  // associa com candidato único; em seguida usa a consulta pública por CNPJ (cache de 24 h) para enriquecer.
  async function identify() {
    setErr(""); setMsg(""); setWorking("identify");
    const targets = chosen.filter(id => placeById.has(id) && !prepared[id]?.cnpj).slice(0, 50);
    const statuses: Record<string, CnpjStatus> = {}, updates: Record<string, CompanyData> = {};
    let found = 0, enriched = 0;
    try {
      for (const id of targets) {
        const place = placeById.get(id)!; statuses[id] = "pendente";
        try {
          const { companies } = await nameFn({ data: { name: place.name.slice(0, 150), purposeConfirmed: true } });
          const pick = pickCnpjCandidate(place, companies, search);
          if (pick.status !== "identificado") { statuses[id] = pick.status; continue; }
          found++; statuses[id] = "identificado";
          const full = await publicFn({ data: { cnpj: pick.company.cnpj, purposeConfirmed: true } }).catch(() => null);
          const company = full && "company" in full && full.company ? (full.company as CompanyData) : pick.company;
          updates[id] = mergeIdentified(place, search, company); statuses[id] = "enriquecido"; enriched++;
        } catch { statuses[id] = "pendente"; }
      }
      onCnpjStatus(statuses); onPrepared(updates);
      setMsg(`${targets.length} empresa(s) verificada(s): ${found} CNPJ identificado(s), ${enriched} com dados enriquecidos, ${targets.length - found} sem identificação confiável (ficam sem CNPJ).${chosen.length > targets.length ? " Máximo de 50 por vez; empresas que já têm CNPJ foram puladas." : ""}`);
    } finally { setWorking(""); }
  }
  async function addToCrm() {
    setErr(""); setMsg(""); setWorking("import");
    const companies: { id: string; company: NonNullable<ReturnType<typeof placeToCompany> & { ok: true }>["company"] }[] = [];
    const reasons: string[] = []; let failed = 0;
    for (const id of chosen) {
      const place = placeById.get(id);
      const built = place ? placeToCompany(place, search, prepared[id]) : prepared[id] ? placeToCompany({ id: prepared[id].placeId, name: prepared[id].tradeName, address: prepared[id].address, phone: "", website: "", category: "", mapsUrl: "", rating: null, userRatingCount: null, instagram: "", attributions: [] }, search, prepared[id]) : { ok: false as const, reason: "empresa não encontrada" };
      if (built.ok) companies.push({ id, company: built.company }); else { failed++; reasons.push(built.reason); }
    }
    // Duplicados dentro da própria seleção (mesmo CNPJ ou mesmo identificador do Maps) contam como já existentes.
    const seen = new Set<string>(); const unique = companies.filter(c => { const key = c.company.cnpj || `place:${c.company.placeId}`; if (seen.has(key)) return false; seen.add(key); return true; });
    let created = 0, existing = companies.length - unique.length; const createdLeadIds: string[] = [];
    const pipeline = pipelineId === "main" ? null : pipelineId;
    try {
      for (const batch of chunk(unique, 20)) {
        try {
          const result = await importFn({ data: { pipelineId: pipeline, companies: batch.map(b => b.company), confirmed: true } });
          for (const r of result) { if (r.status === "created") { created++; if (r.leadId) createdLeadIds.push(r.leadId); } else existing++; }
        } catch (e) { failed += batch.length; reasons.push(e instanceof Error ? e.message.slice(0, 80) : "falha na importação"); }
      }
      // A importação cria na primeira etapa; se outra etapa foi escolhida, move os cards criados (com histórico).
      const first = stagesOf(pipelineId)[0]?.id;
      let moveNote = "";
      if (createdLeadIds.length && stageId && stageId !== first) {
        const stage = stagesOf(pipelineId).find(s => s.id === stageId);
        const name = pipelineId === "main" ? "Funil principal" : pipelines.find(p => p.id === pipelineId)?.name ?? "Funil";
        let moved = 0;
        for (const ids of chunk(createdLeadIds, 40)) { try { const r = await moveFn({ data: { ids, pipelineId: pipeline, stage: stageId, stageTitle: stage?.title ?? stageId, pipelineName: name } }); moved += r.moved; } catch { /* permanecem na primeira etapa */ } }
        moveNote = moved < createdLeadIds.length ? ` ${createdLeadIds.length - moved} card(s) ficaram na primeira etapa do funil.` : "";
      }
      onImported(created);
      // Consulta Pública Gratuita em segundo plano: os cards já existem; o enriquecimento não bloqueia o cadastro.
      if (createdLeadIds.length) onCreatedLeads?.(createdLeadIds);
      setMsg(bulkSummaryText({ selected: chosen.length, done: created, existing, failed, reasons }) + moveNote + (createdLeadIds.length && onCreatedLeads ? " A Consulta Pública Gratuita começou em segundo plano." : ""));
      setDialog(false); setConfirmed(false);
    } finally { setWorking(""); }
  }
  if (!selected.length) return null;
  return <div className="space-y-2 rounded-xl border border-primary/40 bg-card p-3 text-sm" role="region" aria-label="Ações em massa">
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-semibold">{chosen.length} empresa(s) selecionada(s)</span>
      <Button size="sm" disabled={disabled} onClick={() => void copyEmails()}>Copiar todos os e-mails</Button>
      <Button size="sm" variant="outline" disabled={disabled} onClick={() => void copyPhones()}>Copiar telefones</Button>
      <Button size="sm" variant="outline" disabled={disabled} onClick={exportCsv}>Exportar contatos</Button>
      <Button size="sm" variant="outline" disabled={disabled} onClick={() => void identify()}>{working === "identify" ? "Identificando…" : "Identificar CNPJ"}</Button>
      <Button size="sm" variant="outline" disabled={disabled} onClick={() => { setDialog(v => !v); setStageId(""); }}>Adicionar ao CRM</Button>
      <Button size="sm" variant="ghost" disabled={disabled} onClick={onClear}>Desmarcar todos</Button>
    </div>
    {dialog && <div className="space-y-2 rounded-lg border p-3">
      <p className="font-medium">Cadastro em massa no CRM · {chosen.length} empresa(s)</p>
      <div className="flex flex-wrap items-end gap-3">
        <label>Funil<select className="ml-2 rounded-md border bg-background px-2 py-1" value={pipelineId} onChange={e => { setPipelineId(e.target.value); setStageId(""); }}><option value="main">Funil principal</option>{pipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Etapa inicial<select className="ml-2 rounded-md border bg-background px-2 py-1" value={stageId} onChange={e => setStageId(e.target.value)}><option value="">{stages[0]?.title ?? "Primeira etapa"} (padrão)</option>{stages.slice(1).map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
      </div>
      <label className="flex items-start gap-2"><input type="checkbox" className="mt-1 accent-primary" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Confirmo que revisei a seleção e autorizo cadastrar essas empresas no CRM com os dados disponíveis (CNPJ não obrigatório; e-mails só quando identificados). Empresas já existentes não serão duplicadas.</label>
      <div className="flex gap-2"><Button size="sm" disabled={!confirmed || disabled} onClick={() => void addToCrm()}>{working === "import" ? "Cadastrando…" : "Confirmar cadastro"}</Button><Button size="sm" variant="ghost" onClick={() => setDialog(false)}>Cancelar</Button></div>
    </div>}
    {msg && <p role="status" className="text-muted-foreground">{msg}</p>}
    {err && <p role="alert" className="text-destructive">{err}</p>}
  </div>;
}
