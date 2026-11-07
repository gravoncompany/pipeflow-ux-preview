import type { Lead } from './crm-types';
import { instagramProfile } from './business-links';

export const CLICK_TAG = 'clicou-no-link';
export function lastEmailClick(lead: Pick<Lead, 'history'>) {
  return lead.history.filter(h => h.id.startsWith('outbound-click:')).reduce((at, h) => Math.max(at, Date.parse(h.date) || 0), 0);
}
export function clickInstagram(value: string) {
  return instagramProfile(value) || (/^@?[a-z0-9._]{1,30}$/i.test(value.trim()) ? instagramProfile(`https://www.instagram.com/${value.trim().replace(/^@/, '')}/`) : '');
}
export function clickClassification(headers: Headers): 'human' | 'automated' | 'unknown' {
  const ua = headers.get('user-agent') ?? '';
  if (/bot|crawler|spider|headless|python|curl|wget|proofpoint|mimecast|barracuda|safelinks|scan|preview|security|fetcher/i.test(ua) || /prefetch|preview/i.test(`${headers.get('purpose') ?? ''} ${headers.get('sec-purpose') ?? ''}`)) return 'automated';
  if (headers.get('sec-fetch-user') === '?1' && headers.get('sec-fetch-mode') === 'navigate') return 'human';
  // A browser-looking agent alone does not prove a person clicked.
  return 'unknown';
}
export function trackingDestination(raw: string) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password || raw.length > 2000 || !u.hostname.includes('.') || /^(localhost|127\.|10\.|192\.168\.|169\.254\.)/i.test(u.hostname)) return null;
    return u.toString();
  } catch { return null; }
}

/** Uses the same mapping in HTML, Outlook VML and plain text; never tracks image loads or mailto. */
export async function rewriteEmailLinks(content: { html: string; text: string }, register: (url: string) => Promise<string | null>) {
  const urls = new Set<string>();
  for (const m of content.html.matchAll(/href="(https:\/\/[^"<>\s]+)"/g)) urls.add(m[1].replace(/&amp;/g, '&'));
  for (const m of content.text.matchAll(/https:\/\/[^\s<>"\])]+/g)) urls.add(m[0].replace(/[.,;]+$/, ''));
  if (urls.size > 50) throw new Error('Este e-mail tem links demais para rastrear.');
  const map = new Map<string, string>();
  for (const url of urls) {
    if (!trackingDestination(url) || /\/api\/public\/(unsubscribe|email-images|email-click)/i.test(url)) continue;
    const tracked = await register(url);
    if (tracked) map.set(url, tracked);
  }
  const html = content.html.replace(/href="(https:\/\/[^"<>\s]+)"/g, (full, raw: string) => {
    const tracked = map.get(raw.replace(/&amp;/g, '&')); return tracked ? `href="${tracked}"` : full;
  });
  const text = content.text.replace(/https:\/\/[^\s<>"\])]+/g, raw => {
    const url = raw.replace(/[.,;]+$/, ''); return (map.get(url) ?? url) + raw.slice(url.length);
  });
  return { html, text };
}