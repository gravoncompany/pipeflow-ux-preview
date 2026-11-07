import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const getHypercashOverview = createServerFn({ method: "GET" }).handler(async () => {
  const { hypercashOverview } = await import("./hypercash.server");
  return hypercashOverview();
});

export const saveHypercashFn = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({ apiKey: z.string().min(10).max(500) }).parse(i))
  .handler(async ({ data }) => {
    const { saveHypercash } = await import("./hypercash.server");
    return saveHypercash(data);
  });

export const testHypercashFn = createServerFn({ method: "POST" }).handler(async () => {
  const { testHypercash } = await import("./hypercash.server");
  return testHypercash();
});

export const setHypercashActiveFn = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({ active: z.boolean(), revision: z.number().int().min(1) }).parse(i))
  .handler(async ({ data }) => {
    const { setHypercashActive } = await import("./hypercash.server");
    return setHypercashActive(data.active, data.revision);
  });

export const syncHypercashFn = createServerFn({ method: "POST" }).handler(async () => {
  const { syncHypercash } = await import("./hypercash.server");
  return syncHypercash();
});

export const linkHypercashClientFn = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({ chargeId: z.string().uuid(), clientId: z.string().uuid() }).parse(i))
  .handler(async ({ data }) => {
    const { linkHypercashClient } = await import("./hypercash.server");
    return linkHypercashClient(data);
  });

export const confirmHypercashPaymentFn = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({ chargeId: z.string().uuid(), confirmed: z.literal(true), accountId:z.string().uuid(), targetChargeId:z.string().uuid().optional(), targetPaymentId:z.string().uuid().optional() }).parse(i))
  .handler(async ({ data }) => {
    const { confirmHypercashPayment } = await import("./hypercash.server");
    return confirmHypercashPayment(data);
  });

export const getClientHypercashHistory = createServerFn({ method: "GET" })
  .inputValidator((i) => z.object({ clientId: z.string().uuid() }).parse(i))
  .handler(async ({ data }) => {
    const { clientHypercashHistory } = await import("./hypercash.server");
    return clientHypercashHistory(data.clientId);
  });

export const saveHypercashTransactionsFn=createServerFn({method:'POST'}).inputValidator((i)=>z.object({apiKey:z.string().min(10).max(500)}).parse(i)).handler(async({data})=>(await import('./hypercash.server')).saveHypercashTransactions(data));
export const testHypercashTransactionsFn=createServerFn({method:'POST'}).handler(async()=>(await import('./hypercash.server')).testHypercashTransactions());
export const setHypercashAutoSyncFn=createServerFn({method:'POST'}).inputValidator((i)=>z.object({active:z.boolean(),revision:z.number().int().min(1)}).parse(i)).handler(async({data})=>(await import('./hypercash.server')).setHypercashAutoSync(data.active,data.revision));
export const linkHypercashPayoutFn=createServerFn({method:'POST'}).inputValidator((i)=>z.object({bankId:z.string().min(1).max(150),chargeIds:z.array(z.string().uuid()).min(1).max(100),feeCents:z.number().int().min(0),confirmed:z.literal(true)}).parse(i)).handler(async({data})=>(await import('./hypercash.server')).linkHypercashPayout(data));
export const inspectHypercashReadOnlyFn=createServerFn({method:'POST'}).handler(async()=>(await import('./hypercash.server')).inspectHypercashReadOnly());
