import { requireB2bAccess, b2bDb } from "./b2b-prospecting.server";
import { getPortalAccount } from "./gravon-portal-admin.server";
import { EVOLUTION_BASE_URL } from "./evolution.functions";
import { fetchWithoutRedirects } from "./no-redirect-fetch.server";
import { boundedJson } from "./gravon-portal.server";
import { campaignInstances, type CampaignChannels, type ChannelBinding } from "./campaign-channels";

export async function campaignChannels(): Promise<CampaignChannels> {
  await requireB2bAccess();
  const checkedAt = new Date().toISOString();
  const fail = (error: string): CampaignChannels => ({ instances: [], error, checkedAt });
  const account = await getPortalAccount();
  if (!account?.authorized) return fail("Entre também com sua conta administrativa individual para verificar as instâncias da empresa.");
  const db = await b2bDb();
  const own = await db.from("portal_admin_channels").select("instance,canonical_phone,company_key").eq("user_id", account.userId).limit(201);
  if (own.error || !own.data?.length || own.data.length > 200 || own.data.some(b => b.company_key !== "crm:1")) return fail("Empresa ou canais sem escopo verificável neste CRM.");
  // A revoked RLS-visible grant must not be restored by the privileged lookup.
  const allowed = own.data.filter(b => account.channels.some(c => c.instance === b.instance && c.canonical_phone === b.canonical_phone));
  if (allowed.length !== own.data.length) return fail("Autorização do canal mudou; entre novamente e atualize.");
  const all = await db.from("portal_admin_channels").select("instance,canonical_phone,company_key").in("instance", allowed.map(b => b.instance)).limit(201);
  if (all.error || !all.data || all.data.length > 200) return fail("Não foi possível verificar vínculos exclusivos das instâncias.");
  const key = process.env.EVOLUTION_API_KEY;
  if (!key) return fail("Credencial da Evolution não configurada no servidor.");
  try {
    const response = await fetchWithoutRedirects(`${EVOLUTION_BASE_URL}/instance/fetchInstances`, { headers: { apikey: key }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) return fail(`Verificação de instâncias recusada pela Evolution (HTTP ${response.status}).`);
    const raw = await boundedJson(response, 1024 * 1024);
    return { instances: campaignInstances(raw, allowed as ChannelBinding[], all.data as ChannelBinding[]), error: null, checkedAt };
  } catch { return fail("Não foi possível verificar a Evolution: resposta inválida, conexão, prazo ou redirecionamento. Campanhas permanecem bloqueadas."); }
}