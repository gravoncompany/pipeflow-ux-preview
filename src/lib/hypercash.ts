// HyperCash — lógica pura e determinística (sem rede nem banco). Compartilhada entre servidor e testes.
// Fontes: catálogo/assinaturas em https://api-hypercash.fly.dev (Bearer hcp_...) e pagamentos em
// https://api.hypercashbrasil.com.br/api (Basic x:chave). Nada aqui presume endpoints não documentados.

export const HYPERCASH_BASE = "https://api-hypercash.fly.dev";
export const HYPERCASH_PAYMENTS_BASE = "https://api.hypercashbrasil.com.br/api";

export const SUBSCRIPTION_STATUS = ["active", "paused", "cancelled", "expired", "payment_failed"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUS)[number];
export const SUBSCRIPTION_STATUS_LABEL: Record<SubscriptionStatus, string> = {
  active: "Ativa", paused: "Pausada", cancelled: "Cancelada", expired: "Expirada", payment_failed: "Pagamento falhou",
};

export const CHARGE_STATUS = ["pending", "paid", "failed", "cancelled", "refunded"] as const;
export type ChargeStatus = (typeof CHARGE_STATUS)[number];
export const CHARGE_STATUS_LABEL: Record<ChargeStatus, string> = {
  pending: "Pendente", paid: "Pago", failed: "Falhou", cancelled: "Cancelado", refunded: "Estornado",
};

export type HcSubscription = {
  subscriptionId: string; customerName: string | null; customerEmail: string | null;
  productName: string | null; amountCents: number | null; frequency: string | null;
  paymentMethod?: string | null; status: SubscriptionStatus; nextBillingDate: string | null; lastPaymentAt: string | null;
};
export type HcCharge = {
  chargeId: string; subscriptionId: string | null; transactionId: string | null; orderId: string | null;
  amountCents: number; status: ChargeStatus; billingDate: string | null; paidAt: string | null;
};

const text = (v: unknown, max = 200): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
const cents = (v: unknown): number | null =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 1_000_000_000 ? v : null;
const iso = (v: unknown): string | null => {
  const s = text(v, 40);
  return s && !Number.isNaN(Date.parse(s)) ? s : null;
};

/** Valida e normaliza uma assinatura da API. Devolve null quando o payload não é confiável. */
export function mapSubscription(raw: unknown): HcSubscription | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = text(r.id, 80);
  const status = text(r.status, 40) as SubscriptionStatus | null;
  if (!id || !status || !(SUBSCRIPTION_STATUS as readonly string[]).includes(status)) return null;
  return {
    subscriptionId: id,
    paymentMethod: text(r.paymentMethod,40),
    customerName: text(r.customerName),
    customerEmail: text(r.customerEmail)?.toLowerCase() ?? null,
    productName: text(r.productName),
    amountCents: cents(r.amount),
    frequency: text(r.frequency, 40),
    status,
    nextBillingDate: iso(r.nextBillingDate),
    lastPaymentAt: iso(r.lastPaymentAt),
  };
}

/** Valida e normaliza uma cobrança (transação de assinatura). Devolve null quando o payload não é confiável. */
export function mapCharge(raw: unknown, fallbackSubscriptionId?: string): HcCharge | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = text(r.id, 80);
  const status = text(r.status, 40) as ChargeStatus | null;
  const amount = cents(r.amount);
  if (!id || !status || !(CHARGE_STATUS as readonly string[]).includes(status) || amount === null) return null;
  return {
    chargeId: id,
    subscriptionId: text(r.subscriptionId, 80) ?? fallbackSubscriptionId ?? null,
    transactionId: text(r.transactionId, 80),
    orderId: text(r.orderId, 80),
    amountCents: amount,
    status,
    billingDate: iso(r.billingDate),
    paidAt: iso(r.paidAt),
  };
}

/** Extrai a lista `data` de uma resposta paginada da HyperCash, com limites defensivos. */
export function pagedData(body: unknown, maxItems = 100): { items: unknown[]; total: number | null } {
  if (!body || typeof body !== "object") return { items: [], total: null };
  const b = body as { data?: unknown; total?: unknown };
  const items = Array.isArray(b.data) ? b.data.slice(0, maxItems) : [];
  const total = typeof b.total === "number" && Number.isSafeInteger(b.total) && b.total >= 0 ? b.total : null;
  return { items, total };
}

export type ClientCandidate = { id: string; tradeName: string | null; legalName: string | null; email: string | null };

/**
 * Vinculação automática somente por e-mail exato e único entre os clientes cadastrados.
 * Nome nunca é suficiente (homônimos); sem e-mail único a vinculação fica para revisão manual.
 */
export function matchClientByEmail(email: string | null, clients: ClientCandidate[]): ClientCandidate | null {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) return null;
  const found = clients.filter((c) => c.email?.trim().toLowerCase() === normalized);
  return found.length === 1 ? found[0] : null;
}

/**
 * Regra anti-duplicidade de faturamento: uma cobrança HyperCash paga vira receita uma única vez.
 * O repasse posterior da HyperCash para a conta bancária é liquidação da plataforma, nunca nova receita.
 */
export function isHypercashPayout(text: string): boolean {
  return /\bhyper\s?cash\b/.test(text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase());
}

/** Descrição padrão da cobrança interna criada ao confirmar um recebimento HyperCash. */
export function chargeDescription(charge: HcCharge, productName: string | null): string {
  const base = productName?.trim() || "Assinatura HyperCash";
  return `${base} · HyperCash ${charge.transactionId ?? charge.chargeId}`.slice(0, 200);
}

export function hypercashReadiness(input: { hasSubscriptions: boolean; hasTransactions: boolean; active: boolean; subscriptionCheck: string | null; transactionCheck: string | null; syncStatus: string | null; syncedAt: string | null }) {
  return {
    subscriptions: !input.hasSubscriptions ? "Credencial HCP não cadastrada" : input.subscriptionCheck !== "ok" ? "Verificação pendente ou falhou" : input.active ? "Assinaturas verificadas" : "Assinaturas desativadas",
    transactions: !input.hasTransactions ? "Credencial SK não cadastrada" : input.transactionCheck === "ok" ? "Transações verificadas" : "Verificação pendente ou falhou",
    sync: input.syncStatus === "ok" && input.syncedAt ? "Sincronização concluída" : input.syncStatus ? "Sincronização não concluída" : "Nunca sincronizada",
    canSync: input.hasSubscriptions && input.active && input.subscriptionCheck === "ok",
  };
}
