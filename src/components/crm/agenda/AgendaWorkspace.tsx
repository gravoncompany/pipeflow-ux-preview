import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Ban, CalendarClock, CalendarDays, ChevronLeft, ChevronRight, ExternalLink, Plus, RefreshCw, Settings2, Trash2 } from "lucide-react";
import { CrmAuthGate } from "@/components/crm/CrmAuthGate";
import { AtendimentoLayout } from "@/components/crm/AtendimentoLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  getCrmCalendar, getCrmCalendarEvents, saveCrmCalendarSettings, getCrmCalendarSlots, bookCrmAppointment,
  rescheduleCrmAppointment, cancelCrmAppointment, addCrmCalendarBlocked, removeCrmCalendarBlocked,
} from "@/lib/crm-calendar.functions";
import { AGENDA_TZ, addDays, itemDays, mergeAgendaItems, spClock, weekBounds, weekDays, weekStartOf, type AgendaItem } from "@/lib/agenda-week";
import { todaySaoPaulo } from "@/lib/dashboard";

const WEEK_DAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const fmt = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: AGENDA_TZ, dateStyle: "short", timeStyle: "short" });
const fmtDay = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: AGENDA_TZ, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: AGENDA_TZ, hour: "2-digit", minute: "2-digit" });
const dayTitle = (day: string, opts: Intl.DateTimeFormatOptions) => new Date(`${day}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC", ...opts });
const HOUR_PX = 48;

type Snapshot = Awaited<ReturnType<typeof getCrmCalendar>>;

export function AgendaWorkspace({ view, openMeetingId, onMeetingOpened }: { view: "calendar" | "list"; openMeetingId?: string; onMeetingOpened?: () => void }) {
  const read = useServerFn(getCrmCalendar);
  const readEvents = useServerFn(getCrmCalendarEvents);
  const save = useServerFn(saveCrmCalendarSettings);
  const loadSlots = useServerFn(getCrmCalendarSlots);
  const book = useServerFn(bookCrmAppointment);
  const reschedule = useServerFn(rescheduleCrmAppointment);
  const cancel = useServerFn(cancelCrmAppointment);
  const addBlocked = useServerFn(addCrmCalendarBlocked);
  const removeBlocked = useServerFn(removeCrmCalendarBlocked);
  const cache = useQueryClient();
  const q = useQuery({ queryKey: ["crm-calendar"], queryFn: () => read(), retry: false });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [form, setForm] = useState({ calendarId: "", durationMinutes: 30, gapMinutes: 15, businessDays: [1, 2, 3, 4, 5], dayStart: "09:00", dayEnd: "18:00", lunchStart: "13:30", lunchEnd: "14:00", minNoticeHours: 2, responsible: "", enabled: false });
  const [booking, setBooking] = useState<{ leadId: string; slots: { start: string; end: string }[]; slot: string; summary: string; rescheduleId?: string } | null>(null);
  const [pickLead, setPickLead] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AgendaItem | null>(null);
  const [blockForm, setBlockForm] = useState({ date: "", start: "00:00", end: "23:59", reason: "" });
  const [today, setToday] = useState("");
  const [weekStart, setWeekStart] = useState("");
  useEffect(() => { const t = todaySaoPaulo(); setToday(t); setWeekStart((w) => w || weekStartOf(t)); }, []);
  const data = q.data;
  const bounds = weekStart ? weekBounds(weekStart) : null;
  const ev = useQuery({
    queryKey: ["crm-calendar-events", bounds?.from], queryFn: () => readEvents({ data: bounds! }),
    enabled: Boolean(bounds && data && view === "calendar"), retry: false, staleTime: 60_000,
  });

  useEffect(() => {
    if (data?.settings) {
      const s = data.settings;
      setForm({ calendarId: s.calendar_id, durationMinutes: s.duration_minutes, gapMinutes: s.gap_minutes, businessDays: s.business_days, dayStart: String(s.day_start).slice(0, 5), dayEnd: String(s.day_end).slice(0, 5), lunchStart: String(s.lunch_start).slice(0, 5), lunchEnd: String(s.lunch_end).slice(0, 5), minNoticeHours: s.min_notice_hours, responsible: s.responsible, enabled: s.enabled });
    }
  }, [data]);

  const items = useMemo(() => data ? mergeAgendaItems(data.appointments, ev.data?.events ?? [], data.leadNames) : [], [data, ev.data]);

  // Atalho do Dashboard (?reuniao=): vai para a semana da reunião e abre os detalhes uma vez.
  useEffect(() => {
    if (!openMeetingId || !data) return;
    const a = data.appointments.find((x) => x.id === openMeetingId);
    if (a) {
      setWeekStart(weekStartOf(spClock(a.starts_at).day));
      setDetail(mergeAgendaItems([a], [], data.leadNames)[0] ?? { key: `crm:${a.id}`, kind: "crm", id: a.id, summary: a.summary, subtitle: data.leadNames[a.lead_id] ?? "Lead", start: a.starts_at, end: a.ends_at, allDay: false });
    } else setError("Essa reunião não está mais disponível na agenda.");
    onMeetingOpened?.();
  }, [openMeetingId, data]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(key: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(key); setError(""); setNotice("");
    try {
      await fn(); if (ok) setNotice(ok);
      await cache.invalidateQueries({ queryKey: ["crm-calendar"] });
      await cache.invalidateQueries({ queryKey: ["crm-calendar-events"] });
      await cache.invalidateQueries({ queryKey: ["dashboard-today"] });
    }
    catch (e) { setError(e instanceof Error ? e.message : "A operação não foi concluída."); }
    finally { setBusy(""); }
  }

  async function startBooking(leadId: string, rescheduleId?: string) {
    setBusy("slots"); setError(""); setPickLead(false); setDetail(null);
    try {
      const result = await loadSlots({ data: { days: 14 } });
      setBooking({ leadId, slots: result.slots.slice(0, 30), slot: "", summary: "", rescheduleId });
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível consultar os horários."); }
    finally { setBusy(""); }
  }

  if (q.isPending) return <AtendimentoLayout><div className="flex-1 p-6"><p className="py-6 text-muted-foreground">Carregando agenda…</p></div></AtendimentoLayout>;
  if (q.isError) return <CrmAuthGate onUnlock={() => void q.refetch()} />;
  if (!data) return null;
  const revision = data.settings?.revision ?? 0;
  const scheduled = data.appointments.filter((a) => a.status === "scheduled").sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const past = data.appointments.filter((a) => a.status !== "scheduled");
  const detailAppt = detail?.kind === "crm" ? data.appointments.find((a) => a.id === detail.id) ?? null : null;
  const openAppt = (a: Snapshot["appointments"][number]) => setDetail(mergeAgendaItems([a], [], data.leadNames)[0] ?? null);

  return <AtendimentoLayout>
    <div className="min-w-0 flex-1 space-y-6 overflow-y-auto px-4 py-6 md:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4 md:pr-28">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">{view === "calendar" ? <CalendarDays className="size-6" /> : <CalendarClock className="size-6" />}{view === "calendar" ? "Calendário" : "Lista de reuniões"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Agendamento com confirmação humana — a Pipeflow IA nunca confirma horário sem verificar a disponibilidade.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setPickLead(true)} disabled={busy === "slots"}><Plus />{busy === "slots" ? "Consultando horários…" : "Agendar reunião"}</Button>
          <Button variant="outline" onClick={() => setSettingsOpen(true)}><Settings2 />Disponibilidade</Button>
          <Button variant="outline" size="icon" aria-label="Atualizar agenda" title="Atualizar agenda" onClick={() => { void q.refetch(); void ev.refetch(); }}><RefreshCw className={q.isFetching || ev.isFetching ? "animate-spin" : ""} /></Button>
        </div>
      </header>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
      {!data.settings?.enabled && <p className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">A agenda está desativada para novos agendamentos. Ative e escolha o calendário em <button type="button" className="font-medium text-primary underline-offset-2 hover:underline" onClick={() => setSettingsOpen(true)}>Disponibilidade</button>.</p>}

      {view === "calendar" && weekStart && <WeekCalendar weekStart={weekStart} today={today} items={items} onWeek={setWeekStart} onOpen={setDetail}
        status={ev.isFetching ? "Carregando eventos do Google Agenda…" : ev.data && !ev.data.configured ? "Escolha o calendário comercial em Disponibilidade para ver os eventos do Google Agenda." : ev.data?.error ? `Eventos do Google Agenda indisponíveis: ${ev.data.error}` : ev.isError ? "Eventos do Google Agenda indisponíveis no momento." : ""} />}

      {view === "list" && <section className="space-y-4 rounded-xl border bg-card p-5">
        <h2 className="flex items-center gap-2 font-semibold"><CalendarClock className="size-4" />Reuniões agendadas</h2>
        {scheduled.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma reunião agendada.</p>}
        <ul className="divide-y">
          {scheduled.map((a) => <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
            <button type="button" className="min-w-0 text-left" onClick={() => openAppt(a)}>
              <p className="font-medium hover:text-primary">{a.summary}</p>
              <p className="text-muted-foreground">{data.leadNames[a.lead_id] ?? "Lead"} · {fmtDay(a.starts_at)} · {a.origin === "ai" ? "Pipeflow IA" : "Manual"}{a.responsible ? ` · ${a.responsible}` : ""}</p>
            </button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => void startBooking(a.lead_id, a.id)}>Reagendar</Button>
              <Button variant="ghost" size="sm" onClick={() => setCancelId(a.id)}>Cancelar</Button>
            </div>
          </li>)}
        </ul>
        {past.length > 0 && <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">Histórico de canceladas ({past.length})</summary>
          <ul className="mt-2 divide-y">{past.map((a) => <li key={a.id} className="py-2 text-muted-foreground">{a.summary} · {data.leadNames[a.lead_id] ?? "Lead"} · {fmtDay(a.starts_at)} · cancelada</li>)}</ul>
        </details>}
      </section>}

      {/* Detalhes do compromisso */}
      <Dialog open={!!detail} onOpenChange={(open) => { if (!open) setDetail(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="break-words pr-6">{detail?.summary}</DialogTitle>
            <DialogDescription>{detail?.kind === "google" ? "Evento do Google Agenda · somente leitura no Pipeflow." : "Reunião registrada pelo Pipeflow e sincronizada com o Google Agenda."}</DialogDescription>
          </DialogHeader>
          {detail && <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Quando</dt>
            <dd>{detail.allDay ? `${dayTitle(detail.start.slice(0, 10), { weekday: "long", day: "2-digit", month: "long" })} · dia inteiro` : `${new Date(detail.start).toLocaleDateString("pt-BR", { timeZone: AGENDA_TZ, weekday: "long", day: "2-digit", month: "long", year: "numeric" })} · ${hhmm(detail.start)}–${hhmm(detail.end)}`}</dd>
            <dt className="text-muted-foreground">Fuso</dt><dd>Horário de Brasília (America/Sao_Paulo)</dd>
            {detailAppt && <>
              <dt className="text-muted-foreground">Lead</dt><dd>{data.leadNames[detailAppt.lead_id] ?? "Lead"}</dd>
              <dt className="text-muted-foreground">Origem</dt><dd>{detailAppt.origin === "ai" ? "Pipeflow IA" : "Manual"}</dd>
              {detailAppt.responsible && <><dt className="text-muted-foreground">Responsável</dt><dd>{detailAppt.responsible}</dd></>}
              <dt className="text-muted-foreground">Situação</dt><dd>{detailAppt.status === "scheduled" ? "Agendada" : "Cancelada"}</dd>
            </>}
          </dl>}
          {detailAppt && <div className="flex flex-wrap gap-2 pt-2">
            <Button asChild variant="outline" size="sm"><Link to="/" search={{ lead: detailAppt.lead_id }}><ExternalLink />Abrir card</Link></Button>
            {detailAppt.status === "scheduled" && <>
              <Button variant="outline" size="sm" onClick={() => void startBooking(detailAppt.lead_id, detailAppt.id)}>Reagendar</Button>
              <Button variant="ghost" size="sm" onClick={() => { setCancelId(detailAppt.id); setDetail(null); }}>Cancelar reunião</Button>
            </>}
          </div>}
        </DialogContent>
      </Dialog>

      {/* Agendamento manual: escolher o lead */}
      <Dialog open={pickLead} onOpenChange={setPickLead}>
        <DialogContent>
          <DialogHeader><DialogTitle>Agendar reunião</DialogTitle><DialogDescription>Escolha o lead para ver os horários livres no Google Agenda.</DialogDescription></DialogHeader>
          <div className="space-y-1">
            <Label className="text-xs">Lead</Label>
            <Select onValueChange={(v) => void startBooking(v)}>
              <SelectTrigger aria-label="Lead para agendar"><SelectValue placeholder="Escolha o lead" /></SelectTrigger>
              <SelectContent>{data.leads.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </DialogContent>
      </Dialog>

      {/* Disponibilidade, calendário e bloqueios */}
      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader><SheetTitle>Disponibilidade</SheetTitle><SheetDescription>Calendário, horários de atendimento e bloqueios usados para oferecer horários.</SheetDescription></SheetHeader>
          <div className="space-y-6 px-4 pb-6">
            <section className="space-y-4">
              {data.calendarsError && <p role="alert" className="text-sm text-destructive">{data.calendarsError}</p>}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs">Calendário comercial</Label>
                  <Select value={form.calendarId} onValueChange={(v) => setForm({ ...form, calendarId: v })}>
                    <SelectTrigger aria-label="Calendário comercial"><SelectValue placeholder="Selecione um calendário existente" /></SelectTrigger>
                    <SelectContent>{data.calendars.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.primary ? " (principal)" : ""}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <Field label="Responsável comercial"><Input value={form.responsible} maxLength={160} onChange={(e) => setForm({ ...form, responsible: e.target.value })} /></Field>
                <Field label="Duração das reuniões (minutos)"><Input inputMode="numeric" value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: Number(e.target.value.replace(/\D/g, "")) || 0 })} /></Field>
                <Field label="Intervalo entre reuniões (minutos, até 20)"><Input inputMode="numeric" value={form.gapMinutes} onChange={(e) => setForm({ ...form, gapMinutes: Math.min(20, Number(e.target.value.replace(/\D/g, "")) || 0) })} /></Field>
                <Field label="Antecedência mínima (horas)"><Input inputMode="numeric" value={form.minNoticeHours} onChange={(e) => setForm({ ...form, minNoticeHours: Number(e.target.value.replace(/\D/g, "")) || 0 })} /></Field>
                <Field label="Início do atendimento"><Input type="time" value={form.dayStart} onChange={(e) => setForm({ ...form, dayStart: e.target.value })} /></Field>
                <Field label="Encerramento"><Input type="time" value={form.dayEnd} onChange={(e) => setForm({ ...form, dayEnd: e.target.value })} /></Field>
                <Field label="Intervalo de almoço — início"><Input type="time" value={form.lunchStart} onChange={(e) => setForm({ ...form, lunchStart: e.target.value })} /></Field>
                <Field label="Intervalo de almoço — fim"><Input type="time" value={form.lunchEnd} onChange={(e) => setForm({ ...form, lunchEnd: e.target.value })} /></Field>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Dias disponíveis</Label>
                <div className="flex flex-wrap gap-2">
                  {WEEK_DAYS.map((label, day) => <Button key={day} type="button" size="sm" variant={form.businessDays.includes(day) ? "default" : "outline"} aria-pressed={form.businessDays.includes(day)}
                    onClick={() => setForm({ ...form, businessDays: form.businessDays.includes(day) ? form.businessDays.filter((d) => d !== day) : [...form.businessDays, day].sort() })}>{label}</Button>)}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm"><Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />Agenda ativa para agendamentos</label>
                <Button disabled={busy === "save"} onClick={() => void run("save", () => save({ data: { ...form, revision } }), "Configurações salvas.")}>{busy === "save" ? "Salvando…" : "Salvar configurações"}</Button>
              </div>
              <p className="text-xs text-muted-foreground">Fuso horário: America/Sao_Paulo. Horários ocupados, intervalo de almoço, bloqueios e feriados cadastrados nunca são oferecidos.</p>
            </section>
            <section className="space-y-4 border-t pt-5">
              <h3 className="flex items-center gap-2 font-semibold"><Ban className="size-4" />Bloqueios e feriados</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Data"><Input type="date" value={blockForm.date} onChange={(e) => setBlockForm({ ...blockForm, date: e.target.value })} /></Field>
                <Field label="Motivo"><Input value={blockForm.reason} maxLength={160} placeholder="Ex.: Feriado municipal" onChange={(e) => setBlockForm({ ...blockForm, reason: e.target.value })} /></Field>
                <Field label="Início"><Input type="time" value={blockForm.start} onChange={(e) => setBlockForm({ ...blockForm, start: e.target.value })} /></Field>
                <Field label="Fim"><Input type="time" value={blockForm.end} onChange={(e) => setBlockForm({ ...blockForm, end: e.target.value })} /></Field>
              </div>
              <Button variant="outline" disabled={busy === "block" || !blockForm.date || !blockForm.reason.trim()} onClick={() => void run("block", async () => {
                const start = new Date(`${blockForm.date}T${blockForm.start}:00-03:00`).toISOString();
                const end = new Date(`${blockForm.date}T${blockForm.end}:00-03:00`).toISOString();
                await addBlocked({ data: { start, end, reason: blockForm.reason.trim() } });
                setBlockForm({ date: "", start: "00:00", end: "23:59", reason: "" });
              }, "Bloqueio registrado.")}><Plus />Adicionar bloqueio</Button>
              {data.blocked.length > 0 && <ul className="divide-y">
                {data.blocked.map((b) => <li key={b.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span>{fmt(b.starts_at)} — {fmt(b.ends_at)} · {b.reason}</span>
                  <Button variant="ghost" size="icon" aria-label={`Remover bloqueio ${b.reason}`} onClick={() => void run(`rmblock:${b.id}`, () => removeBlocked({ data: { id: b.id } }), "Bloqueio removido.")}><Trash2 className="size-4" /></Button>
                </li>)}
              </ul>}
            </section>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={!!booking} onOpenChange={(open) => { if (!open) setBooking(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{booking?.rescheduleId ? "Reagendar reunião" : "Agendar reunião"}</DialogTitle>
            <DialogDescription>Somente horários livres verificados agora no Google Agenda são exibidos. O card do lead é movido para Reunião Agendada.</DialogDescription>
          </DialogHeader>
          {booking && <div className="space-y-4">
            {!booking.rescheduleId && <div className="space-y-1">
              <Label className="text-xs">Título</Label>
              <Input value={booking.summary} maxLength={500} placeholder="Ex.: Reunião comercial — apresentação da proposta" onChange={(e) => setBooking({ ...booking, summary: e.target.value })} />
            </div>}
            {booking.slots.length === 0 && <p className="text-sm text-muted-foreground">Nenhum horário livre nos próximos 14 dias com as configurações atuais.</p>}
            <ul className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
              {booking.slots.map((s) => <li key={s.start}><Button type="button" size="sm" variant={booking.slot === s.start ? "default" : "outline"} className="w-full" onClick={() => setBooking({ ...booking, slot: s.start })}>{fmtDay(s.start)}</Button></li>)}
            </ul>
            <Button disabled={busy === "confirm" || !booking.slot || (!booking.rescheduleId && !booking.summary.trim())} onClick={() => void run("confirm", async () => {
              if (booking.rescheduleId) await reschedule({ data: { id: booking.rescheduleId, start: booking.slot, confirmed: true } });
              else await book({ data: { leadId: booking.leadId, start: booking.slot, summary: booking.summary.trim(), confirmed: true } });
              setBooking(null);
            }, booking.rescheduleId ? "Reunião reagendada." : "Reunião agendada e card atualizado.")}>{busy === "confirm" ? "Confirmando…" : "Confirmar agendamento"}</Button>
          </div>}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!cancelId} onOpenChange={(open) => { if (!open) setCancelId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar reunião</AlertDialogTitle>
            <AlertDialogDescription>O evento será removido do Google Agenda e o cancelamento ficará registrado no histórico do contato.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const id = cancelId; setCancelId(null); if (id) void run(`cancel:${id}`, () => cancel({ data: { id, confirmed: true } }), "Reunião cancelada."); }}>Cancelar reunião</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  </AtendimentoLayout>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label>{children}</div>;
}

/** Semana em grade de horários no computador; no celular, lista por dia. */
function WeekCalendar({ weekStart, today, items, onWeek, onOpen, status }: { weekStart: string; today: string; items: AgendaItem[]; onWeek: (w: string) => void; onOpen: (i: AgendaItem) => void; status: string }) {
  const days = weekDays(weekStart);
  const byDay = new Map(days.map((d) => [d, { timed: [] as AgendaItem[], allDay: [] as AgendaItem[] }]));
  for (const it of items) for (const d of itemDays(it)) { const slot = byDay.get(d); if (slot) (it.allDay ? slot.allDay : slot.timed).push(it); }
  const timed = items.filter((i) => !i.allDay && byDay.has(spClock(i.start).day));
  const startHour = Math.min(8, ...timed.map((i) => Math.floor(spClock(i.start).minutes / 60)));
  const endHour = Math.max(19, ...timed.map((i) => { const c = spClock(i.end); return c.day === spClock(i.start).day ? Math.ceil(c.minutes / 60) : 24; }));
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const hasAllDay = days.some((d) => byDay.get(d)!.allDay.length > 0);
  const range = `${dayTitle(days[0], { day: "2-digit", month: "short" })} – ${dayTitle(days[6], { day: "2-digit", month: "short", year: "numeric" })}`.replace(/\./g, "").replace(/ de /g, " ");
  const chip = (it: AgendaItem) => it.kind === "crm" ? "border-primary bg-primary text-primary-foreground" : "border-primary/30 bg-primary/10 text-foreground";

  return <section className="space-y-3 rounded-xl border bg-card p-3 md:p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" aria-label="Semana anterior" onClick={() => onWeek(addDays(weekStart, -7))}><ChevronLeft /></Button>
        <Button variant="outline" size="sm" onClick={() => onWeek(weekStartOf(today))}>Hoje</Button>
        <Button variant="outline" size="icon" aria-label="Próxima semana" onClick={() => onWeek(addDays(weekStart, 7))}><ChevronRight /></Button>
        <h2 className="ml-2 font-semibold">{range}</h2>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-primary" />Reuniões do Pipeflow</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm border border-primary/30 bg-primary/10" />Google Agenda</span>
        <span>Horário de Brasília</span>
      </div>
    </div>
    {status && <p className="text-xs text-muted-foreground">{status}</p>}

    {/* Celular: lista por dia */}
    <ol className="space-y-3 md:hidden">
      {days.map((d) => { const s = byDay.get(d)!; const list = [...s.allDay, ...s.timed.sort((a, b) => a.start.localeCompare(b.start))]; return <li key={d}>
        <p className={`text-sm font-semibold first-letter:uppercase ${d === today ? "text-primary" : ""}`}>{dayTitle(d, { weekday: "long", day: "2-digit", month: "2-digit" })}{d === today ? " · hoje" : ""}</p>
        {list.length === 0 ? <p className="text-xs text-muted-foreground">Sem compromissos.</p> : <ul className="mt-1 space-y-1">{list.map((it) => <li key={it.key}>
          <button type="button" onClick={() => onOpen(it)} className={`flex w-full items-start gap-3 rounded-md border px-3 py-2 text-left text-sm ${chip(it)}`}>
            <span className="w-12 shrink-0 font-semibold tabular-nums">{it.allDay ? "Dia" : hhmm(it.start)}</span>
            <span className="min-w-0"><span className="block break-words font-medium">{it.summary}</span><span className="block truncate text-xs opacity-80">{it.subtitle}</span></span>
          </button>
        </li>)}</ul>}
      </li>; })}
    </ol>

    {/* Computador: grade da semana */}
    <div className="hidden overflow-x-auto md:block">
      <div className="min-w-[620px]">
        <div className="grid grid-cols-[52px_repeat(7,1fr)] border-b">
          <div />
          {days.map((d) => <div key={d} className={`px-2 py-2 text-center text-xs ${d === today ? "font-semibold text-primary" : "text-muted-foreground"}`}>
            <span className="capitalize">{dayTitle(d, { weekday: "short" }).replace(".", "")}</span>
            <span className={`ml-1 inline-flex size-6 items-center justify-center rounded-full text-sm ${d === today ? "bg-primary text-primary-foreground" : "text-foreground"}`}>{d.slice(8)}</span>
          </div>)}
        </div>
        {hasAllDay && <div className="grid grid-cols-[52px_repeat(7,1fr)] border-b py-1">
          <div className="pr-2 text-right text-[10px] text-muted-foreground">Dia todo</div>
          {days.map((d) => <div key={d} className="space-y-1 px-1">{byDay.get(d)!.allDay.map((it) => <button key={it.key} type="button" onClick={() => onOpen(it)} className={`block w-full truncate rounded border px-1.5 py-0.5 text-left text-[11px] ${chip(it)}`} title={it.summary}>{it.summary}</button>)}</div>)}
        </div>}
        <div className="relative grid grid-cols-[52px_repeat(7,1fr)]" style={{ height: hours.length * HOUR_PX }}>
          <div className="relative">{hours.map((h, i) => <span key={h} className="absolute right-2 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground" style={{ top: i * HOUR_PX }}>{i === 0 ? "" : `${String(h).padStart(2, "0")}:00`}</span>)}</div>
          {days.map((d) => <div key={d} className={`relative border-l ${d === today ? "bg-primary/5" : ""}`}>
            {hours.map((h, i) => <div key={h} className="absolute inset-x-0 border-t border-border/60" style={{ top: i * HOUR_PX }} />)}
            {byDay.get(d)!.timed.map((it) => {
              const s = spClock(it.start), e = spClock(it.end);
              const endMin = e.day === s.day ? e.minutes : 24 * 60;
              const top = ((s.minutes - startHour * 60) / 60) * HOUR_PX;
              const height = Math.max(22, ((endMin - s.minutes) / 60) * HOUR_PX - 2);
              return <button key={it.key} type="button" onClick={() => onOpen(it)} title={`${hhmm(it.start)}–${hhmm(it.end)} · ${it.summary}`}
                className={`absolute inset-x-1 overflow-hidden rounded-md border px-1.5 py-0.5 text-left text-[11px] leading-tight shadow-sm ${chip(it)}`} style={{ top, height }}>
                <span className="block font-semibold tabular-nums">{hhmm(it.start)}</span>
                <span className="block break-words font-medium">{it.summary}</span>
                {height > 50 && <span className="block truncate opacity-80">{it.subtitle}</span>}
              </button>;
            })}
          </div>)}
        </div>
      </div>
    </div>
    {items.length === 0 && !status && <p className="text-center text-sm text-muted-foreground">Nenhum compromisso nesta semana.</p>}
  </section>;
}
