import { EVOLUTION_BASE_URL } from "./evolution.functions";
import { fetchWithoutRedirects } from "./no-redirect-fetch.server";
import { campaignChannels } from "./campaign-channels.server";
import { requireB2bAccess, b2bDb } from "./b2b-prospecting.server";
import { getPortalAccount } from "./gravon-portal-admin.server";
import { boundedJson } from "./gravon-portal.server";
import { normalizeGroups, type WhatsAppGroup } from "./whatsapp-group-snapshot";
export type { WhatsAppGroup } from "./whatsapp-group-snapshot";

type Scope = { company: string; instance: string; phone: string };
type GroupsResult = { groups: WhatsAppGroup[]; error: string | null; fetchedAt: string | null; syncing: boolean; needsSync: boolean };

/** Cache reads recheck the private identity and exclusive binding, without waiting for Evolution. */
async function groupScope(instance: string): Promise<Scope> {
  await requireB2bAccess();
  const account = await getPortalAccount();
  if (!account?.authorized) throw new Error("Entre com sua conta administrativa individual para consultar grupos.");
  const d = await b2bDb();
  const own = await d.from("portal_admin_channels").select("instance,canonical_phone,company_key").eq("user_id", account.userId).eq("instance", instance).limit(2);
  const binding = own.data?.[0];
  if (own.error || own.data?.length !== 1 || !binding || binding.company_key !== "crm:1" || !account.channels.some(c => c.instance === instance && c.canonical_phone === binding.canonical_phone)) throw new Error("Instância sem vínculo verificado com a empresa.");
  const all = await d.from("portal_admin_channels").select("canonical_phone,company_key").eq("instance", instance).limit(201);
  if (all.error || !all.data?.length || all.data.length > 200 || all.data.some(b => b.company_key !== binding.company_key || b.canonical_phone !== binding.canonical_phone)) throw new Error("Vínculo exclusivo da instância não confirmado.");
  return { company: binding.company_key, instance, phone: binding.canonical_phone };
}
function scoped(d: Awaited<ReturnType<typeof b2bDb>>, s: Scope) {
  return d.from("crm_whatsapp_group_snapshots").select("groups,synced_at,lease_until,error_code").eq("company_key",s.company).eq("instance",s.instance).eq("binding_phone",s.phone).maybeSingle();
}
async function recheckScope(s: Scope) {
  const current = await groupScope(s.instance);
  if (current.company !== s.company || current.phone !== s.phone) throw new Error("O vínculo da instância mudou; atualize a seleção de grupos.");
}
export async function listCampaignGroups(instance: string, opts: { refresh?: boolean } = {}): Promise<GroupsResult> {
  if (opts.refresh) return syncCampaignGroups(instance, true);
  const s = await groupScope(instance), d = await b2bDb();
  const r = await scoped(d,s);
  if (r.error) throw new Error("Não foi possível ler os grupos armazenados.");
  await recheckScope(s);
  const fetchedAt = r.data?.synced_at as string | null ?? null;
  return { groups: (r.data?.groups ?? []) as WhatsAppGroup[], fetchedAt, syncing: Date.parse(r.data?.lease_until ?? "") > Date.now(), needsSync: !fetchedAt || Date.now()-Date.parse(fetchedAt)>300000, error: r.data?.error_code ? "A última atualização falhou; a lista anterior foi preservada." : null };
}

/** A durable lease coalesces manual/automatic sync across workers; failures retain the last successful snapshot. */
export async function syncCampaignGroups(instance: string, force = false): Promise<GroupsResult> {
  const s = await groupScope(instance), d = await b2bDb();
  const channels = await campaignChannels();
  if (!channels.instances.some(i => i.reference === instance && i.campaignAuthorized)) throw new Error(channels.error ?? "Instância indisponível para campanhas.");
  const key = process.env.EVOLUTION_API_KEY;
  if (!key) throw new Error("Credencial da Evolution não configurada.");
  const token = crypto.randomUUID();
  const claim = await d.rpc("claim_whatsapp_group_sync", { p_company:s.company,p_instance:instance,p_phone:s.phone,p_token:token,p_force:force });
  if (claim.error) throw new Error("Não foi possível reservar a atualização de grupos.");
  if (!claim.data) return listCampaignGroups(instance);
  let groups: WhatsAppGroup[] = [], error: string | null = null;
  const started = Date.now();
  try {
    const r = await fetchWithoutRedirects(`${EVOLUTION_BASE_URL}/group/fetchAllGroups/${encodeURIComponent(instance)}?getParticipants=false`, { headers:{apikey:key}, signal:AbortSignal.timeout(110000) });
    if (!r.ok) throw new Error(`http_${r.status}`);
    groups = normalizeGroups(await boundedJson(r, 8_000_000), s.phone);
  } catch { error = "sync_failed"; }
  console.log(`Evolution group sync ${error ?? "ok"} ${Date.now()-started}ms groups=${groups.length}`);
  await recheckScope(s);
  const saved = await d.rpc("finish_whatsapp_group_sync", { p_company:s.company,p_instance:instance,p_phone:s.phone,p_token:token,p_groups:groups,p_error:error });
  if (saved.error || !saved.data) throw new Error("A atualização perdeu a autorização ou expirou; a lista anterior foi preservada.");
  return listCampaignGroups(instance);
}

/** Fetch only selected group metadata; a stored snapshot is never permission to send. */
export async function verifyCampaignGroups(instance: string, jids: string[]) {
  const s = await groupScope(instance);
  const channels = await campaignChannels();
  if (!channels.instances.some(i => i.reference === instance && i.campaignAuthorized)) return { groups: [] as WhatsAppGroup[], error: channels.error ?? "Instância indisponível." };
  const key = process.env.EVOLUTION_API_KEY;
  if (!key) return { groups: [] as WhatsAppGroup[], error: "Credencial da Evolution não configurada." };
  const groups: WhatsAppGroup[] = [];
  const unique = [...new Set(jids)];
  if (unique.length > 1000 || unique.some(j => !/^[0-9]{5,40}(-[0-9]+)?@g\.us$/.test(j))) throw new Error("Seleção de grupos inválida.");
  // Bounded concurrency; no all-participant list for the entire instance.
  for (let i=0;i<unique.length;i+=8) {
    const batch = await Promise.all(unique.slice(i,i+8).map(async jid => {
      try {
        const r = await fetchWithoutRedirects(`${EVOLUTION_BASE_URL}/group/findGroupInfos/${encodeURIComponent(instance)}?groupJid=${encodeURIComponent(jid)}`, { headers:{apikey:key}, signal:AbortSignal.timeout(15000) });
        if (!r.ok) return [];
        const g = await boundedJson(r,2_000_000);
        return normalizeGroups([g],s.phone,true).filter(g => g.jid===jid);
      } catch { return []; }
    }));
    groups.push(...batch.flat());
  }
  await recheckScope(s);
  return { groups, error: null };
}
