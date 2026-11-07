import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useNavigate } from "@tanstack/react-router";
import { Orbit, Settings, LogOut, Camera, Pencil, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { clearStoredAccess } from "@/components/crm/CrmAuthGate";
import { logoutCrm } from "@/lib/crm-auth.functions";
import { getCrmProfile, saveCrmProfile } from "@/lib/crm-profile.functions";
import { initials, PHOTO_MAX_LENGTH, type CrmProfile } from "@/lib/crm-profile";
import { getUniverseSheetCard } from "@/lib/gravon-universe.functions";
import { universeMoney } from "@/lib/gravon-universe";
import { JOURNEYS, journeyProgress } from "@/lib/gravon-universe-journey";

// Reduz a imagem no navegador (quadrado central, 256 px, JPEG) antes de enviar; o servidor revalida o formato.
async function resizePhoto(file: File): Promise<string> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Use uma imagem JPEG, PNG ou WebP.");
  if (file.size > 15 * 1024 * 1024) throw new Error("Imagem muito grande (máximo 15 MB).");
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height), size = 256;
  const canvas = document.createElement("canvas"); canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Não foi possível processar a imagem.");
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  for (const quality of [0.85, 0.7, 0.55]) { const url = canvas.toDataURL("image/jpeg", quality); if (url.length <= PHOTO_MAX_LENGTH) return url; }
  throw new Error("Não foi possível reduzir a imagem o suficiente.");
}

function Avatar({ profile, size }: { profile: CrmProfile | undefined; size: "sm" | "lg" }) {
  const cls = size === "sm" ? "size-10 text-sm" : "size-14 text-lg";
  return profile?.photo
    ? <img src={profile.photo} alt="Foto de perfil" className={`${cls} rounded-full object-cover`} />
    : <span className={`${cls} flex items-center justify-center rounded-full bg-sidebar font-semibold text-sidebar-foreground`}>{initials(profile?.displayName ?? "")}</span>;
}

