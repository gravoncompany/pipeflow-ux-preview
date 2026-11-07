export const WHATSAPP_CAMPAIGN_ACK = "Li e concordo com as orientações de envio pelo WhatsApp. Confirmo que minha lista tem autorizações necessárias, que não farei spam e que respeitarei solicitações de não recebimento.";
/** Envio controlado: poucos contatos por lote, com intervalo entre mensagens. */
export const WHATSAPP_BATCH_SIZE = 3;
export const WHATSAPP_SEND_GAP_MS = 4000;
export type DeliveryCounts = { total: number; queued: number; sending: number; accepted: number; failed: number; unknown: number; cancelled: number };
export function summarizeDeliveries(states: string[]): DeliveryCounts {
  const c: DeliveryCounts = { total: states.length, queued: 0, sending: 0, accepted: 0, failed: 0, unknown: 0, cancelled: 0 };
  for (const s of states) {
    if (s === "queued") c.queued++; else if (s === "reserved") c.sending++; else if (s === "accepted") c.accepted++;
    else if (s === "failed") c.failed++; else if (s === "unknown") c.unknown++; else if (s === "cancelled") c.cancelled++;
  }
  return c;
}

/** Velocidade por campanha. Intervalo sorteado dentro da faixa; pausa após N envios. */
export const SEND_INTERVALS = [
  { key: "1-5", min: 1, max: 5, label: "1 a 5 segundos" },
  { key: "5-10", min: 5, max: 10, label: "5 a 10 segundos" },
  { key: "10-15", min: 10, max: 15, label: "10 a 15 segundos" },
  { key: "15-20", min: 15, max: 20, label: "15 a 20 segundos" },
] as const;
export const PAUSE_EVERY = [1, 2, 5, 10, 20, 40, 80] as const;
export const PAUSE_SECONDS = [30, 60, 120, 300, 600, 900] as const;
export type Pacing = { min: number; max: number; pauseEvery: number; pauseSeconds: number };
export const DEFAULT_PACING: Pacing = { min: 5, max: 10, pauseEvery: 20, pauseSeconds: 120 };
/** Presets or custom values within operational bounds (queue control only; does not avoid WhatsApp limits). */
export function isValidPacing(p: Pacing) {
  const int = (n: number) => Number.isInteger(n);
  return int(p.min) && int(p.max) && int(p.pauseEvery) && int(p.pauseSeconds) && p.min >= 1 && p.min <= 300 && p.max >= p.min && p.max <= 600 && p.pauseEvery >= 1 && p.pauseEvery <= 500 && p.pauseSeconds >= 30 && p.pauseSeconds <= 1800;
}
/** Group messages: only {{grupo}} is filled; individual fields are cleared, never taken from participants. */
export function groupText(text: string, groupName: string) {
  return text.replace(/\{\{grupo\}\}/g, groupName).replace(/\{\{(nome|empresa)\}\}/g, "");
}
/** Estimativa (segundos) para enviar `remaining` mensagens: intervalo médio + pausas completas. */
export function estimateSeconds(remaining: number, p: Pacing, sentSincePause = 0) {
  if (remaining <= 0) return 0;
  const avg = (p.min + p.max) / 2;
  const pauses = Math.floor((sentSincePause + remaining - 1) / p.pauseEvery);
  return Math.round(remaining * avg + pauses * p.pauseSeconds);
}
export function formatDuration(s: number) {
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

/** Short, storable reason from an Evolution error body (never the raw body). */
export function evolutionFailureCode(status: number, body: string): string {
  let j: unknown = null; try { j = JSON.parse(body); } catch { /* not json */ }
  const msg = (j as { response?: { message?: unknown } } | null)?.response?.message;
  const items = Array.isArray(msg) ? msg : [];
  if (items.some(m => m && typeof m === "object" && (m as { exists?: unknown }).exists === false)) return "not_on_whatsapp";
  const text = items.map(m => typeof m === "string" ? m : "").join(" ").toLowerCase() + " " + body.slice(0, 500).toLowerCase();
  if (/connection closed|not connected|instance.*(not|does not) exist/.test(text)) return "instance_disconnected";
  if (status === 401 || status === 403) return "evolution_unauthorized";
  if (status === 404) return "instance_not_found";
  return `http_${status}`;
}

/** Plain-language reason for a delivery error code. */
export function deliveryErrorText(code: string): string {
  const map: Record<string, string> = {
    not_on_whatsapp: "Número sem WhatsApp (a Evolution não encontrou conta neste número).",
    invalid_number: "Número de telefone inválido ou incompleto.",
    instance_disconnected: "A instância do WhatsApp estava desconectada.",
    instance_not_found: "Instância do WhatsApp não encontrada na Evolution.",
    evolution_unauthorized: "A Evolution recusou a credencial do servidor.",
    timeout_or_network: "Sem resposta da Evolution; o envio pode ou não ter ocorrido e não será repetido.",
    stopped: "Não enviado: campanha interrompida.",
    http_400: "A Evolution recusou o número (formato sem o código do país 55, corrigido nas próximas campanhas).",
  };
  return map[code] ?? (code ? `Erro da Evolution (${code}).` : "");
}

/** Campaign label that distinguishes completed with errors and interrupted. */
export function whatsAppCampaignLabel(state: string, c: DeliveryCounts | null): string {
  if (state === "cancelled") return c && c.total > 0 ? "Interrompida" : "Cancelada";
  if (state === "completed") return c && (c.failed + c.unknown) > 0 ? (c.accepted === 0 ? "Concluída sem envios (todas com erro)" : "Concluída com erros") : "Concluída";
  return ({ draft: "Rascunho", running: "Em andamento", scheduled: "Agendada", paused: "Pausada" } as Record<string, string>)[state] ?? state;
}
