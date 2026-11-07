import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  Search,
  Building2,
  ExternalLink,
  Mail,
  Plus,
  Loader2,
  LayoutGrid,
  List,
  Sparkles,
  ChevronRight,
  X,
  Check,
} from "lucide-react";
import { B2bLayout } from "@/components/crm/B2bLayout";
import { B2bFlowHeader } from "./B2bFlowHeader";
import { ReceitaSearchPanel } from "@/components/crm/b2b/ReceitaSearch";
import { InstagramSearchPanel } from "@/components/crm/b2b/InstagramSearch";
import { receitaCompany } from "@/lib/receita-federal";
import { CrmAuthGate } from "@/components/crm/CrmAuthGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  BRAZIL_STATES,
  cnpjInput,
  companyInput,
  EMAIL_TEMPLATES,
  renderEmail,
  type CompanyData,
  type CompanyInput,
  type Place,
  type SearchInput,
} from "@/lib/b2b-prospecting";
import {
  getB2bOverview,
  searchB2b,
  importB2b,
  getB2bCredits,
  testDeskDataConnection,
  saveB2bDraft,
  suppressB2bEmail,
} from "@/lib/b2b-prospecting.functions";
import { listPipelines } from "@/lib/pipelines.functions";
import { B2bHybridLookup } from "@/components/crm/B2bHybridLookup";
import { CompanyFinancialData } from "@/components/crm/CompanyFinancialData";
import { B2B_TABLE_STATUS_LABELS } from "@/lib/b2b-readiness";
import { businessLinks } from "@/lib/business-links";
import { B2bAiEmails } from "@/components/crm/B2bAiEmails";
import { type EmailCompany } from "@/lib/b2b-email-ai";
import { B2bBulkBar } from "@/components/crm/B2bBulkBar";
import { PlacePublicData, placeEmail, type PlaceLookup } from "@/components/crm/PlacePublicData";
import { lookupPlacesPublic } from "@/lib/b2b-public-enrichment.functions";
import { searchB2bSiteEmails } from "@/lib/b2b-site-emails.functions";
import { bestContact, EMAIL_KIND_LABEL, SITE_EMAIL_STATUS_LABEL, type SiteEmailResult } from "@/lib/b2b-site-emails";
import { mergeProfile, type FieldRow } from "@/lib/b2b-public-enrichment";
import { PublicEnrichmentProgress } from "@/components/crm/PublicEnrichmentProgress";
import { CompanyInsightsBulk } from "@/components/crm/CompanyInsightsBulk";
import { CNPJ_STATUS_LABEL, type CnpjStatus } from "@/lib/b2b-bulk";
import { selectMany, toggleOne, unselectMany } from "@/lib/bulk-actions";
import { useStages } from "@/hooks/use-stages";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { saveLeadInteraction } from "@/lib/lead-interactions.functions";
import { EmailListImport } from "@/components/crm/b2b/EmailListImport";
import {
  B2B_SESSION_KEY,
  B2B_STEPS,
  CONTACT_STAGE_LABEL,
  FIRST_CONTACT_CHANNELS,
  contactStage,
  currentB2bSelection,
  freshB2bSearch,
  firstContactNote,
  parseB2bSession,
  parseB2bStep,
  removeSelected,
  type B2bSessionState,
  type B2bStep,
  type FirstContactChannel,
} from "@/lib/b2b-flow";

const blankCompany = (placeId = ""): CompanyData => ({
  placeId,
  cnpj: "",
  legalName: "",
  tradeName: "",
  registrationStatus: "",
  segment: "",
  city: "",
  state: "",
  address: "",
  phones: [],
  whatsappNumbers: [],
  partners: [],
  emails: [],
  website: "",
  instagram: "",
  source: "manual",
  sourceReference: "",
});
const selectClass = "h-10 w-full rounded-md border bg-background px-3 text-sm";

