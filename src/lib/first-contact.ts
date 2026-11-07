import { z } from "zod";
import { phoneDigits } from "./phone";

export const FIRST_CONTACT_ORIGIN = "https://trafego.gravoncompany.com";
export const FIRST_CONTACT_TEST_PHONE = "5551999986839";
export const firstContactTestSchema = z.object({
  phone: z.literal(FIRST_CONTACT_TEST_PHONE),
  firstName: z.string().trim().regex(/^[\p{L}][\p{L}'’-]{0,79}$/u),
  consent: z.literal(true), instance: z.string().min(1).max(160),
}).strict();
export const FIRST_CONTACT_MESSAGES = [
  "Olá, {primeiro_nome}! Tudo bem?",
  "Vi que você preencheu nosso formulário sobre nossa agência de tráfego pago e marketing digital, onde apresentamos nosso plano atual.",
  "Estamos com um plano de teste disponível para que você possa conhecer nosso serviço de tráfego pago durante 30 dias.",
  "Gostaria de saber se você já investiu em tráfego pago?",
] as const;

export const firstContactSettingsSchema = z.object({ enabled: z.boolean(), interval: z.number().int().min(5).max(300).default(10), stopOnReply: z.boolean().default(true), instance: z.string().min(1).max(160), revision: z.string().uuid() }).strict();
export const firstContactConsentSchema = z.object({
  granted: z.literal(true), at: z.string().datetime({ offset: true }), version: z.string().trim().min(1).max(160),
}).strict();
export function commercialFormOrigin(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try { const url = new URL(raw); return url.origin === FIRST_CONTACT_ORIGIN ? url.origin : null; } catch { return null; }
}
export function firstContactIdentity(name: string, rawPhone: string) {
  const first = name.trim().split(/\s+/)[0] ?? "";
  const phone = phoneDigits(rawPhone);
  if (!/^[\p{L}][\p{L}'’-]{0,79}$/u.test(first) || /^(sem|teste|test)$/i.test(first) || !/^[1-9]\d{9,14}$/.test(phone) || /^(.)(\1)+$/.test(phone)) return null;
  return { first, phone };
}
export function fixedFirstContactText(step: number, first: string) {
  const text = FIRST_CONTACT_MESSAGES[step - 1];
  if (!text) throw new Error("invalid_step");
  return text.replace("{primeiro_nome}", first);
}
export function firstContactFormEvidence(name: string, phone: string, raw: Record<string, unknown>, eventId?: string) {
  const origin = commercialFormOrigin(raw.form_origin ?? raw.landing_url);
  const consent = firstContactConsentSchema.safeParse(raw.whatsapp_consent);
  const identity = firstContactIdentity(name, phone);
  if (!origin || !consent.success || !identity || !eventId || eventId.length > 200) return {};
  return { first_contact_form_origin: origin, first_contact_submission_id: eventId, first_contact_consent_at: consent.data.at, first_contact_consent_version: consent.data.version, first_contact_first_name: identity.first, first_contact_phone: identity.phone };
}

export const firstContactClaimSchema = z.object({ id: z.string().uuid(), step: z.number().int().min(1).max(4), body: z.string().min(1).max(1000), phone: z.string().regex(/^[1-9]\d{9,14}$/), instance: z.string().min(1).max(160), senderPhone: z.string().min(10).max(15) });
export type FirstContactClaim = z.infer<typeof firstContactClaimSchema>;
export type FirstContactOutcome = { state: "accepted" | "failed" | "unknown"; provider: string | null; at: string | null; error: string | null };
export async function executeFirstContactStep(claim: FirstContactClaim, dependencies: {
  authorize: () => Promise<boolean>;
  send: () => Promise<Response>;
  receipt: (response: Response) => Promise<{ id: string; at: string } | null>;
  persist: (outcome: FirstContactOutcome) => Promise<void>;
}) {
  if (!await dependencies.authorize()) { await dependencies.persist({ state: "failed", provider: null, at: null, error: "authorization_changed" }); return; }
  let outcome: FirstContactOutcome;
  try {
    const response = await dependencies.send();
    if (!response.ok) outcome = { state: "failed", provider: null, at: null, error: `evolution_http_${response.status}` };
    else {
      const receipt = await dependencies.receipt(response);
      outcome = receipt ? { state: "accepted", provider: receipt.id, at: receipt.at, error: null } : { state: "unknown", provider: null, at: null, error: "invalid_receipt" };
    }
  } catch { outcome = { state: "unknown", provider: null, at: null, error: "transport_or_receipt_unknown" }; }
  // Persistence failures must not be mistaken for send failures or invoke send again.
  await dependencies.persist(outcome);
}