import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// ~2 MB em base64 ocupa até ~2,8 milhões de caracteres.
export const uploadEmailImage = createServerFn({ method: "POST" })
  .inputValidator((v) => z.object({ data: z.string().min(16).max(2_800_000).regex(/^[A-Za-z0-9+/]+=*$/) }).strict().parse(v))
  .handler(async ({ data }) => {
    const { campaignDb } = await import("./campaigns.server");
    await campaignDb(); // exige o acesso completo ao CRM, como o restante das Campanhas
    const { storeEmailImage } = await import("./email-images.server");
    return storeEmailImage(data.data);
  });