// Foto de perfil no canto superior direito (ao lado das notificações). O acesso ao Universo Pipeflow fica no pop-up.
export function ProfileMenu() {
  const [open, setOpen] = useState(false), [editing, setEditing] = useState(false);
  const [name, setName] = useState(""), [email, setEmail] = useState(""), [err, setErr] = useState(""), [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient(); const navigate = useNavigate();
  const save = useServerFn(saveCrmProfile), logout = useServerFn(logoutCrm), cardFn = useServerFn(getUniverseSheetCard), profileFn = useServerFn(getCrmProfile);
  const profile = useQuery({ queryKey: ["crm-profile"], queryFn: () => profileFn(), retry: false, staleTime: 60_000 });
  const card = useQuery({ queryKey: ["universe-sheet-card"], queryFn: () => cardFn({ data: { force: false } }), enabled: open, retry: false, refetchInterval: open ? 60_000 : false });
  if (profile.isError) return null; // sem sessão completa: não exibe
  const p = profile.data;
  async function persist(next: { displayName: string; email: string; photo: string | null }) {
    if (!p) return; setSaving(true); setErr("");
    try { const out = await save({ data: { ...next, revision: p.revision } }); if (!out.ok) { setErr(out.error); return; } qc.setQueryData(["crm-profile"], out.profile); setEditing(false); }
    catch { setErr("Não foi possível salvar o perfil."); } finally { setSaving(false); }
  }
  async function onFile(file: File | undefined) {
    if (!file || !p) return;
    try { await persist({ displayName: p.displayName, email: p.email, photo: await resizePhoto(file) }); }
    catch (e) { setErr(e instanceof Error ? e.message : "Imagem inválida."); }
  }
  const c = card.data && card.data.ok ? card.data.card : null;
  // Mesmos marcos e regra da Jornada Mensal do Universe (Lua → Marte, R$ 10 mil a R$ 50 mil).
  const monthly = JOURNEYS.mensal.milestones;
  const journey = c && c.revenueCents !== null ? journeyProgress(c.revenueCents / 100, monthly) : null;
  return <Popover open={open} onOpenChange={v => { setOpen(v); if (!v) { setEditing(false); setErr(""); } }}>
    <PopoverTrigger asChild>
      <button type="button" aria-label="Abrir perfil" title="Perfil" className="fixed right-4 top-3 z-40 rounded-full ring-1 ring-primary/60 ring-offset-2 ring-offset-background transition hover:ring-2 focus-visible:outline-none focus-visible:ring-2 md:right-6">
        <Avatar profile={p} size="sm" />
      </button>
    </PopoverTrigger>
    <PopoverContent align="end" sideOffset={10} className="w-[min(360px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-sidebar-border bg-sidebar p-0 text-sidebar-foreground shadow-2xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95" aria-label="Perfil">
      <div className="flex items-center gap-3 border-b border-sidebar-border p-4">
        <button type="button" className="group relative shrink-0 rounded-full ring-1 ring-sidebar-highlight/70" title="Trocar foto" aria-label="Trocar foto de perfil" disabled={saving || !p?.available} onClick={() => fileRef.current?.click()}>
          <Avatar profile={p} size="lg" /><span className="absolute inset-0 flex items-center justify-center rounded-full bg-sidebar/70 opacity-0 transition group-hover:opacity-100"><Camera className="size-5" /></span>
        </button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
        <div className="min-w-0 flex-1"><p className="truncate font-semibold">{p?.displayName || "Seu nome"}</p><p className="truncate text-xs text-sidebar-foreground/75">{p?.email || "Adicione seu e-mail"}</p></div>
        <Button size="icon" variant="ghost" className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground" aria-label="Editar perfil" disabled={!p?.available} onClick={() => { setEditing(v => !v); setName(p?.displayName ?? ""); setEmail(p?.email ?? ""); }}><Pencil className="size-4" /></Button>
      </div>
      {editing && <div className="space-y-2 border-b border-sidebar-border p-4 text-sm">
        <label className="block">Nome<input className="mt-1 w-full rounded-md border border-sidebar-border bg-sidebar-accent text-sidebar-foreground px-2 py-1.5" maxLength={80} value={name} onChange={e => setName(e.target.value)} /></label>
        <label className="block">E-mail<input type="email" className="mt-1 w-full rounded-md border border-sidebar-border bg-sidebar-accent text-sidebar-foreground px-2 py-1.5" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} /></label>
        <div className="flex gap-2"><Button size="sm" disabled={saving} onClick={() => void persist({ displayName: name, email, photo: p?.photo ?? null })}>{saving ? "Salvando…" : "Salvar"}</Button>
          {p?.photo && <Button size="sm" variant="ghost" className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground" disabled={saving} onClick={() => void persist({ displayName: name, email, photo: null })}>Remover foto</Button>}</div>
      </div>}
      {p && !p.available && <p className="px-4 pt-3 text-xs text-sidebar-foreground/75">Perfil indisponível até aplicar a migração 0082.</p>}
      {err && <p role="alert" className="px-4 pt-3 text-xs text-destructive-foreground">{err}</p>}
      <nav className="p-2 text-sm">
        <Link to="/configuracoes/integracoes/instagram" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-sidebar-accent"><Settings className="size-4 text-sidebar-highlight" />Configurações da conta</Link>
        <button type="button" className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-sidebar-accent" onClick={async () => { await logout(); clearStoredAccess(); window.location.href = "/"; }}><LogOut className="size-4 text-sidebar-highlight" />Sair</button>
      </nav>
      <button type="button" className="universe-profile-card m-3 mt-0 block w-[calc(100%-1.5rem)] rounded-xl border border-sidebar-primary/50 bg-gradient-to-br from-sidebar-accent via-sidebar to-sidebar-accent p-4 text-left transition hover:border-sidebar-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        aria-label="Abrir Universo Pipeflow" onClick={() => { setOpen(false); void navigate({ to: "/gravon-universe" }); }}>
        <div className="flex items-center justify-between"><p className="flex items-center gap-2 text-xs font-semibold tracking-[0.2em] text-sidebar-highlight"><Orbit className="size-4 motion-safe:animate-[spin_12s_linear_infinite]" />UNIVERSO PIPEFLOW</p>
          {card.isFetching && <RefreshCw className="size-3 animate-spin text-sidebar-foreground/75" />}</div>
        {card.isPending ? <p className="mt-3 text-sm text-sidebar-foreground/75">Lendo a planilha…</p>
          : card.data && !card.data.ok ? <p className="mt-3 text-xs text-destructive-foreground">Não foi possível ler a planilha: {card.data.error}</p>
          : c && <>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm"><div><dt className="text-xs text-sidebar-foreground/75">Faturamento do mês</dt><dd className="font-semibold">{c.revenueCents === null ? "Sem valor lançado" : universeMoney(c.revenueCents)}</dd></div>
              <div><dt className="text-xs text-sidebar-foreground/75">Meta mensal</dt><dd className="font-semibold">{universeMoney(c.goalCents)}</dd></div></dl>
            <div className="mt-3 flex items-center justify-between text-xs"><span className="text-sidebar-foreground/75">Progresso · {c.monthLabel}</span><span className="font-semibold text-sidebar-highlight">{c.percent}%</span></div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-sidebar-foreground/15" role="progressbar" aria-valuenow={c.percent} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-gradient-to-r from-sidebar-primary to-sidebar-highlight transition-[width] duration-700" style={{ width: `${c.percent}%` }} /></div>
            {journey && <p className="mt-2 text-sm">{journey.next ? <>Faltam <span className="font-semibold text-sidebar-highlight">{universeMoney(Math.round(journey.remaining * 100))}</span> para conquistar {journey.next.name}</> : "Todas as conquistas do mês alcançadas"}</p>}
            {journey && <p className="text-xs text-sidebar-foreground/75">{journey.current ? `Planeta atual: ${journey.current.name}` : "Ponto de partida: Início"} · {journey.achieved} de {monthly.length} conquistas</p>}
            <p className="mt-2 text-xs text-sidebar-foreground/75">{c.revenueCents === null ? `A planilha ainda não tem valor para ${c.monthLabel}.` : `Faltam ${universeMoney(c.remainingCents)} para a meta de ${universeMoney(c.goalCents)}.`}{card.data?.ok && card.data.syncedAt ? ` · sincronizado ${new Date(card.data.syncedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : ""}</p>
          </>}
      </button>
    </PopoverContent>
  </Popover>;
}
