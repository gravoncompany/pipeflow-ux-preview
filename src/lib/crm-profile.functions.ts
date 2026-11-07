import { createServerFn } from "@tanstack/react-start";
import { profileInput, type CrmProfile } from "./crm-profile";

type Db = { from(t: string): { select(c: string): { eq(c: string, v: string): { maybeSingle(): PromiseLike<{ data: unknown; error: unknown }> } };
  insert(v: Record<string, unknown>): { select(c: string): { single(): PromiseLike<{ data: unknown; error: unknown }> } };
  update(v: Record<string, unknown>): { eq(c: string, v: unknown): { eq(c: string, v: unknown): { select(c: string): { maybeSingle(): PromiseLike<{ data: unknown; error: unknown }> } } } } } };
const COLS = "display_name,email,photo,revision";
type Row = { display_name: string; email: string; photo: string | null; revision: number };
const toProfile = (r: Row | null): CrmProfile => ({ available: true, displayName: r?.display_name ?? "", email: r?.email ?? "", photo: r?.photo ?? null, revision: r?.revision ?? 0 });
async function access(): Promise<Db> {
  const secret = process.env.CRM_SESSION_SECRET;
  const { hasFullCrmSession } = await import("./crm-session.server");
  if (!secret || !(await hasFullCrmSession(secret))) throw new Error("Entre com acesso completo.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as Db;
}
export const getCrmProfile = createServerFn({ method: "POST" }).handler(async (): Promise<CrmProfile> => {
  const db = await access();
  const { data, error } = await db.from("crm_profile").select(COLS).eq("company_key", "crm:1").maybeSingle();
  if (error) return { available: false, displayName: "", email: "", photo: null, revision: 0 };
  return toProfile(data as Row | null);
});
// Gravação com controle de revisão: duas abas abertas não sobrescrevem a foto uma da outra sem aviso.
export const saveCrmProfile = createServerFn({ method: "POST" })
  .inputValidator((v: unknown) => profileInput.parse(v))
  .handler(async ({ data }): Promise<{ ok: true; profile: CrmProfile } | { ok: false; error: string }> => {
    const db = await access();
    const values = { display_name: data.displayName, email: data.email, photo: data.photo, updated_at: new Date().toISOString() };
    if (data.revision === 0) {
      const { data: row, error } = await db.from("crm_profile").insert({ company_key: "crm:1", ...values, revision: 1 }).select(COLS).single();
      if (error || !row) return { ok: false, error: (error as { code?: string } | null)?.code === "23505" ? "O perfil foi alterado em outra aba. Atualize a página." : "Não foi possível salvar o perfil (migração 0082 pendente?)." };
      return { ok: true, profile: toProfile(row as Row) };
    }
    const { data: row, error } = await db.from("crm_profile").update({ ...values, revision: data.revision + 1 }).eq("company_key", "crm:1").eq("revision", data.revision).select(COLS).maybeSingle();
    if (error || !row) return { ok: false, error: "O perfil foi alterado em outra aba. Atualize a página e tente de novo." };
    return { ok: true, profile: toProfile(row as Row) };
  });
