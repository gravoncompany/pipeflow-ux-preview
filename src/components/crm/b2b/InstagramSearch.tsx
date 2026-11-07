import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Instagram,
  Search,
  Loader2,
  LayoutGrid,
  List,
  ClipboardCheck,
  History,
  XCircle,
  Mail,
  Phone,
  Globe,
  MapPin,
  ExternalLink,
  Sparkles,
  MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  cancelInstagramSearch,
  getInstagramStatus,
  listInstagramResults,
  listInstagramSearches,
  parseInstagramHashtags,
  startInstagramSearch,
  syncInstagramSearch,
  refreshInstagramContacts,
} from "@/lib/b2b-instagram.functions";
import {
  filterProfiles,
  igProfileUrl,
  normalizeHashtags,
  profileToCompany,
  IG_SEARCH_STATUS,
  IG_RELEVANCE,
  IG_ENRICHMENT,
  IG_STAGE,
  type IgResultFilter,
  type InstagramProfile,
  type InstagramSearchRow,
} from "@/lib/b2b-instagram";
import type { CompanyData } from "@/lib/b2b-prospecting";

const selectClass = "h-9 w-full rounded-md border bg-background px-2 text-sm";

/** Pesquisa de empresas por hashtags do Instagram via Apify. Nenhuma consulta paga roda sem confirmação; nada é enviado. */
export function InstagramSearchPanel({ onReview }: { onReview: (entries: Record<string, CompanyData>) => void }) {
  const statusFn = useServerFn(getInstagramStatus);
  const searchesFn = useServerFn(listInstagramSearches);
  const startFn = useServerFn(startInstagramSearch);
  const syncFn = useServerFn(syncInstagramSearch);
  const cancelFn = useServerFn(cancelInstagramSearch);
  const resultsFn = useServerFn(listInstagramResults);
  const parseFn = useServerFn(parseInstagramHashtags);
  const refreshFn = useServerFn(refreshInstagramContacts);
  const [refreshing, setRefreshing] = useState(false);
  const resultGeneration = useRef(0);

  const status = useQuery({ queryKey: ["b2b-ig-status"], queryFn: () => statusFn(), retry: false });
  const history = useQuery({ queryKey: ["b2b-ig-searches"], queryFn: () => searchesFn(), retry: false });

  const [rawTags, setRawTags] = useState("#facilities");
  const [limit, setLimit] = useState<20 | 50 | 100>(20);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [reuse, setReuse] = useState<InstagramSearchRow | null>(null);
  const [active, setActive] = useState<InstagramSearchRow | null>(null);
  const [profiles, setProfiles] = useState<InstagramProfile[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [view, setView] = useState<"cards" | "list">("cards");
  const [filters, setFilters] = useState<IgResultFilter>({ text: "", segment: "", hasEmail: false, hasWhatsapp: false, hasSite: false, notInCrm: false });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncBusy = useRef(false);
  const syncFailures = useRef(0);

  const tags = useMemo(() => normalizeHashtags(rawTags), [rawTags]);
  const visible = useMemo(() => filterProfiles(profiles, filters), [profiles, filters]);
  const allVisible = visible.length > 0 && visible.every((p) => selected.includes(p.id));

  async function loadResults(searchId: string) {
    const generation = ++resultGeneration.current;
    const data = await resultsFn({ data: { searchId } });
    if (generation !== resultGeneration.current) return;
    setActive(data.search);
    setProfiles(data.profiles);
    setSelected([]);
    if (data.profiles.some(p => !p.publicCheckedAt || Date.parse(p.publicCheckedAt) < Date.now() - 86400_000)) void refreshContacts(searchId, generation);
  }

  async function refreshContacts(searchId: string, generation = resultGeneration.current) {
    if (refreshing) return;
    setRefreshing(true);
    try {
      let remaining = 1;
      while (remaining && generation === resultGeneration.current) {
        const batch = await refreshFn({ data: { searchId } });
        remaining = batch.remaining;
        const data = await resultsFn({ data: { searchId } });
        if (generation !== resultGeneration.current) break;
        setProfiles(data.profiles);
        setNotice(remaining ? `Atualizando contatos públicos · ${remaining} perfil(is) restantes` : "Contatos públicos atualizados, sem nova pesquisa na Apify.");
        if (!batch.processed) break;
      }
    } catch (e) { if (generation === resultGeneration.current) setError(e instanceof Error ? e.message : "Não foi possível atualizar contatos."); }
    finally { setRefreshing(false); }
  }

  // Acompanhamento: enquanto a pesquisa estiver em andamento, sincroniza a cada 5 segundos.
  useEffect(() => {
    if (!active || active.status !== "running") {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      return;
    }
    pollRef.current = setInterval(() => {
      if (syncBusy.current) return;
      syncBusy.current = true;
      void syncFn({ data: { searchId: active.id } })
        .then(async (s) => {
          syncFailures.current = 0;
          setActive(s);
          if (s.status !== "running") {
            await loadResults(s.id);
            void history.refetch();
            if (s.status === "succeeded") setNotice(s.error || `Pesquisa concluída: ${s.profilesFound} perfil(is) único(s) em ${s.postsFound} publicação(ões).`);
            if (s.status === "failed") setError(s.error || "A pesquisa não foi concluída.");
          }
        })
        .catch((e) => {
          syncFailures.current++;
          setError(e instanceof Error ? e.message : 'Não foi possível consultar o andamento da Apify.');
          if (syncFailures.current >= 3 && pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        }).finally(() => { syncBusy.current = false; });
    }, 5_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, active?.status]);

  async function start(forceNew: boolean) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const parsed = await parseFn({ data: { hashtags: rawTags } });
      if (!parsed.hashtags.length) {
        setError("Informe ao menos uma hashtag válida (ex.: #facilities).");
        return;
      }
      const res = await startFn({ data: { hashtags: parsed.hashtags, resultsLimit: limit, confirmed: true, forceNew } });
      if (res.reuse) {
        setReuse(res.reuse);
        return;
      }
      setProfiles([]);
      setSelected([]);
      const s = await syncFn({ data: { searchId: res.searchId } });
      setActive(s);
      void history.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível iniciar a pesquisa.");
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  async function cancel() {
    if (!active) return;
    setBusy(true);
    try {
      await cancelFn({ data: { searchId: active.id } });
      setActive({ ...active, status: "canceled" });
      setNotice("Pesquisa cancelada. Os resultados já recuperados permanecem salvos.");
      void history.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível cancelar.");
    } finally {
      setBusy(false);
    }
  }

  function review() {
    const entries = Object.fromEntries(
      profiles
        .filter((p) => selected.includes(p.id))
        .map((p) => [`instagram-${p.username}`, profileToCompany(p)]),
    );
    if (Object.keys(entries).length) onReview(entries);
  }

  const configured = Boolean(status.data?.configured);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <Instagram className="size-5 text-primary" />
            Instagram
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Empresas por hashtags públicas · Integração Apify</p>
        </div>
        <span className="rounded-md border px-3 py-1 text-xs text-muted-foreground">
          {configured ? "Integração configurada" : "Integração Apify pendente"}
        </span>
      </header>

      {!configured && status.data && (
        <p role="status" className="border-l-2 border-primary bg-muted p-3 text-sm">
          Cadastre o token da Apify em Configurações → Integrações → Outras integrações (“Apify - Instagram Scraper”). Nenhum resultado fictício será apresentado.
        </p>
      )}

      <form
        className="grid items-end gap-4 rounded-xl border bg-card p-4 md:grid-cols-[2fr_1fr_auto] md:p-5"
        onSubmit={(e) => {
          e.preventDefault();
          setConfirm(true);
        }}
      >
        <div>
          <Label htmlFor="ig-hashtags">Hashtags (separe por vírgula)</Label>
          <Input id="ig-hashtags" value={rawTags} maxLength={300} placeholder="#facilities, #terceirizacao" onChange={(e) => setRawTags(e.target.value)} />
          <p className="mt-1 text-xs text-muted-foreground">{tags.length ? `${tags.length} hashtag(s): ${tags.map((t) => `#${t}`).join(" ")}` : "Até 5 hashtags por pesquisa."}</p>
        </div>
        <div>
          <Label htmlFor="ig-limit">Resultados por hashtag</Label>
          <select id="ig-limit" className={selectClass} value={limit} onChange={(e) => setLimit(Number(e.target.value) as typeof limit)}>
            <option value={20}>20 publicações</option>
            <option value={50}>50 publicações</option>
            <option value={100}>100 publicações</option>
          </select>
        </div>
        <Button type="submit" disabled={busy || !configured || !tags.length || active?.status === "running"}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          Buscar empresas
        </Button>
      </form>

      {error && <p role="alert" className="rounded-md border border-destructive p-4 text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="rounded-md border border-primary/40 p-4 text-sm">{notice}</p>}

      {active?.status === "running" && (
        <section className="space-y-3 rounded-xl border bg-card p-4" aria-label="Andamento da pesquisa">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Loader2 className="size-4 animate-spin text-primary" />
              Pesquisando {active.hashtags.map((h) => `#${h}`).join(" ")}…
            </p>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void cancel()}>
              <XCircle className="size-4" />
              Cancelar pesquisa
            </Button>
          </div>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {active.runs.map((r) => (
              <li key={r.runId} className="flex items-center gap-2">
                <span className={`size-2 rounded-full ${r.status === "SUCCEEDED" ? "bg-success" : "bg-primary animate-pulse"}`} />
                #{r.hashtag} — {r.status === "SUCCEEDED" ? "publicações recuperadas" : "consultando o Instagram"}
              </li>
            ))}
          </ul>
          <ol className="flex flex-wrap items-center gap-1 text-xs" aria-label="Etapas da pesquisa">
            {(Object.keys(IG_STAGE) as (keyof typeof IG_STAGE)[]).filter((s) => s !== "concluido").map((s, i, all) => {
              const order = ["publicacoes", "perfis", "sites", "ia"];
              const current = order.indexOf(active.stage);
              const mine = order.indexOf(s);
              const done = mine < current;
              const isNow = mine === current;
              return (
                <li key={s} className={`flex items-center gap-1 rounded-md px-2 py-1 ${isNow ? "bg-primary/10 font-medium text-primary" : done ? "text-success" : "text-muted-foreground"}`}>
                  {done ? "✓" : `${i + 1}.`} {IG_STAGE[s]}
                  {i < all.length - 1 && <span className="text-muted-foreground">→</span>}
                </li>
              );
            })}
          </ol>
          <p className="text-xs text-muted-foreground">Após as publicações, os perfis únicos são investigados, seus sites lidos (sem custo) e tudo é analisado pela Pipeflow IA. Você pode sair da página e voltar pelo histórico.</p>
        </section>
      )}

      {!!history.data?.length && (
        <details className="rounded-xl border bg-card p-4">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <History className="size-4 text-primary" />
            Histórico de pesquisas ({history.data.length})
          </summary>
          <ul className="mt-3 divide-y text-sm">
            {history.data.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="font-medium">{s.hashtags.map((h) => `#${h}`).join(" ")}</span>
                <Badge variant={s.status === "succeeded" ? "secondary" : s.status === "failed" ? "destructive" : "outline"}>{IG_SEARCH_STATUS[s.status]}</Badge>
                <span className="text-xs text-muted-foreground">
                  {new Date(s.createdAt).toLocaleString("pt-BR")} · {s.profilesFound} perfil(is)
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  disabled={s.status === "running"}
                  onClick={() => void loadResults(s.id).catch(() => setError("Não foi possível abrir esta pesquisa."))}
                >
                  Abrir resultados
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {active && active.status !== "running" && (
        <section className="space-y-4" aria-label="Resultados da pesquisa">
          <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-center sm:justify-between">
            <h3 className="text-lg font-semibold">
              Resultados <span className="text-sm font-normal text-muted-foreground">· {active.hashtags.map((h) => `#${h}`).join(" ")} ({profiles.length})</span>
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" disabled={refreshing || !profiles.length} onClick={() => void refreshContacts(active.id)}>
                {refreshing ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Atualizar contatos
              </Button>
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
              <Button size="sm" variant="outline" disabled={!visible.length} onClick={() => setSelected(allVisible ? selected.filter((id) => !visible.some((p) => p.id === id)) : [...new Set([...selected, ...visible.map((p) => p.id)])])}>
                {allVisible ? "Desmarcar visíveis" : `Selecionar visíveis (${visible.length})`}
              </Button>
              <Button size="sm" variant="ghost" disabled={!selected.length} onClick={() => setSelected([])}>
                Limpar seleção
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-48 flex-1">
              <Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Pesquisar nome, usuário, biografia ou cidade" value={filters.text} onChange={(e) => setFilters({ ...filters, text: e.target.value })} />
            </div>
            <select aria-label="Filtrar por segmento" className={`${selectClass} w-44`} value={filters.segment} onChange={(e) => setFilters({ ...filters, segment: e.target.value })}>
              <option value="">Todos os segmentos</option>
              {[...new Set(profiles.map((p) => p.aiSegment || p.category).filter(Boolean))].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            {([
              ["hasEmail", "Com e-mail"],
              ["hasWhatsapp", "Com WhatsApp"],
              ["hasSite", "Com site"],
              ["notInCrm", "Ainda não cadastradas"],
            ] as const).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <Checkbox checked={filters[key]} onCheckedChange={(v) => setFilters({ ...filters, [key]: v === true })} />
                {label}
              </label>
            ))}
          </div>

          {!profiles.length ? (
            <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              {active.status === "succeeded" ? "Nenhum perfil comercial identificado nesta pesquisa." : "Esta pesquisa não gerou resultados."}
            </p>
          ) : (
            <div className={view === "cards" ? "grid gap-3 sm:grid-cols-2 xl:grid-cols-3" : "divide-y rounded-xl border bg-card"}>
              {visible.map((p) => {
                const on = selected.includes(p.id);
                const toggle = (v: boolean) => setSelected((old) => (v ? [...new Set([...old, p.id])] : old.filter((id) => id !== p.id)));
                const badges = (
                  <div className="flex flex-wrap gap-1">
                    {p.inCrm && <Badge variant="outline">Já no CRM</Badge>}
                    {p.aiRelevance && <Badge variant={p.aiRelevance === "alta" ? "default" : "secondary"}>Relevância {IG_RELEVANCE[p.aiRelevance as keyof typeof IG_RELEVANCE] ?? p.aiRelevance}</Badge>}
                    {p.aiCommercial === false && <Badge variant="outline">Perfil não comercial</Badge>}
                    <Badge variant="secondary">{IG_ENRICHMENT[p.enrichment] ?? IG_ENRICHMENT.pendente}</Badge>
                  </div>
                );
                const info = (
                  <>
                    {p.biography && <p className="line-clamp-3 text-xs text-muted-foreground">{p.biography}</p>}
                    <div className="space-y-1 text-xs">
                      {(p.aiSegment || p.category) && <p className="flex items-center gap-1"><Sparkles className="size-3 shrink-0 text-primary" />{p.aiSegment || p.category}</p>}
                      {(p.aiLocation || p.city) && <p className="flex items-center gap-1 text-muted-foreground"><MapPin className="size-3 shrink-0" />{[p.aiLocation || p.city, p.country].filter(Boolean).join(", ")}</p>}
                      <p className="flex items-center gap-1 break-all"><Mail className="size-3 shrink-0" />{p.email || <span className="text-muted-foreground">E-mail não identificado</span>}</p>
                      <p className="flex items-center gap-1"><Phone className="size-3 shrink-0" />{p.phone || <span className="text-muted-foreground">Telefone não identificado</span>}</p>
                      <p className="flex items-center gap-1"><MessageCircle className="size-3 shrink-0" />{p.whatsapp || <span className="text-muted-foreground">WhatsApp não identificado</span>}</p>
                      <p className="flex items-center gap-1 break-all text-muted-foreground"><Globe className="size-3 shrink-0" />{p.externalUrl || "Site não identificado"}</p>
                      {p.cnpj && <p className="text-muted-foreground">CNPJ: {p.cnpj}</p>}
                      {p.address && <p className="text-muted-foreground">Endereço: {p.address}</p>}
                      {p.aiSummary && <p className="text-muted-foreground">{p.aiSummary}</p>}
                      {p.contactSources?.filter(e => p[e.field === "website" ? "externalUrl" : e.field] === e.value).map((e, i) => (
                        <a key={`${e.field}-${i}`} href={e.url} target="_blank" rel="noreferrer" className="block break-all text-primary hover:underline">Fonte {e.field === "whatsapp" ? "WhatsApp" : e.field === "email" ? "e-mail" : e.field === "phone" ? "telefone" : "site"}: {e.method === "instagram" ? "Instagram" : e.method === "site" ? "Site da empresa" : "Pesquisa pública validada"}</a>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <a className="flex items-center gap-1 text-primary hover:underline" href={igProfileUrl(p.username)} target="_blank" rel="noreferrer">
                        <Instagram className="size-3" />@{p.username}
                      </a>
                      <span>· #{p.hashtag}</span>
                      {p.postUrl && (
                        <a className="flex items-center gap-1 text-primary hover:underline" href={p.postUrl} target="_blank" rel="noreferrer">
                          <ExternalLink className="size-3" />Publicação
                        </a>
                      )}
                    </div>
                  </>
                );
                return view === "cards" ? (
                  <article key={p.id} className={`space-y-2 rounded-xl border bg-card p-4 ${on ? "ring-2 ring-primary" : ""}`}>
                    <div className="flex items-start gap-2">
                      <Checkbox checked={on} onCheckedChange={(v) => toggle(v === true)} aria-label={`Selecionar @${p.username}`} />
                      <div className="min-w-0 flex-1">
                        <h4 className="truncate font-medium">{p.fullName || `@${p.username}`}</h4>
                        <p className="text-xs text-muted-foreground">Origem: Instagram - Apify{p.followers !== null ? ` · ${p.followers.toLocaleString("pt-BR")} seguidores` : ""}</p>
                      </div>
                    </div>
                    {badges}
                    {info}
                  </article>
                ) : (
                  <div key={p.id} className="flex items-start gap-3 p-3">
                    <Checkbox checked={on} onCheckedChange={(v) => toggle(v === true)} aria-label={`Selecionar @${p.username}`} />
                    <div className="min-w-0 flex-1 space-y-2">
                      <p className="truncate text-sm font-medium">
                        {p.fullName || `@${p.username}`} <span className="text-xs font-normal text-muted-foreground">· Instagram - Apify</span>
                      </p>
                      {badges}
                      {info}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {profiles.length > 0 && (
            <div className="sticky bottom-0 flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3 text-sm">
              <b>{selected.length} selecionada(s)</b>
              <span className="text-muted-foreground">· o cadastro definitivo depende da sua revisão</span>
              <Button className="ml-auto" disabled={!selected.length} onClick={review}>
                <ClipboardCheck className="size-4" />
                Revisar Selecionadas ({selected.length})
              </Button>
            </div>
          )}
        </section>
      )}

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Iniciar pesquisa no Instagram?</DialogTitle>
            <DialogDescription>
              A Apify consultará {tags.map((t) => `#${t}`).join(" ") || "as hashtags"} com até {limit} publicações por hashtag e depois investigará os perfis únicos encontrados. Essas duas etapas consomem créditos da sua conta Apify. A leitura direta dos sites não consome créditos Apify. A pesquisa pública complementar e a Pipeflow IA podem consumir créditos Lovable (Firecrawl: 4 créditos por 1.000 créditos de uso, 2 no Business). Resultados e contatos são reutilizados por 24 horas.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(false)}>Cancelar</Button>
            <Button disabled={busy} onClick={() => void start(false)}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Confirmar e pesquisar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(reuse)} onOpenChange={() => setReuse(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Esta pesquisa já foi feita hoje</DialogTitle>
            <DialogDescription>
              Existe uma pesquisa concluída nas últimas 24 horas com as mesmas hashtags e quantidade ({reuse?.profilesFound ?? 0} perfis). Reutilizar evita uma nova cobrança na Apify.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReuse(null)}>Voltar</Button>
            <Button variant="outline" disabled={busy} onClick={() => void start(true)}>Nova pesquisa mesmo assim</Button>
            <Button
              onClick={() => {
                if (reuse) void loadResults(reuse.id);
                setReuse(null);
              }}
            >
              Usar resultados anteriores
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
