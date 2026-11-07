// Build-time only: never import this module from application routes.
export function resolvePublicCloudDefines(
  env: Record<string, string | undefined>,
  connectedBinding: Record<string, string | undefined>,
) {
  // Remote compilation may have no .env or runtime bindings. Use the verified
  // public pair only in that case; never mask invalid or partial configuration.
  const configured = ["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"].some((name) => Boolean(env[name]));
  return publicCloudDefines(configured ? env : connectedBinding);
}

export function publicCloudDefines(env: Record<string, string | undefined>) {
  const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("CRM build blocked: public Cloud connection configuration is missing.");
  }
  let parsed: URL;
  try { parsed = new URL(url); } catch {
    throw new Error("CRM build blocked: invalid public Cloud address.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password ||
      parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
    throw new Error("CRM build blocked: Cloud address must be public HTTPS.");
  }
  // Only public keys may enter the browser; even misconfigured variables fail closed.
  let publicKey = key.startsWith("sb_publishable_");
  if (!publicKey && key.split(".").length === 3) {
    try {
      const payload = key.split(".")[1];
      publicKey = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).role === "anon";
    } catch { publicKey = false; }
  }
  if (!publicKey) throw new Error("CRM build blocked: only a publishable Cloud key is allowed.");
  return {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(url),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(key),
  };
}