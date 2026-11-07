import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Internal Pipeflow tags for WhatsApp groups, keyed by instance + original g.us id. Independent of WhatsApp Business and CRM contact tags.
const jid = z.string().regex(/^[0-9]{5,40}(-[0-9]+)?@g\.us$/);
const instance = z.string().min(1).max(200);
async function db() { const { campaignDb } = await import("./campaigns.server"); return campaignDb(); }

export const listGroupTags = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({ instance }).strict().parse(i))
  .handler(async ({ data }) => {
    const d = await db();
    const [tags, links] = await Promise.all([
      d.from("crm_whatsapp_group_tags").select("id,name").order("name").limit(500),
      d.from("crm_whatsapp_group_tag_links").select("group_jid,tag_id").eq("instance", data.instance).limit(50000),
    ]);
    if (tags.error || links.error) throw new Error("Não foi possível ler as etiquetas dos grupos.");
    const byGroup: Record<string, string[]> = {};
    for (const l of links.data ?? []) (byGroup[l.group_jid] ??= []).push(l.tag_id);
    return { tags: (tags.data ?? []) as { id: string; name: string }[], byGroup };
  });

export const saveGroupTag = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({ id: z.string().uuid().nullable(), name: z.string().trim().min(1).max(60) }).strict().parse(i))
  .handler(async ({ data }) => {
    const d = await db();
    const r = data.id
      ? await d.from("crm_whatsapp_group_tags").update({ name: data.name }).eq("id", data.id).select("id").maybeSingle()
      : await d.from("crm_whatsapp_group_tags").insert({ name: data.name }).select("id").single();
    if (r.error) throw new Error(r.error.code === "23505" ? "Já existe uma etiqueta com esse nome." : "Não foi possível salvar a etiqueta.");
    return { id: r.data?.id as string };
  });

export const deleteGroupTag = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({ id: z.string().uuid() }).strict().parse(i))
  .handler(async ({ data }) => {
    const d = await db();
    const r = await d.from("crm_whatsapp_group_tags").delete().eq("id", data.id);
    if (r.error) throw new Error("Não foi possível excluir a etiqueta.");
    return { ok: true };
  });

/** Adds or removes tags on many groups at once (idempotent). */
export const applyGroupTags = createServerFn({ method: "POST" })
  .inputValidator(i => z.object({ instance, jids: z.array(jid).min(1).max(5000), tagIds: z.array(z.string().uuid()).min(1).max(50), mode: z.enum(["add", "remove"]) }).strict().parse(i))
  .handler(async ({ data }) => {
    const d = await db();
    if (data.mode === "add") {
      const rows = data.jids.flatMap(g => data.tagIds.map(t => ({ instance: data.instance, group_jid: g, tag_id: t })));
      for (let i = 0; i < rows.length; i += 1000) {
        const r = await d.from("crm_whatsapp_group_tag_links").upsert(rows.slice(i, i + 1000), { onConflict: "instance,group_jid,tag_id", ignoreDuplicates: true });
        if (r.error) throw new Error("Não foi possível aplicar as etiquetas.");
      }
    } else {
      for (let i = 0; i < data.jids.length; i += 500) {
        const r = await d.from("crm_whatsapp_group_tag_links").delete().eq("instance", data.instance).in("group_jid", data.jids.slice(i, i + 500)).in("tag_id", data.tagIds);
        if (r.error) throw new Error("Não foi possível remover as etiquetas.");
      }
    }
    return { ok: true };
  });
