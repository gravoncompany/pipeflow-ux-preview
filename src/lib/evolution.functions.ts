import { createServerFn } from "@tanstack/react-start";

export const EVOLUTION_BASE_URL = "https://api.gravoncompany.online";

export type EvolutionInstance = {
  name: string;
  status: string;
  number: string;
  profileName: string;
};

type EvolutionStatusResponse = {
  ok: boolean;
  error: string | null;
  needsAuth: boolean;
  instances: EvolutionInstance[];
};

export const getEvolutionStatus = createServerFn({ method: "POST" }).handler(async (): Promise<EvolutionStatusResponse> => {
  const secret = process.env.CRM_SESSION_SECRET;
  const { hasFullCrmSession } = await import("./crm-session.server");
  if (!secret || !(await hasFullCrmSession(secret))) return { ok: false, error: null, needsAuth: true, instances: [] };

  const apiKey = process.env.EVOLUTION_API_KEY;
  if (!apiKey) return { ok: false, error: "A chave da Evolution API não está configurada.", needsAuth: false, instances: [] };

  try {
    const response = await fetch(`${EVOLUTION_BASE_URL}/instance/fetchInstances`, {
      headers: { apikey: apiKey },
    });
    const body = await response.text();
    if (!response.ok) {
      console.error(`Evolution API [${response.status}]: ${body}`);
      return { ok: false, error: `Evolution API respondeu ${response.status}: ${body.slice(0, 300)}`, needsAuth: false, instances: [] };
    }
    const data = JSON.parse(body) as unknown;
    const list = Array.isArray(data) ? data : [];
    const instances: EvolutionInstance[] = list.map((raw) => {
      const i = raw as Record<string, unknown>;
      const inner = (i.instance ?? {}) as Record<string, unknown>;
      return {
        name: String(i.name ?? inner.instanceName ?? ""),
        status: String(i.connectionStatus ?? inner.status ?? "unknown"),
        number: String(i.number ?? i.ownerJid ?? "").replace("@s.whatsapp.net", ""),
        profileName: String(i.profileName ?? ""),
      };
    });
    return { ok: true, error: null, needsAuth: false, instances };
  } catch (error) {
    console.error("Evolution API:", error);
    return { ok: false, error: `Falha ao conectar na Evolution API: ${error instanceof Error ? error.message : String(error)}`, needsAuth: false, instances: [] };
  }
});
