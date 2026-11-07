import { createServerFn } from "@tanstack/react-start";

/** Verificação leve do portão do CRM para telas estáticas (ex.: índice de Configurações). Não lê dados privados. */
export const getCrmAccess = createServerFn({ method: "POST" }).handler(async () => {
  const secret = process.env.CRM_SESSION_SECRET;
  const { hasFullCrmSession } = await import("./crm-session.server");
  return { full: Boolean(secret) && (await hasFullCrmSession(secret!)) };
});
