import { z } from "zod";

export const adAccountIdSchema = z.string().trim().regex(/^act_\d{5,25}$/, "Conta de anúncios inválida.");

/** Meta reports spend as a decimal string ("41.82"); convert without floating-point rounding. */
export function spendToCents(value: string): number | null {
  const m = /^(\d{1,12})(?:\.(\d{1,6}))?$/.exec(value.trim());
  if (!m) return null;
  const frac = (m[2] ?? "").padEnd(3, "0");
  const cents = Number(m[1]) * 100 + Number(frac.slice(0, 2)) + (Number(frac[2]) >= 5 ? 1 : 0);
  return Number.isSafeInteger(cents) ? cents : null;
}

export const insightRowSchema = z.object({
  campaign_id: z.string().regex(/^\d{1,30}$/),
  campaign_name: z.string().default(""),
  adset_id: z.string().regex(/^\d{1,30}$/),
  adset_name: z.string().default(""),
  spend: z.string(),
  account_currency: z.string().regex(/^[A-Z]{3}$/),
  date_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).passthrough();

export type SpendRow = { spend_date: string; campaign_id: string; campaign_name: string; adset_id: string; adset_name: string; spend_cents: number; currency: string };

/** Valid rows become one record per day+adset; repeated keys keep the last value (re-import replaces, never adds). */
export function parseInsights(rows: unknown[]) {
  const out = new Map<string, SpendRow>();
  let rejected = 0;
  for (const raw of rows) {
    const r = insightRowSchema.safeParse(raw);
    const cents = r.success ? spendToCents(r.data.spend) : null;
    if (!r.success || cents === null) { rejected++; continue; }
    out.set(`${r.data.date_start}|${r.data.adset_id}`, { spend_date: r.data.date_start, campaign_id: r.data.campaign_id, campaign_name: r.data.campaign_name.slice(0, 400),
      adset_id: r.data.adset_id, adset_name: r.data.adset_name.slice(0, 400), spend_cents: cents, currency: r.data.account_currency });
  }
  return { rows: [...out.values()], rejected };
}

export type PeriodKey = "7d" | "30d" | "month" | "custom";
const iso = (d: Date) => d.toISOString().slice(0, 10);
/** São Paulo calendar dates; "7d"/"30d" include today. */
export function periodRange(key: PeriodKey, today: string, custom?: { from: string; to: string }) {
  const t = new Date(`${today}T12:00:00Z`);
  if (key === "custom" && custom) return { from: custom.from, to: custom.to };
  if (key === "month") return { from: `${today.slice(0, 7)}-01`, to: today };
  const days = key === "7d" ? 7 : 30;
  const f = new Date(t); f.setUTCDate(f.getUTCDate() - (days - 1));
  return { from: iso(f), to: today };
}

export function saoPauloToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Total, daily series (missing days = 0), daily average over the period and per-campaign totals. One currency at a time. */
export function aggregateSpend(rows: { spend_date: string; campaign_id: string; campaign_name: string; adset_id: string; adset_name: string; spend_cents: number }[], from: string, to: string) {
  const days: string[] = [];
  for (let d = new Date(`${from}T12:00:00Z`); iso(d) <= to && days.length < 800; d.setUTCDate(d.getUTCDate() + 1)) days.push(iso(d));
  const byDay = new Map(days.map((d) => [d, 0]));
  const byCampaign = new Map<string, { id: string; name: string; cents: number; adsets: Map<string, { id: string; name: string; cents: number }> }>();
  let total = 0;
  for (const r of rows) {
    if (r.spend_date < from || r.spend_date > to) continue;
    total += r.spend_cents;
    byDay.set(r.spend_date, (byDay.get(r.spend_date) ?? 0) + r.spend_cents);
    const c = byCampaign.get(r.campaign_id) ?? { id: r.campaign_id, name: r.campaign_name, cents: 0, adsets: new Map() };
    c.cents += r.spend_cents;
    const a = c.adsets.get(r.adset_id) ?? { id: r.adset_id, name: r.adset_name, cents: 0 };
    a.cents += r.spend_cents; c.adsets.set(r.adset_id, a); byCampaign.set(r.campaign_id, c);
  }
  return {
    totalCents: total,
    dailyAverageCents: days.length ? Math.round(total / days.length) : 0,
    days: days.map((d) => ({ date: d, cents: byDay.get(d) ?? 0 })),
    campaigns: [...byCampaign.values()].sort((a, b) => b.cents - a.cents).map((c) => ({ id: c.id, name: c.name, cents: c.cents, adsets: [...c.adsets.values()].sort((a, b) => b.cents - a.cents) })),
  };
}
