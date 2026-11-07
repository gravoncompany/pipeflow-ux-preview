import { tool } from "ai";
import { z } from "zod";
import { availableSlots, isSlotStillAvailable } from "../crm-calendar";
import { CALENDAR_ACTOR, liveCalendarBusy, readCalendarSettings, toCalendarSettings } from "../crm-calendar.server";

const fmt = (iso: string, tz: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: tz, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/**
 * Gravon IA calendar tools for the internal chat. The AI may consult real availability and
 * book a meeting only with an explicit confirmation in the same request; availability is
 * always rechecked against the live calendar immediately before creating the event.
 * The AI never confirms a time to a lead without consulting these tools first.
 */
export function createCalendarTools() {
  let booked = false;
  return {
    tools: {
      consultarHorariosAgenda: tool({
        description: "Consulta os horários realmente livres da agenda comercial (Google Agenda, intervalo de almoço, bloqueios e feriados). Use SEMPRE antes de oferecer ou confirmar qualquer horário.",
        inputSchema: z.object({ dias: z.number().int().min(1).max(30).default(7) }).strict(),
        execute: async ({ dias }) => {
          const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
          const settings = await readCalendarSettings(db);
          if (!settings?.enabled || !settings.calendar_id) return { available: false as const, reply: "A agenda não está ativa. Ative em Agenda → Configurações antes de oferecer horários." };
          const busy = await liveCalendarBusy(db, settings, dias);
          const slots = availableSlots(toCalendarSettings(settings), busy, { days: dias, limit: 12 });
          return { available: true as const, slots: slots.map((s) => ({ inicio: s.start, texto: fmt(s.start, settings.timezone) })) };
        },
      }),
      agendarReuniao: tool({
        description: "Agenda uma reunião comercial em um horário oferecido por consultarHorariosAgenda e escolhido pelo gestor. Exige confirmed=true. O horário é reverificado na hora; se estiver ocupado, nada é criado. Um agendamento por mensagem.",
        inputSchema: z.object({ leadId: z.string().uuid(), inicio: z.string().datetime({ offset: true }), titulo: z.string().min(1).max(500), confirmed: z.literal(true) }).strict(),
        execute: async (raw) => {
          if (booked) throw new Error("Um agendamento por mensagem.");
          booked = true;
          const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
          const settings = await readCalendarSettings(db);
          if (!settings?.enabled || !settings.calendar_id) throw new Error("A agenda não está ativa.");
          const { data: lead, error } = await db.from("leads").select("id,name").eq("id", raw.leadId).maybeSingle();
          if (error || !lead) throw new Error("Lead indisponível.");
          const busy = await liveCalendarBusy(db, settings, 60);
          if (!isSlotStillAvailable(toCalendarSettings(settings), busy, raw.inicio)) throw new Error("O horário não está mais disponível; consulte os horários novamente.");
          const start = new Date(raw.inicio);
          const end = new Date(start.getTime() + settings.duration_minutes * 60_000);
          const gc = await import("../google-calendar.server");
          const event = await gc.createCalendarEvent(settings.calendar_id, {
            summary: raw.titulo, description: `Reunião com ${lead.name} — agendada pela Gravon IA no PipeFlow CRM.`,
            start: start.toISOString(), end: end.toISOString(), timezone: settings.timezone,
          });
          const bookedRow = await db.rpc("book_crm_appointment", {
            p_actor: `${CALENDAR_ACTOR} (Gravon IA)`, p_lead: lead.id, p_event: event.id, p_summary: raw.titulo,
            p_start: start.toISOString(), p_end: end.toISOString(), p_origin: "ai",
          });
          if (bookedRow.error || !bookedRow.data) {
            await gc.deleteCalendarEvent(settings.calendar_id, event.id).catch(() => null);
            throw new Error("O agendamento não foi concluído: conflito de horário registrado no CRM. O evento criado foi desfeito.");
          }
          return { ok: true as const, id: bookedRow.data, texto: fmt(start.toISOString(), settings.timezone) };
        },
      }),
    },
  };
}

export const CALENDAR_INSTRUCTIONS = `
Agenda comercial (Google Agenda):
- NUNCA confirme ou sugira um horário específico sem antes chamar consultarHorariosAgenda nesta mesma resposta.
- Ofereça ao gestor apenas horários retornados pela ferramenta, no formato em que vieram.
- Só chame agendarReuniao depois que o gestor escolher explicitamente um dos horários oferecidos, com confirmed=true.
- Se o horário escolhido não estiver mais disponível, informe e consulte os horários novamente.
- Ao agendar, o card do lead é movido automaticamente para a etapa Reunião Agendada (quando o funil possui essa etapa) e o histórico do contato é registrado.`;
