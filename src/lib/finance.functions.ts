import { createServerFn } from "@tanstack/react-start";
import type { FinanceResponse } from "./finance.server";

export const getFinance = createServerFn({ method: "POST" }).handler(
  async (): Promise<FinanceResponse> => {
    const secret = process.env.CRM_SESSION_SECRET;
    const { hasFullCrmSession } = await import("./crm-session.server");
    if (!secret || !(await hasFullCrmSession(secret)))
      return { months: [], traffic: [], updatedAt: null, error: null, needsAuth: true };
    const { readFinance } = await import("./finance.server");
    return readFinance();
  },
);
