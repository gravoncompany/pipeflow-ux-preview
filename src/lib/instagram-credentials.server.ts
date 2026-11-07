import { decryptInstagramToken } from "./instagram-oauth-crypto.server";

export async function instagramAccountToken(account: {
  id: string;
  company_key: string;
  instagram_id: string;
  token_secret_name: string;
}) {
  if (!account.token_secret_name.startsWith("oauth:"))
    return process.env[account.token_secret_name];
  const secret = process.env["INSTAGRAM_OAUTH_ENCRYPTION_KEY"];
  if (!secret) throw new Error("instagram_credentials_missing");
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const { data, error } = await db
    .from("instagram_oauth_credentials")
    .select("encrypted_token,expires_at")
    .eq("account_id", account.id)
    .eq("company_key", account.company_key)
    .maybeSingle();
  if (error || !data || Date.parse(data.expires_at) <= Date.now())
    throw new Error("instagram_credentials_missing");
  return decryptInstagramToken(
    data.encrypted_token,
    secret,
    `${account.company_key}:${account.instagram_id}`,
  );
}
