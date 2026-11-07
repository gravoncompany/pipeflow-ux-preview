/** Proposed individual-account rules. Not wired to the legacy gate.
 * Backend identity and RLS must enforce the same rules before rollout.
 */
export type CrmRole = "admin" | "team";
export type CrmPrincipal = { role: CrmRole; active: boolean } | null;

export const TEAM_STAGE_IDS = [
  "tentando-contato",
  "contato-realizado",
  "primeira-ligacao",
  "segunda-ligacao",
  "terceira-ligacao",
] as const;

export function canAdminister(principal: CrmPrincipal): boolean {
  return principal?.active === true && principal.role === "admin";
}

export function canAccessLead(principal: CrmPrincipal, stage: string): boolean {
  if (!principal?.active) return false;
  return principal.role === "admin" || TEAM_STAGE_IDS.some(id => id === stage);
}

export function canMoveLead(principal: CrmPrincipal, from: string, to: string): boolean {
  return canAccessLead(principal, from) && canAccessLead(principal, to);
}

export function canDeleteLead(principal: CrmPrincipal): boolean {
  return canAdminister(principal);
}