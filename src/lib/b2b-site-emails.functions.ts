import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const placeInput = z.object({
  key: z.string().trim().min(1).max(350),
  name: z.string().trim().min(2).max(300),
  website: z.string().max(2000),
  cnpj: z.string().max(20).optional(),
}).strict();

/** Busca e-mails públicos nos sites das empresas do Maps (até 10 por chamada; nada é gravado no CRM). */
export const searchB2bSiteEmails = createServerFn({ method: "POST" })
  .inputValidator(v => z.object({ places: z.array(placeInput).min(1).max(10) }).strict().parse(v))
  .handler(async ({ data }) => {
    const { requireEnabled } = await import("./b2b-prospecting.server");
    await requireEnabled();
    const { searchPlacesEmails } = await import("./b2b-site-emails.server");
    return searchPlacesEmails(data.places);
  });
