import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { instagramSearchInput, normalizeHashtags } from "./b2b-instagram";

const hashtagsInput = z.object({ hashtags: z.string().trim().min(2).max(300) }).strict();

/** Normaliza as hashtags digitadas antes da confirmação (sem custo). */
export const parseInstagramHashtags = createServerFn({ method: "POST" })
  .inputValidator((v) => hashtagsInput.parse(v))
  .handler(async ({ data }) => {
    const { requireB2bAccess } = await import("./b2b-prospecting.server");
    await requireB2bAccess();
    return { hashtags: normalizeHashtags(data.hashtags) };
  });

export const getInstagramStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { instagramStatus } = await import("./b2b-instagram.server");
  return instagramStatus();
});

export const listInstagramSearches = createServerFn({ method: "GET" }).handler(async () => {
  const { listSearches } = await import("./b2b-instagram.server");
  return listSearches();
});

export const startInstagramSearch = createServerFn({ method: "POST" })
  .inputValidator((v) => instagramSearchInput.parse(v))
  .handler(async ({ data }) => {
    const { startSearch } = await import("./b2b-instagram.server");
    return startSearch(data);
  });

export const syncInstagramSearch = createServerFn({ method: "POST" })
  .inputValidator((v) => z.object({ searchId: z.string().uuid() }).strict().parse(v))
  .handler(async ({ data }) => {
    const { syncSearch } = await import("./b2b-instagram.server");
    return syncSearch(data.searchId);
  });

export const cancelInstagramSearch = createServerFn({ method: "POST" })
  .inputValidator((v) => z.object({ searchId: z.string().uuid() }).strict().parse(v))
  .handler(async ({ data }) => {
    const { cancelSearch } = await import("./b2b-instagram.server");
    return cancelSearch(data.searchId);
  });

export const listInstagramResults = createServerFn({ method: "POST" })
  .inputValidator((v) => z.object({ searchId: z.string().uuid() }).strict().parse(v))
  .handler(async ({ data }) => {
    const { listResults } = await import("./b2b-instagram.server");
    return listResults(data.searchId);
  });

export const refreshInstagramContacts = createServerFn({ method: "POST" })
  .inputValidator((v) => z.object({ searchId: z.string().uuid() }).strict().parse(v))
  .handler(async ({ data }) => {
    const { reprocessInstagramContacts } = await import("./b2b-instagram-public.server");
    return reprocessInstagramContacts(data.searchId);
  });
