import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const unlockCrm = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ password: z.string().max(200) }).parse(input))
  .handler(async ({ data }) => {
    const full = process.env.CRM_FULL_ACCESS_PASSWORD;
    const limited = process.env.CRM_LIMITED_ACCESS_PASSWORD;
    const secret = process.env.CRM_SESSION_SECRET;
    if (!full || !limited || !secret) return { level: null, error: "Acesso indisponível. Tente novamente mais tarde." };
    const password = data.password.trim();
    const level = password === full ? "full" : password === limited ? "limited" : null;
    if (!level) return { level: null, error: "Senha incorreta" };
    const { createCrmSession } = await import("./crm-session.server");
    const previewToken = await createCrmSession(level, secret);
    return { level, error: null, previewToken };
  });

export const logoutCrm = createServerFn({ method: "POST" }).handler(async () => {
  const { deleteCrmSession } = await import("./crm-session.server");
  deleteCrmSession();
});