export function B2bWorkspace() {
  const overviewFn = useServerFn(getB2bOverview),
    searchFn = useServerFn(searchB2b),
    importFn = useServerFn(importB2b),
    creditsFn = useServerFn(getB2bCredits),
    testDeskDataFn = useServerFn(testDeskDataConnection),
    draftFn = useServerFn(saveB2bDraft),
    suppressFn = useServerFn(suppressB2bEmail),
    pipelinesFn = useServerFn(listPipelines);
  const overview = useQuery({
    queryKey: ["b2b-overview"],
    queryFn: () => overviewFn(),
    retry: false,
    gcTime: 0,
  });
  const pipelines = useQuery({
    queryKey: ["b2b-pipelines"],
    queryFn: () => pipelinesFn(),
    enabled: Boolean(overview.data),
    retry: false,
    gcTime: 0,
  });
  const [filters, setFilters] = useState<SearchInput>({
    segment: "empresas de facilities",
    city: "Curitiba",
    state: "PR",
  });
  const [searched, setSearched] = useState<SearchInput | null>(null),
    [places, setPlaces] = useState<Place[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"relevance" | "rating" | "reviews">("relevance"),
    [onlyRated, setOnlyRated] = useState(false),
    [onlyPhone, setOnlyPhone] = useState(false),
    [onlySite, setOnlySite] = useState(false),
    [onlyEmail, setOnlyEmail] = useState(false);
  const [lookups, setLookups] = useState<Record<string, PlaceLookup>>({}), [lookingUp, setLookingUp] = useState<string[]>([]);
  const lookupFn = useServerFn(lookupPlacesPublic);
  const emailSearchFn = useServerFn(searchB2bSiteEmails);
  // Resultados da pesquisa de e-mails: cada rodada substitui a anterior (nunca mistura consultas).
  const [emailRun, setEmailRun] = useState<{ results: Record<string, SiteEmailResult>; done: number; total: number; running: boolean } | null>(null);
  // Session cache avoids charging again for an identical search already loaded.
  const searchCache = useRef(new Map<string, { places: Place[]; cursor: string | null }>());
  const [cnpjStatus, setCnpjStatus] = useState<Record<string, CnpjStatus>>({});
  // Dados identificados automaticamente (CNPJ público): não contam como revisados pelo usuário.
  const [enriched, setEnriched] = useState<Record<string, CompanyData>>({});
  const mainStages = useStages().stages;
  const [selectedIds, setSelected] = useState<string[]>([]),
    [prepared, setPrepared] = useState<Record<string, CompanyInput>>({}),
    [view, setView] = useState<"cards" | "list">("cards");
  const selected = currentB2bSelection(selectedIds, places, prepared, enriched);
  const searchGeneration = useRef(0);
  const [pendingSearch, setPendingSearch] = useState<SearchInput | null>(null);
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<CompanyData | null>(null),
    [editorKey, setEditorKey] = useState("");
  const [identity, setIdentity] = useState(false),
    [storage, setStorage] = useState(false);
  const [pipelineId, setPipelineId] = useState("main"),
    [confirmImport, setConfirmImport] = useState(false),
    [imported, setImported] = useState(0);
  const [enrichLeadIds, setEnrichLeadIds] = useState<string[]>([]);
  const [leadId, setLeadId] = useState(""),
    [recipient, setRecipient] = useState(""),
    [sender, setSender] = useState(""),
    [template, setTemplate] = useState("intro"),
    [subject, setSubject] = useState(""),
    [body, setBody] = useState(""),
    [reviewed, setReviewed] = useState(false);
  const [blockEmail, setBlockEmail] = useState(""),
    [blockReason, setBlockReason] = useState(""),
    [blockConfirmed, setBlockConfirmed] = useState(false);
  const [aiRequest, setAiRequest] = useState<{nonce:number;companies:EmailCompany[]}|null>(null);
  const [showAllSelected, setShowAllSelected] = useState(false);
  const location = useRouterState({ select: r => r.location });
  const step: B2bStep = location.pathname.endsWith("/revisar") ? "revisar" : location.pathname.endsWith("/primeiro-contato") ? "contato" : parseB2bStep((location.search as { etapa?: unknown }).etapa) ?? "buscar";
  const origin = location.pathname.endsWith("/receita-federal") ? "receita" : location.pathname.endsWith("/importar-listas") ? "lista" : location.pathname.endsWith("/instagram") ? "instagram" : "maps";
  const navigate = useNavigate();
  /** Ação única depois da seleção: abre a preparação do disparo e leva à prévia em lote. */
  function prepareDispatch(list: EmailCompany[]) {
    setAiRequest({ nonce: Date.now(), companies: list });
    if (step !== "contato") void navigate({ to: "/prospeccao-b2b/primeiro-contato" });
  }
  const [sessionLeadIds, setSessionLeadIds] = useState<string[]>([]);
  const [contactFilter, setContactFilter] = useState<"pendentes" | "abordadas" | "todas">("pendentes");
  const [approach, setApproach] = useState<{ leadId: string; name: string } | null>(null),
    [approachChannel, setApproachChannel] = useState<FirstContactChannel>("email"),
    [approachNote, setApproachNote] = useState(""),
    [approachSaving, setApproachSaving] = useState(false),
    [approachError, setApproachError] = useState("");
  const approachId = useRef<string | null>(null);
  const saveInteractionFn = useServerFn(saveLeadInteraction);
  // A seleção e os resultados ficam guardados nesta aba: trocar de etapa, de modo (Cards/Lista)
  // ou abrir outra página não apaga o que já foi marcado.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    const saved = parseB2bSession<Place, CompanyInput, SearchInput, CompanyData>(sessionStorage.getItem(B2B_SESSION_KEY));
    if (saved) {
      setFilters(saved.filters);
      setSearched(saved.searched);
      setPlaces(saved.places);
      setCursor(saved.cursor);
      setSelected(saved.selected);
      setPrepared(saved.prepared);
      setEnriched(saved.enriched);
      setCnpjStatus(saved.cnpjStatus as Record<string, CnpjStatus>);
      setView(saved.view);
      setImported(saved.imported);
      setSessionLeadIds(saved.leadIds);
    }
    setRestored(true);
  }, []);
  useEffect(() => {
    if (!restored) return;
    const state: B2bSessionState<Place, CompanyInput, SearchInput, CompanyData> = { v: 1, filters, searched, places, cursor, selected, prepared, enriched, cnpjStatus, view, imported, leadIds: sessionLeadIds };
    try { sessionStorage.setItem(B2B_SESSION_KEY, JSON.stringify(state)); } catch { /* armazenamento cheio: segue só em memória */ }
  }, [restored, filters, searched, places, cursor, selected, prepared, enriched, cnpjStatus, view, imported, sessionLeadIds]);
  useEffect(() => { try { const v = sessionStorage.getItem("pipeflow:b2b-public-lookups"); if (v) setLookups(JSON.parse(v)); } catch { /* ignora */ } }, []);
  useEffect(() => { if (!restored) return; try { sessionStorage.setItem("pipeflow:b2b-public-lookups", JSON.stringify(lookups)); } catch { /* cheio */ } }, [restored, lookups]);
  function placeBase(p: Place): CompanyData {
    if (enriched[p.id]) return enriched[p.id];
    const phone = p.phone.replace(/\D/g, "");
    return { ...blankCompany(p.id), tradeName: p.name, address: p.address, segment: p.category, city: searched?.city ?? "", state: (searched?.state ?? "") as CompanyData["state"],
      phones: /^\+?\d{8,15}$/.test(phone) ? [phone] : [], ...businessLinks(p.website, p.instagram), sourceReference: "Google Maps + consulta pública" };
  }
  /** Busca dados públicos (site, CNPJ por nome/cidade/UF) antes de criar os cards; 5 por chamada, em sequência. */
  async function runLookups(list: Place[]) {
    const generation = searchGeneration.current;
    const todo = list.filter((p) => places.some((current) => current.id === p.id) && !lookingUp.includes(p.id)).slice(0, 30);
    if (!todo.length) return;
    setLookingUp((o) => [...o, ...todo.map((p) => p.id)]);
    setError("");
    try {
      for (let i = 0; i < todo.length; i += 5) {
        if (generation !== searchGeneration.current) return;
        const chunk = todo.slice(i, i + 5);
        const out = await lookupFn({ data: { places: chunk.map((p) => ({ key: p.id, name: p.name.slice(0, 300), address: p.address.slice(0, 700), website: p.website.slice(0, 2000), city: (searched?.city ?? "").slice(0, 100), state: (searched?.state ?? "").slice(0, 2), phone: p.phone.slice(0, 40) })) } });
        if (generation !== searchGeneration.current) return;
        setLookups((o) => { const n = { ...o }; for (const r of out) n[r.key] = { result: r.result, error: r.error }; return n; });
        setLookingUp((o) => o.filter((id) => !chunk.some((p) => p.id === id)));
      }
    } catch (e) {
      if (generation !== searchGeneration.current) return;
      setError(e instanceof Error ? e.message : "Falha na consulta pública.");
    } finally {
      if (generation === searchGeneration.current) setLookingUp((o) => o.filter((id) => !todo.some((p) => p.id === id)));
    }
  }
  /** Pesquisa e-mails públicos nos sites das empresas (individual ou em lote). Nova rodada substitui os resultados anteriores. */
  async function runEmailSearch(list: Place[]) {
    const generation = searchGeneration.current;
    const todo = list.filter((p) => places.some((current) => current.id === p.id))
      .filter((p) => p.website || prepared[p.id]?.website || enriched[p.id]?.website || prepared[p.id]?.cnpj || enriched[p.id]?.cnpj).slice(0, 30);
    if (!todo.length) { setError("Nenhuma das empresas tem site ou CNPJ para pesquisar e-mails."); return; }
    setError("");
    setNotice("");
    setEmailRun({ results: {}, done: 0, total: todo.length, running: true });
    const acc: Record<string, SiteEmailResult> = {};
    try {
      for (let i = 0; i < todo.length; i += 5) {
        if (generation !== searchGeneration.current) return;
        const chunk = todo.slice(i, i + 5);
        const out = await emailSearchFn({ data: { places: chunk.map((p) => ({ key: p.id, name: p.name.slice(0, 300), website: (prepared[p.id]?.website || enriched[p.id]?.website || p.website).slice(0, 2000), cnpj: (prepared[p.id]?.cnpj || enriched[p.id]?.cnpj || "").slice(0, 20) || undefined })) } });
        if (generation !== searchGeneration.current) return;
        for (const r of out) acc[r.key] = r;
        setEmailRun({ results: { ...acc }, done: Math.min(i + 5, todo.length), total: todo.length, running: true });
      }
      const found = Object.values(acc).filter((r) => r.contacts.length > 0).length;
      setNotice(`Pesquisa de e-mails concluída: ${todo.length} consultada(s), ${found} com e-mail encontrado.`);
    } catch (e) {
      if (generation !== searchGeneration.current) return;
      setError(e instanceof Error ? e.message : "Falha na pesquisa de e-mails.");
    } finally {
      if (generation === searchGeneration.current) setEmailRun((old) => (old ? { ...old, running: false } : old));
    }
  }
  function emailResult(p: Place): SiteEmailResult | undefined {
    return emailRun?.results[p.id];
  }
  function emailBlock(p: Place) {
    const r = emailResult(p);
    if (!r) return null;
    const best = bestContact(r.contacts, r.site);
    return (
      <div className="mt-2 space-y-1 rounded-md border p-2 text-xs" aria-label={`E-mails encontrados de ${p.name}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">E-mails do site</span>
          <span className={r.contacts.length ? "text-primary" : "text-muted-foreground"}>{SITE_EMAIL_STATUS_LABEL[r.status]}{r.fromCache ? " · cache" : ""}</span>
        </div>
        {r.contacts.map((c) => (
          <p key={c.email} className="break-all">
            <span className="font-medium">{c.email}</span>
            <span className="text-muted-foreground"> · {c.source === "fiscal" ? "Cadastro fiscal (pode ser do contador)" : EMAIL_KIND_LABEL[c.kind]}{best?.email === c.email && c.source === best.source ? " · melhor contato" : ""}</span>
            {c.page && <a className="ml-1 underline text-muted-foreground" href={c.page} target="_blank" rel="noreferrer">origem<ExternalLink className="ml-0.5 inline size-3" /></a>}
          </p>
        ))}
        {r.note && <p className="text-muted-foreground">{r.note}</p>}
      </div>
    );
  }
  function addField(p: Place, row: FieldRow) {
    const base = placeBase(p), v = row.value;
    const next: CompanyData = { ...base };
    if (row.key === "cnpj") { next.cnpj = v; const c = lookups[p.id]?.result?.company; if (c && c.cnpj === v) { next.legalName ||= c.legalName; next.address ||= c.address; next.registrationStatus = c.registrationStatus; next.city ||= c.city; next.state ||= c.state; next.partners = c.partners ?? next.partners; next.publicDetails = c.publicDetails ?? next.publicDetails; } setCnpjStatus((o) => ({ ...o, [p.id]: "identificado" })); }
    if (row.key === "legalName") next.legalName = v.slice(0, 300);
    if (row.key === "address") next.address = v.slice(0, 700);
    if (row.key === "website") next.website = v;
    if (row.key === "siteEmail" || row.key === "fiscalEmail") next.emails = [...new Set([...base.emails, v.toLowerCase()])].slice(0, 10);
    if (row.key === "whatsapp") { next.whatsappNumbers = [...new Set([...(base.whatsappNumbers ?? []), v])].slice(0, 10); next.phones = [...new Set([...base.phones, v])].slice(0, 10); }
    setEnriched((o) => ({ ...o, [p.id]: next }));
  }
  function fieldAdded(p: Place, row: FieldRow) {
    const c = prepared[p.id] ?? enriched[p.id]; if (!c) return false;
    const v = row.value.toLowerCase();
    return row.key === "cnpj" ? c.cnpj === row.value : row.key === "legalName" ? c.legalName.toLowerCase() === v : row.key === "address" ? c.address.toLowerCase() === v
      : row.key === "website" ? c.website.toLowerCase() === v : row.key === "whatsapp" ? (c.whatsappNumbers ?? []).includes(row.value) : c.emails.includes(v);
  }
  function publicData(p: Place) {
    return <PlacePublicData lookup={lookups[p.id]} busy={Boolean(busy)} running={lookingUp.includes(p.id)} onLookup={() => void runLookups([p])}
      onAdd={(row) => addField(p, row)} added={(row) => fieldAdded(p, row)}
      onChoose={(c) => { setEnriched((o) => ({ ...o, [p.id]: mergeProfile(placeBase(p), c, p.name) })); setCnpjStatus((o) => ({ ...o, [p.id]: "identificado" })); }} />;
  }
  function emailLine(p: Place) {
    const e = placeEmail(prepared[p.id] ?? enriched[p.id], lookups[p.id]);
    return <p className="mt-1 break-all text-xs">{e ? <><span className="font-medium">{e.email}</span> <span className="text-muted-foreground">· {e.source}</span></> : <span className="text-muted-foreground">E-mail: {lookups[p.id] ? "não encontrado" : "ainda não pesquisado"}</span>}</p>;
  }
  async function registerApproach() {
    if (!approach || approachSaving) return;
    setApproachSaving(true);
    setApproachError("");
    const id = approachId.current ?? crypto.randomUUID();
    approachId.current = id;
    try {
      const result = await saveInteractionFn({ data: { leadId: approach.leadId, id, type: "interaction", date: new Date().toISOString(), note: firstContactNote(approachChannel, approachNote), responsible: "", result: "unknown" } });
      if (!result.ok) { setApproachError(result.error ?? "Não foi possível registrar. Tente novamente."); return; }
      approachId.current = null;
      setNotice(`Abordagem de ${approach.name} registrada no histórico do card.`);
      setApproach(null);
      await overview.refetch();
    } catch {
      setApproachError("Não foi possível registrar. Seus dados foram mantidos; tente novamente.");
    } finally {
      setApproachSaving(false);
    }
  }
  function aiCompany(key:string, company?:CompanyData, place?:Place):EmailCompany {
    const segmentTag = (searched?.segment || company?.segment || place?.category || "")
      .replace(/^(?:empresas?|serviços?)\s+(?:de|do|da)\s+/iu, "").trim().slice(0, 100);
    return {key,...(place?{mapsPlaceId:place.id,segmentTag:segmentTag.charAt(0).toUpperCase()+segmentTag.slice(1)}:{}),name:company?.tradeName||company?.legalName||place?.name||"",segment:company?.segment||place?.category||"",website:businessLinks(company?.website||place?.website||"",company?.instagram||place?.instagram||"").website,city:company?.city||searched?.city||"",email:company?.emails[0]||"",services:"",servicesSource:"",source:company?.sourceReference||(place?"Google Maps — informações já carregadas":"Informações fornecidas pelo usuário, aguardando conferência"),
      ...(company?.cnpj?{cnpj:company.cnpj}:{}),...((company?.state||searched?.state)?{state:(company?.state||searched?.state||"").slice(0,2)}:{}),
      ...((company?.address||place?.address)?{address:(company?.address||place?.address||"").slice(0,700)}:{}),
      ...(((company?.whatsappNumbers??[])[0]||company?.phones[0]||place?.phone)?{whatsapp:((company?.whatsappNumbers??[])[0]||company?.phones[0]||place?.phone||"").replace(/\D/g,"").slice(0,20)}:{})};
  }
  const aiSelected = selected.flatMap(key=>{
    const place=places.find(p=>p.id===key);
    const base=prepared[key]??enriched[key];
    const lk=lookups[key]?placeEmail(base,lookups[key]):null;
    const withLk=(c:CompanyData)=>lk&&!c.emails.length?{...c,emails:[lk.email]}:c;
    const company=base?withLk(base):place&&lk?withLk(placeBase(place)):undefined;
    return company||place?[aiCompany(key,company,place)]:[];
  });
  const config = overview.data;
  const approachedIds = new Set((config?.approaches ?? []).map((a) => a.lead_id));
  const selectedReady = selected.flatMap((id) => (prepared[id] ? [prepared[id]] : []));
  const latestBalance = config?.todayRequests.find((r) => r.credit_balance !== null);
  const storedCompanies = (config?.companies ?? []).flatMap((row) => {
    const parsed = companyInput.safeParse({
      ...(row.profile as object),
      identityConfirmed: true,
      storageAuthorized: true,
    });
    return parsed.success && row.lead_id ? [{ ...row, profile: parsed.data }] : [];
  });
  const mailCompany = storedCompanies.find((row) => row.lead_id === leadId);
  const blocked = config?.suppressions.some((s) => s.email === recipient);
  const visiblePlaces = places.map(p => ({ ...p, ...businessLinks(p.website, p.instagram) }))
    .filter((p) => !onlyRated || p.rating !== null)
    .filter((p) => !onlyPhone || p.phone)
    .filter((p) => !onlySite || p.website)
    .filter((p) => !onlyEmail || Boolean(placeEmail(prepared[p.id] ?? enriched[p.id], lookups[p.id])) || Boolean(emailRun?.results[p.id]?.contacts.length))
    .sort((a, b) =>
      sortBy === "rating"
        ? (b.rating ?? -1) - (a.rating ?? -1)
        : sortBy === "reviews"
          ? (b.userRatingCount ?? -1) - (a.userRatingCount ?? -1)
          : 0,
    );
  const visibleIds = visiblePlaces.map((p) => p.id);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id));
  const pendingSelected = selected.filter(
    (id) => !prepared[id] && (places.some((p) => p.id === id) || Boolean(enriched[id])),
  );
  function toggleVisibleSelection() {
    setSelected((old) =>
      allVisibleSelected
        ? old.filter((id) => !visibleIds.includes(id))
        : [...old, ...visibleIds.filter((id) => !old.includes(id))],
    );
  }
  function prepareNextSelected() {
    const next = places.find((p) => pendingSelected.includes(p.id));
    if (next) { edit(next); return; }
    const key = pendingSelected.find(id => enriched[id]);
    if (key) { setEditorKey(key); setEditor(enriched[key]); setIdentity(false); setStorage(false); }
  }
  async function action(name: string, work: () => Promise<void>) {
    if (busy) return;
    setBusy(name);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível concluir a ação.");
    } finally {
      setBusy("");
    }
  }
  function edit(place?: Place) {
    setError("");
    const key = place?.id ?? `manual-${crypto.randomUUID()}`;
    setEditorKey(key);
    const found = place ? emailRun?.results[place.id] : undefined;
    const best = found ? bestContact(found.contacts, found.site) : null;
    const withBest = (c: CompanyData): CompanyData =>
      best && !c.emails.length ? { ...c, emails: [best.email] } : c;
    if (prepared[key]) {
      setEditor(prepared[key]);
    } else if (place && enriched[key]) {
      setEditor(withBest({ ...enriched[key], sourceReference: enriched[key].sourceReference || "Pesquisa Google Maps revisada pelo usuário" }));
    } else if (place) {
      const phone = place.phone.replace(/\D/g, "");
      setEditor(withBest({
        ...blankCompany(place.id),
        tradeName: place.name,
        address: place.address,
        segment: place.category,
        phones: /^\+?\d{8,15}$/.test(phone) ? [phone] : [],
        ...businessLinks(place.website, place.instagram),
        sourceReference: "Pesquisa Google Maps revisada pelo usuário",
      }));
    } else setEditor(blankCompany());
    setIdentity(false);
    setStorage(false);
  }
  function change<K extends keyof CompanyData>(key: K, value: CompanyData[K]) {
    setEditor((old) => (old ? { ...old, [key]: value } : old));
    setIdentity(false);
    setStorage(false);
  }
  async function runSearch(more = false, confirmed = false, requestedQuery = filters) {
    if (busy) return;
    if (!config?.googleReady || !config.databaseReady) {
      setError("Conclua as pendências indicadas no status da busca antes de consultar.");
      return;
    }
    if (!more && !confirmed && (Object.keys(prepared).length > 0 || editor)) {
      setPendingSearch({ ...requestedQuery });
      return;
    }
    const query = { ...(more && searched ? searched : requestedQuery) };
    const cacheKey = `${query.segment}|${query.city}|${query.state}`.toLowerCase();
    if (!more) {
      searchGeneration.current += 1;
      const fresh = freshB2bSearch({ v: 1, filters, searched, places, cursor, selected, prepared, enriched, cnpjStatus, view, imported, leadIds: sessionLeadIds }, query);
      setSearched(fresh.searched);
      setPlaces(fresh.places);
      setCursor(fresh.cursor);
      setSelected(fresh.selected);
      setPrepared(fresh.prepared);
      setEnriched(fresh.enriched);
      setCnpjStatus(fresh.cnpjStatus as Record<string, CnpjStatus>);
      setLookups({});
      setLookingUp([]);
      setEmailRun(null);
      setEditor(null);
      setEditorKey("");
      setIdentity(false);
      setStorage(false);
      setConfirmImport(false);
      setAiRequest(null);
      setPendingSearch(null);
      setError("");
      setNotice("");
    }
    const cached = !more ? searchCache.current.get(cacheKey) : undefined;
    if (cached) {
      setPlaces(cached.places);
      setCursor(cached.cursor);
      setNotice("Resultados já carregados nesta sessão; nenhuma nova consulta paga foi feita.");
      return;
    }
    await action("search", async () => {
      const result = await searchFn({ data: { ...query, ...(more && cursor ? { cursor } : {}) } });
      if (!more) {
        setPlaces(result.places);
        searchCache.current.set(cacheKey, { places: result.places, cursor: result.cursor });
      } else
        setPlaces((old) => {
          const merged = [
            ...old,
            ...result.places.filter((p) => !old.some((x) => x.id === p.id)),
          ];
          searchCache.current.set(cacheKey, { places: merged, cursor: result.cursor });
          return merged;
        });
      setCursor(result.cursor);
      await overview.refetch();
    });
  }
  if (overview.isPending)
    return (
      <main className="p-8" aria-busy="true">
        Carregando Prospecção B2B…
      </main>
    );
  if (overview.isError)
    return (
      <main>
        <p role="alert" className="p-5 text-sm">
          A Prospecção B2B exige acesso completo ao CRM.
        </p>
        <CrmAuthGate onUnlock={() => void overview.refetch()} />
      </main>
    );
  const stepCounts: Record<B2bStep, number> = {
    buscar: places.length,
    revisar: selected.length,
    contato: storedCompanies.filter((c) => c.lead_id && contactStage(c.lead_id, config?.drafts ?? [], approachedIds) !== "abordada").length,
  };
  const readyChecks = [
    { label: "Acesso completo ao CRM", ready: true },
    { label: "Módulo ativado", ready: Boolean(config?.enabled) },
    { label: "Credencial Google cadastrada", ready: Boolean(config?.googleKeyConfigured) },
    { label: "URL dos Termos de Uso", ready: Boolean(config?.termsUrl) },
    { label: "URL da Política de Privacidade", ready: Boolean(config?.privacyUrl) },
    { label: "Leitura das quatro tabelas B2B", ready: Boolean(config?.databaseReady) },
  ];
  const pendingChecks = readyChecks.filter((c) => !c.ready).length;
  const selectedRows = selected.map((key) => {
    const place = places.find((p) => p.id === key);
    const company = prepared[key] ?? enriched[key];
    return { key, place, company, ready: Boolean(prepared[key]) };
  });
  const preparedOutside = Object.entries(prepared).filter(([key]) => !selected.includes(key));
  const contactRows = storedCompanies.flatMap((c) => {
    if (!c.lead_id) return [];
    const stage = contactStage(c.lead_id, config?.drafts ?? [], approachedIds);
    return [{ ...c, lead_id: c.lead_id, stage, fromSession: sessionLeadIds.includes(c.lead_id), approach: config?.approaches.find((a) => a.lead_id === c.lead_id) }];
  }).sort((a, b) => Number(b.fromSession) - Number(a.fromSession));
  const visibleContacts = contactRows.filter((c) => contactFilter === "todas" || (contactFilter === "pendentes" ? c.stage !== "abordada" : c.stage === "abordada"));
  return (
    <B2bLayout>
      <Outlet />
      <main className="min-w-0 flex-1">
        <div className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="mx-auto max-w-7xl px-4 pt-3 md:px-10">
            <div className="flex min-h-10 items-center gap-3 pr-28">
              <h1 className="flex min-w-0 items-center gap-2 text-lg font-semibold md:text-xl">
                <Building2 className="size-5 shrink-0 text-primary" />
                <span className="truncate">Prospecção B2B</span>
              </h1>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium hover:bg-muted"
                    aria-label={pendingChecks ? `Status da busca: ${pendingChecks} pendência(s)` : "Status da busca: pronta"}
                  >
                    <span className={`size-2 rounded-full ${pendingChecks ? "bg-destructive" : "bg-primary"}`} aria-hidden />
                    <span className="sm:hidden">{pendingChecks ? pendingChecks : "OK"}</span>
                    <span className="hidden sm:inline">{pendingChecks ? `${pendingChecks} pendência(s)` : "Busca pronta"}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold">Status da busca</p>
                    <Button size="sm" variant="ghost" disabled={overview.isFetching || Boolean(busy)} onClick={() => void overview.refetch()}>
                      {overview.isFetching ? "Verificando…" : "Verificar"}
                    </Button>
                  </div>
                  <ul className="space-y-1">
                    {readyChecks.map(({ label, ready }) => (
                      <li key={label} className="flex justify-between gap-3">
                        <span>{label}</span>
                        <span className={ready ? "shrink-0 font-medium text-primary" : "shrink-0 font-medium text-muted-foreground"}>{ready ? "OK" : "Pendente"}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted-foreground">
                    Consultas empresariais hoje: {config?.todayRequests.filter((r) => r.provider === "deskdata" && r.outcome === "success").length ?? 0}
                  </p>
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer font-medium text-primary">Detalhes técnicos</summary>
                    <ul className="mt-2 space-y-1 break-words">
                      {config?.databaseChecks.map((check) => (
                        <li key={check.table}><code className="break-all">{check.table}</code>: {B2B_TABLE_STATUS_LABELS[check.status]}.</li>
                      ))}
                    </ul>
                    <p className="mt-2">Esta verificação não executa migrações nem consultas ao Google. Credencial e URLs cadastradas não comprovam validade nem aprovação dos documentos.</p>
                  </details>
                </PopoverContent>
              </Popover>
            </div>

          </div>
        </div>
        <div className="mx-auto max-w-7xl space-y-6 px-4 py-5 md:px-10">
          <B2bFlowHeader step={step} path={location.pathname.replace(/\/+$/, "")} counts={{ selected: selected.length, ready: selectedReady.length, toContact: contactRows.filter((c) => c.stage !== "abordada").length, approached: contactRows.filter((c) => c.stage === "abordada").length }} />
          {error && (
            <p role="alert" className="rounded-md border border-destructive p-4 text-sm text-destructive">{error}</p>
          )}
          {notice && (
            <p role="status" className="rounded-md border border-primary/40 p-4 text-sm">{notice}</p>
          )}
          {busy && (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Processando…
            </p>
          )}
          <div hidden={step !== "buscar" || origin !== "receita"}>
          <ReceitaSearchPanel onReview={(rows, competence) => {
            const updates = Object.fromEntries(rows.map(row => [`receita-${row.cnpj}`, receitaCompany(row, competence)]));
            setEnriched(old => ({ ...old, ...updates }));
            setSelected(old => [...new Set([...old, ...Object.keys(updates)])]);
            void navigate({ to: "/prospeccao-b2b/revisar" });
          }} />
          </div>
          <div hidden={step !== "buscar" || origin !== "lista"}><EmailListImport pipelines={pipelines.data ?? []} /></div>
          <div hidden={step !== "buscar" || origin !== "instagram"}>
          <InstagramSearchPanel onReview={(entries) => {
            setEnriched(old => ({ ...old, ...entries }));
            setSelected(old => [...new Set([...old, ...Object.keys(entries)])]);
            void navigate({ to: "/prospeccao-b2b/revisar" });
          }} />
          </div>
          {step === "buscar" && origin === "maps" && <>
          <section className="rounded-xl border bg-card p-4 md:p-5" aria-label="Buscar empresas">
            <form
              className="mt-4 grid items-end gap-4 md:grid-cols-[2fr_1fr_90px_auto]"
              onSubmit={(e) => {
                e.preventDefault();
                void runSearch();
              }}
            >
              <div>
                <Label htmlFor="b2b-segment">Segmento ou palavra-chave</Label>
                <Input
                  id="b2b-segment"
                  value={filters.segment}
                  maxLength={100}
                  minLength={2}
                  required
                  onChange={(e) => setFilters({ ...filters, segment: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="b2b-city">Cidade</Label>
                <Input
                  id="b2b-city"
                  value={filters.city}
                  maxLength={100}
                  minLength={2}
                  required
                  onChange={(e) => setFilters({ ...filters, city: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="b2b-state">Estado</Label>
                <select
                  id="b2b-state"
                  className={selectClass}
                  value={filters.state}
                  onChange={(e) =>
                    setFilters({ ...filters, state: e.target.value as SearchInput["state"] })
                  }
                >
                  {BRAZIL_STATES.map((uf) => (
                    <option key={uf}>{uf}</option>
                  ))}
                </select>
              </div>
              <Button
                type="submit"
                disabled={Boolean(busy) || !config?.googleReady || !config.databaseReady}
              >
                <Search className="size-4" />
                Buscar empresas
              </Button>
            </form>
            <p className="mt-3 text-xs text-muted-foreground">
              {config?.googleReady
                ? `Cada página consulta até 20 resultados. Limite diário: ${config.googleDailyLimit} consultas; usadas: ${config.todayRequests.filter((r) => r.provider === "google").length}. Telefone e site podem aumentar a faixa de cobrança do Google.`
                : "Google Places aguarda credencial, termos de uso e política de privacidade do aplicativo."}
            </p>
            <div className="mt-2 flex gap-4 text-xs">
              {config?.termsUrl && (
                <a href={config.termsUrl} target="_blank" rel="noreferrer" className="underline">
                  Termos de uso
                </a>
              )}
              {config?.privacyUrl && (
                <a href={config.privacyUrl} target="_blank" rel="noreferrer" className="underline">
                  Privacidade
                </a>
              )}
            </div>
          </section>
          <section className="space-y-4" aria-label="Resultados do Google Maps">
            <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-center sm:justify-between">
              <h2 className="min-w-0 text-lg font-semibold">
                Resultados{" "}
                {searched && (
                  <span className="text-sm font-normal text-muted-foreground">
                    · {searched.city}/{searched.state}
                  </span>
                )}
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <div role="group" aria-label="Modo de visualização" className="flex overflow-hidden rounded-md border">
                  <Button variant={view === "cards" ? "default" : "ghost"} size="sm" className="rounded-none" aria-pressed={view === "cards"} onClick={() => setView("cards")}>
                    <LayoutGrid className="size-4" />
                    Cards
                  </Button>
                  <Button variant={view === "list" ? "default" : "ghost"} size="sm" className="rounded-none" aria-pressed={view === "list"} onClick={() => setView("list")}>
                    <List className="size-4" />
                    Lista
                  </Button>
                </div>
                <Button size="sm" variant="outline" disabled={Boolean(busy) || !visibleIds.length} onClick={() => setSelected((old) => selectMany(currentB2bSelection(old, places, prepared), visibleIds))}>
                  Selecionar todos ({visibleIds.length})
                </Button>
                {/* Só aparece quando há filtro ativo (senão faz o mesmo que "Selecionar todos"). */}
                {visibleIds.length > 0 && visibleIds.length !== places.length && <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => setSelected((old) => selectMany(old, visibleIds))} title="Seleciona somente os resultados que passam pelos filtros atuais">
                  Selecionar visíveis ({visibleIds.length})
                </Button>}
                {selected.length > 0 && (
                  <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => setSelected([])}>
                    Desmarcar todos
                  </Button>
                )}
              </div>
            </div>
            {selected.length > 0 && (
              <div className="sticky top-[7.5rem] z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/40 bg-card p-3 shadow-sm">
                <p className="text-sm"><span className="font-semibold">{selected.length}</span> empresa(s) selecionada(s){pendingSelected.length ? ` · ${pendingSelected.length} sem cadastro preparado` : ""}</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={Boolean(busy) || lookingUp.length > 0} onClick={() => void runLookups(places.filter((p) => selected.includes(p.id) && !lookups[p.id]))}>
                    <Search className="size-4" />
                    {lookingUp.length ? `Buscando dados públicos (${lookingUp.length})…` : `Buscar dados públicos (${places.filter((p) => selected.includes(p.id) && !lookups[p.id]).length})`}
                  </Button>
                  <Button size="sm" variant="outline" disabled={Boolean(busy) || Boolean(emailRun?.running)} onClick={() => void runEmailSearch(places.filter((p) => selected.includes(p.id)))}>
                    <Mail className="size-4" />
                    {emailRun?.running ? `Pesquisando e-mails (${emailRun.done} de ${emailRun.total})…` : "Buscar e-mails no site"}
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/prospeccao-b2b/revisar">Revisar selecionadas ({selected.length})<ChevronRight className="size-4" /></Link>
                  </Button>
                  <Button size="sm" disabled={Boolean(busy) || !aiSelected.length || aiSelected.length > 30} title={aiSelected.length > 30 ? "Até 30 empresas por disparo" : undefined} onClick={() => prepareDispatch(aiSelected)}>
                    <Mail className="size-4" />
                    Preparar disparo ({aiSelected.length})
                  </Button>
                </div>
              </div>
            )}
            {places.length > 0 && (
              <div className="flex flex-wrap items-center gap-4 rounded-xl border p-3 text-sm">
                <Label htmlFor="b2b-sort">Ordenar</Label>
                <select
                  id="b2b-sort"
                  className="rounded-md border bg-background px-2 py-1"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                >
                  <option value="relevance">Relevância do Google</option>
                  <option value="rating">Maior nota</option>
                  <option value="reviews">Mais avaliações</option>
                </select>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={onlyRated}
                    onChange={(e) => setOnlyRated(e.target.checked)}
                  />
                  Com avaliações
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={onlyPhone}
                    onChange={(e) => setOnlyPhone(e.target.checked)}
                  />
                  Com telefone
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={onlySite}
                    onChange={(e) => setOnlySite(e.target.checked)}
                  />
                  Com site
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="accent-primary" checked={onlyEmail} onChange={(e) => setOnlyEmail(e.target.checked)} />
                  Com e-mail encontrado
                </label>
                {emailRun && (
                  <span className="flex items-center gap-2 text-muted-foreground">
                    {emailRun.running
                      ? `Pesquisando e-mails: ${emailRun.done} de ${emailRun.total}…`
                      : `E-mails pesquisados: ${Object.keys(emailRun.results).length} empresa(s)`}
                    {!emailRun.running && (
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEmailRun(null)}>
                        <X className="size-3" />
                        Limpar resultados
                      </Button>
                    )}
                  </span>
                )}
                <span className="text-muted-foreground">
                  {visiblePlaces.length} de {places.length} exibidas
                </span>
              </div>
            )}
            {!places.length && (
              <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                {searched
                  ? "Nenhuma empresa encontrada para esta pesquisa."
                  : "Faça uma busca para ver empresas reais. A sugestão inicial é facilities em Curitiba, PR."}
              </p>
            )}
            {places.length > 0 && (
              <div className="rounded-xl border p-4">
                <p className="mb-4 text-sm font-normal not-italic text-foreground" translate="no">
                  Google Maps
                </p>
                {visiblePlaces.length === 0 && (
                  <p className="mb-4 text-sm text-muted-foreground">
                    Nenhum resultado atende aos filtros aplicados.
                  </p>
                )}
                {view === "cards" && (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {visiblePlaces.map((p) => (
                    <article
                      key={p.id}
                      className="flex min-w-0 flex-col rounded-lg border bg-card p-4"
                    >
                      <label className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-1 accent-primary"
                          disabled={Boolean(busy)}
                          checked={selected.includes(p.id)}
                          onChange={(e) =>
                            setSelected((old) => toggleOne(old, p.id, e.target.checked))
                          }
                        />
                        <span className="min-w-0 break-words font-semibold">{p.name}</span>
                      </label>
                      <p className="mt-3 text-xs text-primary">
                        {p.category || "Categoria não informada"}
                      </p>
                      {(() => {
                        const info = prepared[p.id] ?? enriched[p.id];
                        if (!cnpjStatus[p.id] && !info?.cnpj) return null;
                        return (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {info?.cnpj ? `CNPJ ${info.cnpj} · ` : ""}
                            {CNPJ_STATUS_LABEL[cnpjStatus[p.id] ?? "identificado"]}
                            {info?.emails?.length ? ` · ${info.emails.length} e-mail(s)` : ""}
                          </p>
                        );
                      })()}
                      <p className="mt-2 text-sm text-muted-foreground">
                        {p.address || "Endereço não informado"}
                      </p>
                      {emailLine(p)}
                      {emailBlock(p)}
                      <p className="mt-2 text-sm">{p.phone || "Telefone não informado"}</p>
                      <p className="mt-2 text-sm">
                        {p.rating !== null
                          ? `⭐ ${p.rating.toFixed(1).replace(".", ",")} · ${p.userRatingCount ?? 0} avaliações`
                          : "Avaliação não informada"}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-3 text-xs">
                        {p.website && (
                          <a
                            className="underline"
                            href={p.website}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Site <ExternalLink className="inline size-3" />
                          </a>
                        )}
                        {p.instagram ? (
                          <a
                            className="underline"
                            href={p.instagram}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Instagram <ExternalLink className="inline size-3" />
                          </a>
                        ) : (
                          <span className="text-muted-foreground">
                            Instagram não identificado
                          </span>
                        )}
                        {p.mapsUrl && (
                          <a
                            className="underline"
                            href={p.mapsUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Google Maps <ExternalLink className="inline size-3" />
                          </a>
                        )}
                      </div>
                      {p.attributions.map((a, i) => (
                        <p key={i} className="mt-2 text-xs text-muted-foreground">
                          {a.url ? (
                            <a href={a.url} target="_blank" rel="noreferrer">
                              {a.name}
                            </a>
                          ) : (
                            a.name
                          )}
                        </p>
                      ))}
                      {publicData(p)}
                      <div className="mt-5 grid gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={Boolean(busy) || Boolean(emailRun?.running)}
                          onClick={() => void runEmailSearch([p])}
                        >
                          <Mail className="size-4" />
                          {emailRun?.running ? "Pesquisando…" : emailResult(p) ? "Buscar e-mails de novo" : "Buscar e-mails no site"}
                        </Button>
                        <Button
                          variant="outline"
                          disabled={Boolean(busy)}
                          onClick={() => edit(p)}
                        >
                          {prepared[p.id]
                            ? "Revisar cadastro preparado"
                            : "Consultar dados empresariais"}
                        </Button>
                      </div>
                    </article>
                  ))}
                </div>
                )}
                {view === "list" && (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs text-muted-foreground">
                          <th scope="col" className="p-2">
                            <input
                              type="checkbox"
                              aria-label="Selecionar todos os resultados visíveis"
                              className="accent-primary"
                              disabled={Boolean(busy) || !visibleIds.length}
                              checked={allVisibleSelected}
                              onChange={toggleVisibleSelection}
                            />
                          </th>
                          <th scope="col" className="p-2">Empresa</th>
                          <th scope="col" className="p-2">Telefone</th>
                          <th scope="col" className="p-2">Site</th>
                          <th scope="col" className="p-2">Instagram</th>
                          <th scope="col" className="p-2">Avaliação</th>
                          <th scope="col" className="p-2">Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visiblePlaces.map((p) => (
                          <tr key={p.id} className="border-b align-top last:border-0">
                            <td className="p-2">
                              <input
                                type="checkbox"
                                aria-label={`Selecionar ${p.name}`}
                                className="accent-primary"
                                disabled={Boolean(busy)}
                                checked={selected.includes(p.id)}
                                onChange={(e) =>
                                  setSelected((old) => toggleOne(old, p.id, e.target.checked))
                                }
                              />
                            </td>
                            <td className="min-w-56 p-2">
                              <p className="break-words font-semibold">{p.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {p.address || "Endereço não informado"}
                              </p>
                              {emailLine(p)}
                              {emailBlock(p)}
                              <details className="mt-1 text-xs"><summary className="cursor-pointer text-primary">Dados públicos{lookups[p.id] ? "" : " (ainda não pesquisado)"}</summary>{publicData(p)}</details>
                              <details className="mt-1 text-xs">
                                <summary className="cursor-pointer text-primary">
                                  Informações adicionais
                                </summary>
                                <p className="mt-1 text-muted-foreground">
                                  {p.category || "Categoria não informada"}
                                </p>
                                {p.mapsUrl && (
                                  <a
                                    className="underline"
                                    href={p.mapsUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Google Maps <ExternalLink className="inline size-3" />
                                  </a>
                                )}
                                {p.attributions.map((a, i) => (
                                  <p key={i} className="mt-1 text-muted-foreground">
                                    {a.url ? (
                                      <a href={a.url} target="_blank" rel="noreferrer">
                                        {a.name}
                                      </a>
                                    ) : (
                                      a.name
                                    )}
                                  </p>
                                ))}
                              </details>
                            </td>
                            <td className="p-2">{p.phone || "—"}</td>
                            <td className="p-2">
                              {p.website ? (
                                <a
                                  className="underline"
                                  href={p.website}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Acessar <ExternalLink className="inline size-3" />
                                </a>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="p-2">
                              {p.instagram ? (
                                <a
                                  className="underline"
                                  href={p.instagram}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Instagram <ExternalLink className="inline size-3" />
                                </a>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="p-2">
                              {p.rating !== null
                                ? `⭐ ${p.rating.toFixed(1).replace(".", ",")} (${p.userRatingCount ?? 0})`
                                : "—"}
                            </td>
                            <td className="p-2">
                              <div className="grid gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={Boolean(busy)}
                                  onClick={() => edit(p)}
                                >
                                  {prepared[p.id] ? "Revisar cadastro" : "Preparar cadastro"}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={Boolean(busy) || Boolean(emailRun?.running)}
                                  onClick={() => void runEmailSearch([p])}
                                >
                                  <Mail className="size-3" />
                                  {emailResult(p) ? "E-mails de novo" : "Buscar e-mails"}
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="mt-4 text-xs text-muted-foreground">
                  Dados do Google Maps exibidos para consulta, sem gravação dos resultados no CRM. A
                  importação usa uma fonte cadastral autorizada.
                </p>
              </div>
            )}
            {cursor && (
              <Button
                variant="outline"
                disabled={Boolean(busy)}
                onClick={() => void runSearch(true)}
              >
                Carregar próxima página
              </Button>
            )}
          </section>
          </>}
          {step === "revisar" && <>
          {/* Caminho rápido primeiro: identificar CNPJ e adicionar todas de uma vez. */}
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary"><span className="btn-brand inline-flex size-5 items-center justify-center rounded-full text-[10px] text-primary-foreground">⚡</span>Caminho rápido · todas de uma vez</p>
          <B2bBulkBar
              selected={selected}
              places={places}
              prepared={{ ...enriched, ...prepared }}
              search={searched}
              pipelines={pipelines.data ?? []}
              mainStages={mainStages}
              busy={Boolean(busy)}
              onPrepared={(updates) => setEnriched((old) => ({ ...old, ...updates }))}
              onCnpjStatus={(updates) => setCnpjStatus((old) => ({ ...old, ...updates }))}
              onImported={(count) => setImported((n) => n + count)}
              onCreatedLeads={(ids) => { setEnrichLeadIds((old) => [...new Set([...old, ...ids])]); setSessionLeadIds((old) => [...new Set([...old, ...ids])]); }}
              onClear={() => setSelected([])}
            />
          </div>
          <section className="space-y-4 rounded-xl border bg-card p-4 md:p-5" aria-label="Revisar selecionadas">
            <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold">Revisão individual <span className="text-sm font-normal text-muted-foreground">(opcional)</span></h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Para conferir ou completar os dados de uma empresa antes de cadastrar, use <em>Preparar cadastro</em>. Se não precisar, use o caminho rápido acima.
                  O cadastro mantém a origem Prospecção B2B e o status Aguardando primeiro contato.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={Boolean(busy) || !aiSelected.length || aiSelected.length > 30} onClick={() => prepareDispatch(aiSelected)}>
                  <Mail className="size-4" />
                  Preparar disparo ({aiSelected.length})
                </Button>
                <Button size="sm" variant="outline" disabled={Boolean(busy) || !pendingSelected.length} onClick={prepareNextSelected}>
                  Preparar próxima{pendingSelected.length ? ` (${pendingSelected.length} pendentes)` : ""}
                </Button>
                <Button size="sm" variant="outline" onClick={() => edit()} disabled={Boolean(busy)}>
                  <Plus className="size-4" />
                  Cadastro de fonte própria
                </Button>
              </div>
            </div>
            {!selectedRows.length ? (
              <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                <p>Nenhuma empresa selecionada.</p>
                <Button className="mt-3" size="sm" variant="outline" asChild>
                  <Link to="/prospeccao-b2b" search={{}}>Voltar para Buscar empresas</Link>
                </Button>
              </div>
            ) : (
              <ul className="divide-y rounded-lg border">
                {(showAllSelected ? selectedRows : selectedRows.slice(0, 5)).map(({ key, place, company, ready }) => {
                  const name = company?.tradeName || company?.legalName || place?.name || "Empresa sem nome";
                  return (
                    <li key={key} className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                      <div className="min-w-0 text-sm">
                        <p className="flex flex-wrap items-center gap-2">
                          <span className="break-words font-semibold">{name}</span>
                          <span className={`rounded-full px-2 py-0.5 text-xs ${ready ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>{ready ? "Cadastro preparado" : "Precisa de revisão"}</span>
                        </p>
                        <p className="mt-1 break-words text-xs text-muted-foreground">
                          {[company?.cnpj ? `CNPJ ${company.cnpj}` : cnpjStatus[key] ? CNPJ_STATUS_LABEL[cnpjStatus[key]] : "CNPJ pendente", company?.address || place?.address, company?.phones?.[0] || place?.phone, company?.emails?.length ? `${company.emails.length} e-mail(s)` : "", (company?.website || place?.website) ? "Site" : ""].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="flex-1 sm:flex-none" disabled={Boolean(busy) || (!place && !company)} onClick={() => (place ? edit(place) : (setEditorKey(key), setEditor(company ?? null), setIdentity(false), setStorage(false)))}>
                          {ready ? "Revisar cadastro" : "Preparar cadastro"}
                        </Button>
                        <Button size="sm" variant="ghost" className="flex-1 sm:flex-none" aria-label={`Remover ${name} da seleção`} disabled={Boolean(busy)} onClick={() => setSelected((old) => removeSelected(old, [key]))}>
                          <X className="size-4" />
                          Remover
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {selectedRows.length > 5 && <Button variant="ghost" size="sm" className="w-full" onClick={() => setShowAllSelected((v) => !v)}>{showAllSelected ? "Mostrar menos" : `Ver todas as ${selectedRows.length} empresas`}</Button>}
            {preparedOutside.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer font-medium text-primary">Cadastros preparados fora da seleção ({preparedOutside.length})</summary>
                <ul className="mt-2 divide-y">
                  {preparedOutside.map(([key, c]) => (
                    <li key={key} className="flex items-center gap-3 py-2">
                      <span className="min-w-0 flex-1 break-words">{c.tradeName || c.legalName} · {c.cnpj || "CNPJ pendente"}</span>
                      <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => setSelected((old) => toggleOne(old, key, true))}>Voltar à seleção</Button>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
          <PublicEnrichmentProgress leadIds={enrichLeadIds} />
          <section className="rounded-xl border bg-card p-4 md:p-5" aria-label="Adicionar ao CRM">
            <h2 className="text-lg font-semibold">Adicionar as revisadas uma a uma</h2>
            <p className="mt-1 text-sm text-muted-foreground">Cadastra somente as empresas que passaram por <em>Preparar cadastro</em>.</p>
            <div className="mt-4 flex flex-wrap items-end gap-4">
              <div className="min-w-48 flex-1">
                <Label htmlFor="b2b-pipeline">Funil de destino</Label>
                <select
                  id="b2b-pipeline"
                  className={selectClass}
                  value={pipelineId}
                  onChange={(e) => setPipelineId(e.target.value)}
                  disabled={Boolean(busy)}
                >
                  <option value="main">Pipeline original</option>
                  {pipelines.data?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {pipelines.isError && (
                  <p className="text-xs text-destructive">
                    Não foi possível carregar os funis adicionais.
                  </p>
                )}
              </div>
              <Button
                disabled={
                  Boolean(busy) ||
                  !config?.databaseReady ||
                  !selectedReady.length ||
                  selectedReady.length > 20
                }
                onClick={() => setConfirmImport(true)}
              >
                Adicionar ao CRM ({selectedReady.length})
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Até 20 empresas revisadas por importação.{" "}
              {selected.filter((id) => !prepared[id]).length} selecionada(s) ainda precisam de
              revisão.
            </p>
            {imported > 0 && (
              <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                {imported} empresa(s) cadastrada(s) nesta sessão.
                <Link className="font-medium text-primary underline" to="/prospeccao-b2b/primeiro-contato">Ir para Primeiro contato</Link>
              </p>
            )}
            <details className="mt-4 border-t pt-3 text-sm">
              <summary className="cursor-pointer font-medium text-primary">Consulta paga (DeskData)</summary>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="text-xs text-muted-foreground">
                DeskData: {config?.deskReady ? "configurada" : "configuração pendente"} · consultas
                hoje: {config?.todayRequests.filter((r) => r.provider === "deskdata").length ?? 0}/
                {config?.deskDailyLimit} · saldo:{" "}
                {latestBalance
                  ? `${latestBalance.credit_balance} créditos (${new Date(latestBalance.created_at).toLocaleTimeString("pt-BR")})`
                  : "não consultado"}
                . As consultas pagas exigem estimativa e confirmação.
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={Boolean(busy) || !config?.deskReady || !config.databaseReady}
                onClick={() =>
                  void action("credits", async () => {
                    await creditsFn();
                    await overview.refetch();
                  })
                }
              >
                Consultar saldo
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={Boolean(busy) || !config?.deskReady}
                onClick={() =>
                  void action("deskdata-test", async () => {
                    const result = await testDeskDataFn();
                    if (result.ok)
                      setNotice(
                        result.message +
                          (result.tokenExpiresAt
                            ? ` Token válido até ${new Date(result.tokenExpiresAt).toLocaleTimeString("pt-BR")}.`
                            : ""),
                      );
                    else setError(result.message);
                    await overview.refetch();
                  })
                }
              >
                {busy === "deskdata-test" ? "Testando…" : "Testar conexão"}
              </Button>
            </div>
            </details>
          </section>
          </>}
          {step === "contato" && <>
          <section className="space-y-4 rounded-xl border bg-card p-4 md:p-5" aria-label="Empresas para o primeiro contato">
            <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold">Primeiro contato</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Empresas já cadastradas pela prospecção. Use Preparar disparo para gerar e revisar um e-mail por empresa e enviar pela Brevo, ou registre uma abordagem feita por outro canal; tudo entra no histórico do card.
                </p>
              </div>
              <div role="group" aria-label="Filtrar empresas" className="flex overflow-hidden rounded-md border">
                {(["pendentes", "abordadas", "todas"] as const).map((f) => (
                  <Button key={f} size="sm" variant={contactFilter === f ? "default" : "ghost"} className="rounded-none" aria-pressed={contactFilter === f} onClick={() => setContactFilter(f)}>
                    {f === "pendentes" ? "A abordar" : f === "abordadas" ? "Abordadas" : "Todas"}
                  </Button>
                ))}
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              {(["aguardando", "preparada", "revisada", "abordada"] as const).map((s) => (
                <div key={s} className="rounded-lg border p-3">
                  <dt className="text-xs text-muted-foreground">{CONTACT_STAGE_LABEL[s]}</dt>
                  <dd className="mt-1 text-2xl font-semibold">{contactRows.filter((c) => c.stage === s).length}</dd>
                </div>
              ))}
            </dl>
            {selected.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
                <span>{selected.length} empresa(s) na seleção revisada{selectedReady.length < selected.length ? ` · ${selected.length - selectedReady.length} ainda sem cadastro preparado` : ""}.</span>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={Boolean(busy) || !aiSelected.length || aiSelected.length > 30} onClick={() => prepareDispatch(aiSelected)}>
                    <Mail className="size-4" />
                    Preparar disparo ({aiSelected.length})
                  </Button>
                  <Button size="sm" variant="ghost" asChild><Link to="/prospeccao-b2b/revisar">Voltar à revisão</Link></Button>
                </div>
              </div>
            )}
            {!visibleContacts.length ? (
              <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                {contactRows.length ? "Nenhuma empresa neste filtro." : "Nenhuma empresa cadastrada ainda. Adicione as selecionadas ao CRM na etapa Revisar."}
              </p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {visibleContacts.map((c) => {
                  const name = c.profile.tradeName || c.profile.legalName;
                  return (
                    <li key={c.lead_id} className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                      <div className="min-w-0 text-sm">
                        <p className="flex flex-wrap items-center gap-2">
                          <span className="break-words font-semibold">{name}</span>
                          <span className={`rounded-full px-2 py-0.5 text-xs ${c.stage === "abordada" ? "bg-primary text-primary-foreground" : c.stage === "aguardando" ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"}`}>{CONTACT_STAGE_LABEL[c.stage]}</span>
                          {c.fromSession && <span className="text-xs text-primary">Cadastrada agora</span>}
                        </p>
                        <p className="mt-1 break-words text-xs text-muted-foreground">
                          {c.approach ? `Abordada em ${new Date(c.approach.date).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })} · ${c.approach.channel}` : [c.profile.emails[0] || "Sem e-mail", c.profile.phones[0] || ""].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" className="flex-1 sm:flex-none" disabled={!c.profile.emails.length} title={c.profile.emails.length ? undefined : "Cadastro sem e-mail corporativo"} onClick={() => { setLeadId(c.lead_id); setRecipient(c.profile.emails[0] ?? ""); setSubject(""); setBody(""); setReviewed(false); requestAnimationFrame(() => document.getElementById("b2b-message")?.scrollIntoView({ behavior: "smooth", block: "start" })); }}>
                          <Mail className="size-4" />
                          Preparar mensagem
                        </Button>
                        <Button size="sm" variant={c.stage === "abordada" ? "ghost" : "default"} className="flex-1 sm:flex-none" disabled={Boolean(busy)} onClick={() => { setApproach({ leadId: c.lead_id, name }); setApproachChannel("email"); setApproachNote(""); setApproachError(""); }}>
                          <Check className="size-4" />
                          {c.stage === "abordada" ? "Registrar nova abordagem" : "Registrar abordagem"}
                        </Button>
                        <Button size="sm" variant="ghost" className="flex-1 sm:flex-none" asChild>
                          <Link to="/" search={{ lead: c.lead_id }}>Abrir card</Link>
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <CompanyInsightsBulk leadIds={storedCompanies.flatMap((c) => (c.lead_id ? [c.lead_id] : []))} />
          <section id="b2b-message" className="scroll-mt-32 rounded-xl border bg-card p-4 md:p-5">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Mail className="size-5 text-primary" />
              Preparar mensagem
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Edite e revise o rascunho. O envio por e-mail ainda não está conectado e nenhum
              disparo será feito.
            </p>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="b2b-mail-company">Empresa cadastrada (100 mais recentes)</Label>
                <select
                  id="b2b-mail-company"
                  className={selectClass}
                  value={leadId}
                  onChange={(e) => {
                    setLeadId(e.target.value);
                    setRecipient("");
                    setSubject("");
                    setBody("");
                    setReviewed(false);
                  }}
                >
                  <option value="">Selecione</option>
                  {storedCompanies.map((c) => (
                    <option key={c.lead_id} value={c.lead_id ?? ""}>
                      {c.profile.tradeName || c.profile.legalName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="b2b-recipient">E-mail corporativo</Label>
                <select
                  id="b2b-recipient"
                  className={selectClass}
                  value={recipient}
                  onChange={(e) => {
                    setRecipient(e.target.value);
                    setReviewed(false);
                  }}
                >
                  <option value="">Selecione</option>
                  {mailCompany?.profile.emails.map((email) => (
                    <option key={email}>{email}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="b2b-sender">Seu nome</Label>
                <Input
                  id="b2b-sender"
                  value={sender}
                  maxLength={100}
                  onChange={(e) => setSender(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="b2b-template">Modelo</Label>
                <select
                  id="b2b-template"
                  className={selectClass}
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                >
                  {EMAIL_TEMPLATES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button
                variant="outline"
                disabled={!mailCompany}
                onClick={() => {
                  const t = EMAIL_TEMPLATES.find((t) => t.id === template)!;
                  setSubject(
                    renderEmail(
                      t.subject,
                      mailCompany!.profile.legalName,
                      mailCompany!.profile.segment,
                      sender,
                    ),
                  );
                  setBody(
                    renderEmail(
                      t.body,
                      mailCompany!.profile.legalName,
                      mailCompany!.profile.segment,
                      sender,
                    ),
                  );
                  setReviewed(false);
                }}
              >
                Aplicar modelo
              </Button>
              <Button variant="ghost" asChild>
                <Link to="/gravon-ai" search={{ tab: "tests" }}>
                  Abrir Pipeflow IA para sugestões
                </Link>
              </Button>
            </div>
            <div className="mt-4">
              <Label htmlFor="b2b-subject">Assunto</Label>
              <Input
                id="b2b-subject"
                value={subject}
                maxLength={200}
                onChange={(e) => {
                  setSubject(e.target.value);
                  setReviewed(false);
                }}
              />
            </div>
            <div className="mt-4">
              <Label htmlFor="b2b-body">Mensagem</Label>
              <Textarea
                id="b2b-body"
                value={body}
                rows={9}
                maxLength={6000}
                onChange={(e) => {
                  setBody(e.target.value);
                  setReviewed(false);
                }}
              />
            </div>
            <label className="mt-4 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(e) => setReviewed(e.target.checked)}
              />
              Revisei destinatário, mensagem, finalidade e orientação de descadastramento.
            </label>
            {blocked && (
              <p className="mt-3 text-sm text-destructive">
                Este e-mail está descadastrado e não pode receber novos contatos.
              </p>
            )}
            <Button
              className="mt-4"
              disabled={
                Boolean(busy) ||
                !config?.databaseReady ||
                !leadId ||
                !recipient ||
                !subject ||
                !body ||
                blocked
              }
              onClick={() =>
                void action("draft", async () => {
                  await draftFn({ data: { leadId, recipient, subject, body, reviewed } });
                  setNotice("Rascunho salvo. Nenhum e-mail foi enviado.");
                  await overview.refetch();
                })
              }
            >
              Salvar {reviewed ? "rascunho revisado" : "rascunho"}
            </Button>
            <details className="mt-6 border-t pt-4">
              <summary className="cursor-pointer font-medium">
                Histórico de preparação e descadastramentos
              </summary>
              <p className="mt-3 text-xs text-muted-foreground">
                Últimos 100 rascunhos. Envio, respostas e erros do provedor aguardam a conexão de
                e-mail.
              </p>
              <ul className="mt-3 divide-y">
                {config?.drafts.map((d) => (
                  <li key={d.id} className="py-3 text-sm">
                    {d.recipient} · {d.subject} ·{" "}
                    {d.state === "reviewed" ? "Revisado, não enviado" : "Rascunho"} ·{" "}
                    {new Date(d.created_at).toLocaleString("pt-BR")}
                  </li>
                ))}
              </ul>
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <div>
                  <Label htmlFor="b2b-block-email">E-mail que pediu descadastramento</Label>
                  <Input
                    id="b2b-block-email"
                    type="email"
                    value={blockEmail}
                    onChange={(e) => {
                      setBlockEmail(e.target.value);
                      setBlockConfirmed(false);
                    }}
                  />
                </div>
                <div>
                  <Label htmlFor="b2b-block-reason">Motivo ou referência da solicitação</Label>
                  <Input
                    id="b2b-block-reason"
                    value={blockReason}
                    maxLength={300}
                    onChange={(e) => {
                      setBlockReason(e.target.value);
                      setBlockConfirmed(false);
                    }}
                  />
                </div>
              </div>
              <label className="mt-3 flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={blockConfirmed}
                  onChange={(e) => setBlockConfirmed(e.target.checked)}
                />
                Confirmo o bloqueio de novos contatos para este endereço.
              </label>
              <Button
                variant="outline"
                className="mt-3"
                disabled={Boolean(busy) || !blockConfirmed || !config?.databaseReady}
                onClick={() =>
                  void action("suppress", async () => {
                    await suppressFn({
                      data: { email: blockEmail, reason: blockReason, confirmed: true },
                    });
                    setBlockConfirmed(false);
                    setNotice("Descadastramento registrado.");
                    await overview.refetch();
                  })
                }
              >
                Registrar descadastramento
              </Button>
              <ul className="mt-3 text-xs text-muted-foreground">
                {config?.suppressions.map((s) => (
                  <li key={s.email}>
                    {s.email} · {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          </section>
          </>}
          <div hidden={step !== "contato"}>
            <B2bAiEmails companies={aiSelected} request={aiRequest} onConsume={()=>setAiRequest(null)} outboundLeadIds={contactRows.filter((c) => c.stage !== "abordada").map((c) => c.lead_id)} />
          </div>
          <Dialog open={Boolean(pendingSearch)} onOpenChange={(open) => { if (!open) setPendingSearch(null); }}>
            <DialogContent className="text-foreground">
              <DialogHeader>
                <DialogTitle>Descartar cadastros em preparação?</DialogTitle>
                <DialogDescription>A nova pesquisa vai limpar a seleção e os cadastros temporários, incluindo alterações não salvas. Empresas já cadastradas no CRM serão preservadas.</DialogDescription>
              </DialogHeader>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" onClick={() => setPendingSearch(null)}>Manter pesquisa atual</Button>
                <Button onClick={() => { if (pendingSearch) void runSearch(false, true, pendingSearch); }}>Descartar e pesquisar</Button>
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={Boolean(approach)} onOpenChange={(open) => { if (!open && !approachSaving) setApproach(null); }}>
            <DialogContent className="text-foreground">
              <DialogHeader>
                <DialogTitle>Registrar abordagem</DialogTitle>
                <DialogDescription>
                  {approach?.name}: o registro entra no histórico do card como primeiro contato. Nenhuma mensagem é enviada.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="b2b-approach-channel">Canal usado</Label>
                  <select id="b2b-approach-channel" className={selectClass} value={approachChannel} onChange={(e) => setApproachChannel(e.target.value as FirstContactChannel)}>
                    {Object.entries(FIRST_CONTACT_CHANNELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                  </select>
                </div>
                <div>
                  <Label htmlFor="b2b-approach-note">Observação (opcional)</Label>
                  <Textarea id="b2b-approach-note" rows={3} maxLength={1000} value={approachNote} onChange={(e) => setApproachNote(e.target.value)} />
                </div>
                {approachError && <p role="alert" className="text-sm text-destructive">{approachError}</p>}
                <Button className="w-full" disabled={approachSaving} onClick={() => void registerApproach()}>
                  {approachSaving ? "Salvando…" : "Salvar abordagem"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          <Dialog
            open={Boolean(editor)}
            onOpenChange={(open) => {
              if (!open && !busy) setEditor(null);
            }}
          >
            <DialogContent className="max-h-[90vh] overflow-y-auto text-foreground sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Confirmar dados empresariais</DialogTitle>
                <DialogDescription>
                  Revise os dados disponíveis e confirme a identidade da empresa. Se o CNPJ não for
                  identificado, deixe o campo vazio: o cadastro segue como CNPJ pendente e pode ser
                  complementado depois pela consulta pública.
                </DialogDescription>
              </DialogHeader>
              {editor && (
                <>
                  {places.find((p) => p.id === editor.placeId) && (
                    <div className="rounded-md border p-3 text-sm">
                      <span translate="no" className="font-normal">
                        Google Maps
                      </span>
                      <p className="mt-2">{places.find((p) => p.id === editor.placeId)?.name}</p>
                      <p className="text-muted-foreground">
                        {places.find((p) => p.id === editor.placeId)?.address}
                      </p>
                    </div>
                  )}
                  <div className="rounded-md border p-3">
                    <Label htmlFor="b2b-company-cnpj">CNPJ (opcional)</Label>
                    <Input
                      id="b2b-company-cnpj"
                      value={editor.cnpj}
                      maxLength={30}
                      placeholder="Vazio = CNPJ pendente"
                      aria-invalid={
                        Boolean(editor.cnpj) && !cnpjInput.safeParse(editor.cnpj).success
                      }
                      aria-describedby="b2b-cnpj-status"
                      onChange={(e) => change("cnpj", e.target.value)}
                    />
                    <p id="b2b-cnpj-status" className="mt-1 text-xs text-muted-foreground">
                      {editor.cnpj
                        ? "Consulta pública disponível para complementar os dados."
                        : "Sem CNPJ, a empresa é identificada pelo Google Maps e registrada como CNPJ pendente."}
                    </p>
                  </div>
                  <B2bHybridLookup key={editorKey} company={editor} disabled={Boolean(busy) || !config?.enabled || !config.databaseReady} onResult={(company) => { setEditor(company); setIdentity(false); setStorage(false); }} />
                  <h3 className="text-sm font-semibold">Empresa</h3>
                  <CompanyFinancialData company={editor} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    {(
                      [
                        ["legalName", editor.cnpj ? "Razão social" : "Razão social (opcional, se identificada)"],
                        ["tradeName", "Nome comercial / nome fantasia"],
                        ["registrationStatus", "Situação cadastral"],
                        ["segment", "Segmento"],
                        ["city", "Cidade"],
                        ["address", "Endereço"],
                        ["website", "Site HTTPS de fonte própria"],
                        ["instagram", "Instagram de fonte própria"],
                        ["sourceReference", "Referência da fonte e autorização"],
                      ] as const
                    ).map(([key, label]) => (
                      <div key={key}>
                        <Label htmlFor={`b2b-company-${key}`}>{label}</Label>
                        <Input
                          id={`b2b-company-${key}`}
                          value={editor[key] ?? ""}
                          maxLength={
                            key === "address"
                              ? 700
                              : key === "sourceReference"
                                ? 500
                                : key === "website" || key === "instagram"
                                  ? 2000
                                  : 300
                          }
                          onChange={(e) => change(key, e.target.value)}
                        />
                      </div>
                    ))}
                    <div>
                      <Label htmlFor="b2b-company-state">UF</Label>
                      <select
                        id="b2b-company-state"
                        className={selectClass}
                        value={editor.state}
                        onChange={(e) => change("state", e.target.value as CompanyData["state"])}
                      >
                        <option value="">Não informada</option>
                        {BRAZIL_STATES.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label htmlFor="b2b-phones">
                        Telefones corporativos (separados por vírgula)
                      </Label>
                      <Input
                        id="b2b-phones"
                        value={editor.phones.join(", ")}
                        onChange={(e) =>
                          change(
                            "phones",
                            e.target.value.split(",").map((s) => s.trim()),
                          )
                        }
                      />
                    </div>
                    <div>
                      <Label htmlFor="b2b-emails">
                        E-mails corporativos (separados por vírgula)
                      </Label>
                      <Input
                        id="b2b-emails"
                        value={editor.emails.join(", ")}
                        onChange={(e) =>
                          change(
                            "emails",
                            e.target.value.split(",").map((s) => s.trim()),
                          )
                        }
                      />
                    </div>
                    <div>
                      <Label htmlFor="b2b-whatsapp">WhatsApp confirmado pela fonte</Label>
                      <Input id="b2b-whatsapp" readOnly value={(editor.whatsappNumbers ?? []).join(", ")} />
                    </div>
                  </div>
                  {(editor.partners ?? []).length > 0 && (
                    <section aria-label="Sócios e responsáveis" className="space-y-2 border-t pt-3">
                      <h3 className="text-sm font-semibold">Sócios e responsáveis</h3>
                      {(editor.partners ?? []).map((partner, index) => (
                        <div key={index} className="text-sm">
                          <p>{partner.name}{partner.role ? ` · ${partner.role}` : ""}</p>
                          <p className="text-muted-foreground">{partner.phones.join(", ") || "Telefone não informado"}</p>
                        </div>
                      ))}
                    </section>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Campos ausentes devem permanecer vazios. Telefones pessoais e e-mails pessoais
                    da empresa não são incluídos. Telefones de sócios ficam separados. A documentação
                    atual da DeskData não informa se um número possui WhatsApp.
                  </p>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={identity}
                      onChange={(e) => setIdentity(e.target.checked)}
                    />
                    {editor.cnpj
                      ? "Comparei CNPJ, razão social/nome fantasia e endereço; esta é a empresa correta."
                      : "Conferi o nome comercial e as informações disponíveis; esta é a empresa correta."}
                  </label>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={storage}
                      onChange={(e) => setStorage(e.target.checked)}
                    />
                    Tenho autorização para armazenar estes dados empresariais da fonte indicada e
                    utilizá-los para esta finalidade.
                  </label>
                  {error && (
                    <p role="alert" className="text-sm text-destructive">
                      {error}
                    </p>
                  )}
                  <Button
                    disabled={Boolean(busy) || !identity || !storage}
                    onClick={() => {
                      const parsed = companyInput.safeParse({
                        ...editor,
                        phones: editor.phones.filter(Boolean),
                        emails: editor.emails.filter(Boolean),
                        identityConfirmed: identity,
                        storageAuthorized: storage,
                      });
                      if (!parsed.success) {
                        setError(
                          parsed.error.issues
                            .map((i) => `${i.path.join(".")}: ${i.message}`)
                            .join(" · "),
                        );
                        return;
                      }
                      setPrepared((old) => ({ ...old, [editorKey]: parsed.data }));
                      setSelected((old) => (old.includes(editorKey) ? old : [...old, editorKey]));
                      setEditor(null);
                      setError("");
                      setNotice("Empresa preparada para revisão final da importação.");
                    }}
                  >
                    Preparar cadastro
                  </Button>
                  <Button variant="outline" disabled={Boolean(busy)||!(editor.tradeName||editor.legalName)} onClick={()=>{setAiRequest({nonce:Date.now(),companies:[aiCompany(editorKey,editor)]});setEditor(null);}}><Sparkles className="size-4"/>Personalizar com Pipeflow IA</Button>
                </>
              )}
            </DialogContent>
          </Dialog>
          <Dialog
            open={confirmImport}
            onOpenChange={(open) => {
              if (!busy) setConfirmImport(open);
            }}
          >
            <DialogContent className="text-foreground">
              <DialogHeader>
                <DialogTitle>Confirmar importação no CRM</DialogTitle>
                <DialogDescription>
                  Funil:{" "}
                  {pipelineId === "main"
                    ? "Pipeline original"
                    : pipelines.data?.find((p) => p.id === pipelineId)?.name}
                  . Os novos leads entrarão na primeira etapa; duplicados serão ignorados.
                </DialogDescription>
              </DialogHeader>
              <ul className="max-h-60 overflow-auto text-sm">
                {selectedReady.map((c) => (
                  <li className="py-2" key={c.cnpj || `place:${c.placeId}`}>
                    {c.tradeName || c.legalName} · {c.cnpj || "CNPJ pendente"}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                Nenhum e-mail ou mensagem de WhatsApp será enviado.
              </p>
              <Button
                disabled={Boolean(busy) || !selectedReady.length || selectedReady.length > 20}
                onClick={() =>
                  void action("import", async () => {
                    const result = await importFn({
                      data: {
                        pipelineId: pipelineId === "main" ? null : pipelineId,
                        companies: selectedReady,
                        confirmed: true,
                      },
                    });
                    const created = result.filter((r) => r.status === "created").length;
                    const createdIds = result.flatMap((r) => (r.status === "created" && r.leadId ? [r.leadId] : []));
                    setSessionLeadIds((old) => [...new Set([...old, ...createdIds])]);
                    setImported((n) => n + created);
                    setNotice(
                      `${created} empresa(s) cadastrada(s); ${result.length - created} duplicada(s) ignorada(s).`,
                    );
                    setConfirmImport(false);
                    // Só saem da seleção as empresas importadas; as que ainda aguardam revisão continuam marcadas.
                    const importedKeys = Object.entries(prepared).filter(([, c]) => selectedReady.includes(c)).map(([k]) => k);
                    setSelected((old) => removeSelected(old, importedKeys));
                    setPrepared((old) => Object.fromEntries(Object.entries(old).filter(([key]) => !importedKeys.includes(key))));
                    await overview.refetch();
                  })
                }
              >
                Confirmar e adicionar {selectedReady.length} empresa(s)
              </Button>
            </DialogContent>
          </Dialog>
        </div>
      </main>
    </B2bLayout>
  );
}
