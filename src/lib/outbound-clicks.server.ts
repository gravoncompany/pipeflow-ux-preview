import { b2bDb, requireB2bAccess } from './b2b-prospecting.server';
import { EMAIL_PUBLIC_ORIGIN } from './email-content';
import { clickClassification, rewriteEmailLinks, trackingDestination } from './outbound-clicks';
import { landingWithUtms } from './automations';

export async function trackFlowEmail(message: string, content: { html: string; text: string }) {
  // Never send unavailable tracking URLs while these edits are still only in preview.
  try {
    const probe = await fetch(`${EMAIL_PUBLIC_ORIGIN}/api/public/email-click/${'0'.repeat(64)}`, { method: 'OPTIONS', redirect: 'manual', signal: AbortSignal.timeout(5000) });
    if (probe.status !== 204 || probe.headers.get('X-Pipeflow-Click-Tracking') !== 'v1') return content;
  } catch { return content; }
  const db = await b2bDb();
  return rewriteEmailLinks(content, async url => {
    // Resolve the old run link to its destination before wrapping it: only one click recorder runs.
    const parsed = new URL(url);
    const old = parsed.origin === EMAIL_PUBLIC_ORIGIN && parsed.pathname.match(/^\/api\/public\/r\/([a-f0-9]{32})$/);
    if (old) {
      const run = await db.from('crm_automation_runs').select('automation_id').eq('token', old[1]).maybeSingle();
      if (!run.data) throw new Error('Link da automação indisponível.');
      const a = await db.from('crm_automations').select('landing_url,slug').eq('id', run.data.automation_id).single();
      if (!a.data?.landing_url) throw new Error('Destino da automação indisponível.');
      url = landingWithUtms(a.data.landing_url, a.data.slug, old[1]);
    }
    const r = await db.rpc('register_outbound_email_link', { p_message: message, p_url: url });
    if (r.error) throw new Error('Não foi possível preparar o rastreamento.');
    return typeof r.data === 'string' ? `${EMAIL_PUBLIC_ORIGIN}/api/public/email-click/${r.data}` : null;
  });
}

export async function redirectEmailClick(request: Request, token: string, record = true) {
  if (!/^[a-f0-9]{64}$/.test(token)) return new Response('Link indisponível.', { status: 404 });
  const db = await b2bDb();
  // A random, private capability token authorizes only this stored destination/event, never CRM disclosure.
  const bytes = new TextEncoder().encode(`${token}:${request.headers.get('user-agent')?.slice(0, 500) ?? ''}:${request.headers.get('cf-connecting-ip') ?? ''}`);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  const r = await db.rpc('record_outbound_email_click', { p_token: token, p_classification: clickClassification(request.headers), p_fingerprint: hash, p_record: record });
  const url = typeof r.data === 'string' ? trackingDestination(r.data) : null;
  if (!url) return new Response('Link indisponível.', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  return new Response(null, { status: 302, headers: { Location: url, 'Cache-Control': 'no-store, private', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' } });
}

export async function outboundClickHistory(leadId: string) {
  await requireB2bAccess();
  const db = await b2bDb();
  const links = await db.from('crm_outbound_email_links').select('id,url,subject,message_id,test').eq('lead_id', leadId).limit(500);
  if (links.error) throw new Error('Histórico de cliques indisponível.');
  const ids = (links.data ?? []).map(l => l.id);
  const clicks = ids.length ? await db.from('crm_outbound_email_clicks').select('id,link_id,classification,created_at').in('link_id', ids).order('created_at', { ascending: false }).limit(200) : { data: [], error: null };
  if (clicks.error) throw new Error('Histórico de cliques indisponível.');
  await requireB2bAccess();
  return (clicks.data ?? []).map(c => { const l = links.data?.find(l => l.id === c.link_id); return { id: c.id as string, at: c.created_at as string, classification: c.classification as string, url: l?.url as string ?? '', subject: l?.subject as string ?? '', messageId: l?.message_id as string | null, test: Boolean(l?.test) }; });
}

export async function sendOutboundTrackingTest(email: string) {
  await requireB2bAccess();
  const { registerTestRecipient, sendEmailTest } = await import('./email-campaigns.server');
  await registerTestRecipient(email, 'Teste de cliques autorizado');
  const db = await b2bDb();
  const recipient = await db.from('crm_campaign_test_recipients').select('id').eq('email', email).is('revoked_at', null).single();
  const pipes = await db.from('sales_pipelines').select('id,name').eq('archived', false);
  const pipeline = pipes.data?.find(p => String(p.name).trim().toLowerCase() === 'outbound');
  if (!recipient.data || !pipeline) throw new Error('Destinatário de teste ou Outbound indisponível.');
  // No real contact data: this fixture cannot enroll in commercial sends.
  const fixture = await db.from('leads').insert({ name: '[Teste] Rastreamento de clique', company: 'Teste Pipeflow — sem contato comercial', email: '', whatsapp: '', stage: 'perda', source: 'Teste', notes: 'Teste autorizado de rastreamento; não contatar.' }).select('id').single();
  if (!fixture.data || fixture.error) throw new Error('Não foi possível preparar o card de teste.');
  const bound = await db.from('leads').update({ pipeline_id: pipeline.id }).eq('id', fixture.data.id);
  if (bound.error) throw new Error('Não foi possível vincular o teste ao Outbound.');
  // Remove only this fixture's unsent trigger entry, never change commercial automation settings.
  await db.from('crm_automation_entries').delete().eq('lead_id', fixture.data.id);
  const link = await db.from('crm_outbound_email_links').insert({ lead_id: fixture.data.id, url: 'https://gravoncompany.com/', subject: 'Pipeflow — teste de clique autorizado', test: true }).select('id,token').single();
  if (!link.data) throw new Error('Não foi possível preparar o link de teste.');
  const outcome = await sendEmailTest({ recipientId: recipient.data.id, campaignId: null, subject: 'Pipeflow — teste de clique autorizado', body: `[link: Abrir teste de clique | ${EMAIL_PUBLIC_ORIGIN}/api/public/email-click/${link.data.token}]` });
  if (!outcome.ok) throw new Error(outcome.message);
  const saved = await db.from('crm_outbound_email_links').update({ test_accepted: true }).eq('id', link.data.id);
  if (saved.error) throw new Error('E-mail aceito, mas registro não confirmado. Não repita o envio.');
  return { leadId: fixture.data.id as string, link: `/api/public/email-click/${link.data.token}`, message: outcome.message };
}