import { z } from "zod";

export const PORTAL_NOTIFY_PATH = "/api/public/portal/whatsapp-notify";
/** Official Portal origin for approval links (public, not a secret). */
export const PORTAL_APPROVAL_ORIGIN = "https://portal.gravoncompany.com";
export const PORTAL_NOTIFY_MAX_BYTES = 8192;
const label = z.string().trim().min(1).max(160).refine((v) => !/[\r\n\u0000-\u001f]/.test(v));
export const portalNotificationSchema = z.object({
  project_id: z.string().uuid(),
  notification_id: z.string().uuid(),
  art_version_id: z.string().uuid(),
  client_name: label,
  client_phone: z.string().regex(/^[1-9]\d{9,14}$/),
  project_name: label,
  art_title: label,
  approval_url: z.string().url().max(2048),
  consent: z.object({
    granted: z.literal(true),
    purpose: z.literal("art_approval_whatsapp"),
    phone: z.string().regex(/^[1-9]\d{9,14}$/),
    recorded_at: z.string().datetime({ offset: true }),
    evidence_id: z.string().trim().min(1).max(160),
    policy_version: z.string().trim().min(1).max(80),
  }).strict(),
}).strict();
export type PortalNotification = z.infer<typeof portalNotificationSchema>;
export type NotifyState = "sending" | "accepted" | "delivered" | "failed" | "unknown";

/** Intentionally fixed copy; never model-generated. */
export function approvalNotificationText(input: PortalNotification) {
  return `Olá, ${input.client_name}!\n\nUma nova arte do projeto ${input.project_name} está aguardando sua aprovação.\n\nAcesse o link abaixo para visualizar a arte, conferir a legenda e aprovar ou solicitar alterações.\n\n${input.approval_url}\n\nGravon Company`;
}

export function validApprovalUrl(raw: string, origin: string): boolean {
  try {
    const url = new URL(raw);
    const trusted = new URL(origin);
    return trusted.protocol === "https:" && trusted.origin === origin &&
      url.protocol === "https:" && url.origin === origin && !url.username && !url.password &&
      !url.port && url.pathname !== "/" && !url.pathname.includes("//") && !/[\r\n\u0000-\u001f]/.test(raw) &&
      // Block open-redirect style parameters pointing anywhere else.
      ![...url.searchParams.values(), decodeURIComponent(url.hash)].some((v) => /^\s*(https?:|\/\/|\\)/i.test(v));
  } catch { return false; }
}