// Ativação das notificações push no navegador (inclui iPhone com o app na Tela de Início).
// Usa o service worker dedicado /push-sw.js; não registra cache do aplicativo.

const b64uToBytes = (s: string): Uint8Array => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export type PushActivation =
  | { ok: true; endpoint: string }
  | { ok: false; error: string };

/** Pede permissão, registra o service worker e cria a inscrição push. */
export async function activatePush(vapidPublicKey: string): Promise<PushActivation> {
  if (!pushSupported()) return { ok: false, error: "Este navegador não aceita notificações push. No iPhone, instale o Pipeflow pela opção “Adicionar à Tela de Início” do Safari e abra pelo ícone." };
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, error: "Permissão de notificações negada no navegador." };
  try {
    const registration = await navigator.serviceWorker.register("/push-sw.js");
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing ?? await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64uToBytes(vapidPublicKey) as BufferSource,
    });
    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return { ok: false, error: "Inscrição push incompleta neste dispositivo." };
    return { ok: true, endpoint: json.endpoint };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha ao ativar as notificações." };
  }
}

/** Inscrição atual deste dispositivo (null se não houver). */
export async function currentPushEndpoint(): Promise<string | null> {
  if (!pushSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.getRegistration("/push-sw.js");
    const subscription = await registration?.pushManager.getSubscription();
    return subscription?.endpoint ?? null;
  } catch {
    return null;
  }
}

export async function deactivatePush(): Promise<string | null> {
  const endpoint = await currentPushEndpoint();
  if (!endpoint) return null;
  try {
    const registration = await navigator.serviceWorker.getRegistration("/push-sw.js");
    const subscription = await registration?.pushManager.getSubscription();
    await subscription?.unsubscribe();
  } catch { /* a remoção no servidor ainda vale */ }
  return endpoint;
}
