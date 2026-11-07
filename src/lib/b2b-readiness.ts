export const B2B_TABLES = [
  "b2b_requests",
  "b2b_companies",
  "b2b_email_drafts",
  "b2b_email_suppressions",
] as const;

export type B2bTableStatus =
  "not_checked" | "ready" | "missing_schema" | "permission_denied" | "unavailable";

export type B2bTableCheck = {
  table: (typeof B2B_TABLES)[number];
  status: B2bTableStatus;
};

// Only bounded statuses cross the server boundary, never database error prose.
export function b2bTableStatus(error: { code?: string } | null): B2bTableStatus {
  if (!error) return "ready";
  if (["42P01", "42703", "PGRST204", "PGRST205"].includes(error.code ?? ""))
    return "missing_schema";
  if (["42501", "PGRST301", "PGRST302", "PGRST303"].includes(error.code ?? ""))
    return "permission_denied";
  return "unavailable";
}

export function b2bUncheckedTables(
  status: "not_checked" | "unavailable" = "not_checked",
): B2bTableCheck[] {
  return B2B_TABLES.map((table) => ({ table, status }));
}

export const B2B_TABLE_STATUS_LABELS: Record<B2bTableStatus, string> = {
  not_checked: "Não verificada: módulo desativado",
  ready: "Leitura disponível",
  missing_schema: "Tabela/coluna ausente ou indisponível no catálogo da API",
  permission_denied: "Acesso do backend negado",
  unavailable: "Não foi possível verificar a conexão ou a leitura",
};
