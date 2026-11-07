import { z } from "zod";
import { hasFullCrmSession } from "./crm-session.server";
import { internalKnowledgeActor } from "./commercial-knowledge.server";
import { instagramApi, InstagramApiError, readBounded } from "./instagram-api.server";
import { instagramAccountToken } from "./instagram-credentials.server";
import { INSTAGRAM_OAUTH_CALLBACK } from "./instagram-oauth";
import { instagramId, instagramWebhook, payloadShape, eventFromGraphMessage, classifyInstagramEvent, verifyInstagramSignature, verificationChallenge, type InstagramEvent } from "./instagram";

const CALLBACK = "https://crm.gravoncompany.com/api/public/instagram/webhook";
export async function instagramAdministrator() {
  const secret = process.env["CRM_SESSION_SECRET"];
  if (!secret || !await hasFullCrmSession(secret)) throw new Error("instagram_full_access_required");
  const actor = await internalKnowledgeActor("instagram:settings", "menu");
  if (!actor) throw new Error("instagram_admin_required");
  await actor.authorize(); return actor;
}
const administrator = instagramAdministrator;
export function safeInstagramError(error: unknown) {
  return error instanceof InstagramApiError ? error.message : error instanceof Error && error.message.startsWith("instagram_") ? error.message : "instagram_connection_failed";
}
export async function instagramOverview() {
  const secret = process.env["CRM_SESSION_SECRET"];
  if (!secret || !await hasFullCrmSession(secret)) return { needsAuth: true as const };
  const actor = await administrator();
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const { data: accounts, error } = await db.from("instagram_accounts").select("id,instagram_id,username,greeting_enabled,greeting,enabled,subscribed_at,checked_at,last_event_at,error_code").eq("company_key", actor.company).limit(20);
  if (error) throw new Error("instagram_storage_failed");
  const { data: contacts, error: contactError } = await db.from("instagram_contacts").select("id,account_id,sender_id,origin,created_at,last_inbound_at,greeting_state").eq("company_key", actor.company).order("last_inbound_at", { ascending: false }).limit(100);
  if (contactError) throw new Error("instagram_storage_failed");
  const { count: contactCount, error: countError } = await db.from("instagram_contacts").select("id", { count: "exact", head: true }).eq("company_key", actor.company);
  const { count: messageCount, error: messageCountError } = await db.from("instagram_messages").select("id", { count: "exact", head: true }).eq("company_key", actor.company);
  const { data: latest, error: latestError } = await db.from("instagram_messages").select("received_at").eq("company_key", actor.company).order("received_at", { ascending: false }).limit(1);
  if (countError || messageCountError || latestError) throw new Error("instagram_storage_failed");
  await actor.authorize();
  const { data: oauthAttempts, error: oauthError } = await db.from("instagram_oauth_flows").select("created_at,status,callback_received_at,diagnostic_stage,diagnostic_code,diagnostic_http_status").eq("author_id", actor.userId).eq("company_key", actor.company).order("created_at", { ascending: false }).limit(1);
  if (oauthError) throw new Error("instagram_storage_failed");
  await actor.authorize();
  return { needsAuth: false as const, company: actor.company, callback: CALLBACK, oauthCallback: INSTAGRAM_OAUTH_CALLBACK, oauthLatest: oauthAttempts?.[0] ?? null, oauthReady: Boolean((process.env["INSTAGRAM_OAUTH_APP_SECRET"] || process.env["INSTAGRAM_APP_SECRET"]) && process.env["INSTAGRAM_OAUTH_ENCRYPTION_KEY"]), credentialsSet: Boolean(process.env["INSTAGRAM_ACCESS_TOKEN"] && process.env["INSTAGRAM_APP_SECRET"]), verificationSet: Boolean(process.env["INSTAGRAM_VERIFY_TOKEN"]), accounts: accounts ?? [], contacts: contacts ?? [], storage: { contacts: contactCount, messages: messageCount, latestReceivedAt: latest?.[0]?.received_at ?? null } };
}
export async function connectInstagram() {
  const actor = await administrator();
  const token = process.env["INSTAGRAM_ACCESS_TOKEN"]; const appSecret = process.env["INSTAGRAM_APP_SECRET"];
  if (!token || !appSecret) throw new Error("instagram_credentials_missing");
  const identity = z.object({ user_id: instagramId, username: z.string().min(1).max(100) }).parse(await instagramApi("me?fields=user_id,username", token));
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  await actor.authorize();
  const { error: writeError } = await db.rpc("bind_instagram_account", { p_author: actor.userId, p_company: actor.company, p_instagram: identity.user_id, p_username: identity.username });
  if (writeError) throw new Error("instagram_account_already_bound");
  return { username: identity.username, instagramId: identity.user_id };
}
async function ownedAccount(id: string) {
  const actor = await administrator();
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const { data, error } = await db.from("instagram_accounts").select("*").eq("id", id).eq("company_key", actor.company).single();
  if (error || !data) throw new Error("instagram_account_unavailable");
  return { actor, db, account: data };
}
export async function configureInstagram(id: string, settings: { greetingEnabled: boolean; greeting: string }) {
  const { actor, db } = await ownedAccount(id);
  await actor.authorize();
  const { error } = await db.from("instagram_accounts").update({ greeting_enabled: settings.greetingEnabled, greeting: settings.greeting, updated_by: actor.userId, updated_at: new Date().toISOString() }).eq("id", id).eq("company_key", actor.company);
  if (error) throw new Error("instagram_storage_failed"); return { saved: true };
}
export async function subscribeInstagram(id: string) {
  const { actor, db, account } = await ownedAccount(id);
  if (!process.env["INSTAGRAM_VERIFY_TOKEN"]) throw new Error("instagram_verification_missing");
  const token = await instagramAccountToken(account); if (!token) throw new Error("instagram_credentials_missing");
  try {
    const identity = z.object({ user_id: instagramId }).parse(await instagramApi("me?fields=user_id", token));
    if (identity.user_id !== account.instagram_id) throw new Error("instagram_account_mismatch");
    await actor.authorize();
    const result = z.object({ success: z.literal(true) }).parse(await instagramApi(`${account.instagram_id}/subscribed_apps`, token, "POST", { subscribed_fields: ["messages"] }));
    const { error } = await db.from("instagram_accounts").update({ subscribed_at: new Date().toISOString(), error_code: null }).eq("id", id).eq("company_key", actor.company);
    if (error) throw new Error("instagram_storage_failed"); return result;
  } catch (error) {
    await db.from("instagram_accounts").update({ error_code: safeInstagramError(error) }).eq("id", id).eq("company_key", actor.company);
    throw new Error(safeInstagramError(error));
  }
}
export async function instagramConversation(contactId: string) {
  const actor = await administrator();
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const { data: contact, error } = await db.from("instagram_contacts").select("id,account_id,sender_id").eq("id", contactId).eq("company_key", actor.company).single();
  if (error || !contact) throw new Error("instagram_contact_unavailable");
  const { data: messages, error: readError } = await db.from("instagram_messages").select("id,message_id,body,kind,from_me,sent_at,send_state").eq("contact_id", contact.id).eq("account_id", contact.account_id).eq("company_key", actor.company).order("sent_at", { ascending: false }).limit(100);
  if (readError) throw new Error("instagram_storage_failed"); await actor.authorize();
  return { contact, messages: (messages ?? []).reverse() };
}
export async function instagramWebhookGet(request: Request) {
  const token = process.env["INSTAGRAM_VERIFY_TOKEN"];
  if (!token) return new Response("Verification not configured", { status: 503 });
  const challenge = verificationChallenge(new URL(request.url), token);
  return new Response(challenge ?? "Forbidden", { status: challenge ? 200 : 403, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
}
export async function instagramWebhookPost(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const response = await processInstagramWebhook(request, requestId);
    console.info("instagram_webhook_result", { requestId, status: response.status });
    return response;
  } catch {
    console.error("instagram_webhook_result", { requestId, status: 503, code: "processing_failed" });
    return new Response("Processing unavailable", { status: 503 });
  }
}
async function processInstagramWebhook(request: Request, requestId: string) {
  const appSecret = process.env["INSTAGRAM_APP_SECRET"];
  if (!appSecret) { console.error("instagram_webhook_event", { requestId, code: "app_secret_missing" }); return new Response("Not configured", { status: 503 }); }
  let bytes: Uint8Array;
  try { bytes = await readBounded(new Response(request.body), 1048576); } catch { return new Response("Too large", { status: 413 }); }
  if (!await verifyInstagramSignature(bytes, request.headers.get("x-hub-signature-256"), appSecret)) { console.info("instagram_webhook_event", { requestId, code: "signature_rejected" }); return new Response("Invalid signature", { status: 401 }); }
  let decoded: unknown;
  try { decoded = JSON.parse(new TextDecoder().decode(bytes)); } catch { console.info("instagram_webhook_event", { requestId, code: "invalid_json" }); return new Response("Invalid event", { status: 400 }); }
  const parsed = instagramWebhook.safeParse(decoded);
  if (!parsed.success) {
    // Signed by Meta but not an Instagram envelope: describe key names/types only (never values)
    // and acknowledge, so Meta does not retry an event we can never process.
    console.info("instagram_webhook_event", { requestId, code: "unrecognized_envelope", shape: JSON.stringify(payloadShape(decoded)).slice(0, 1500) });
    return new Response("EVENT_RECEIVED");
  }
  const payload = parsed.data;
  if (payload.rejected.length) console.info("instagram_webhook_event", { requestId, code: "entry_skipped", shape: JSON.stringify(payload.rejected.slice(0, 3)).slice(0, 1500) });
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  for (const entry of payload.entry) {
    const { data: account, error } = await db.from("instagram_accounts").select("*").eq("instagram_id", entry.id).eq("enabled", true).maybeSingle();
    if (error) { console.error("instagram_webhook_event", { requestId, code: "account_lookup_failed" }); return new Response("Storage unavailable", { status: 503 }); }
    if (!account || account.app_secret_name !== "INSTAGRAM_APP_SECRET") {
      console.info("instagram_webhook_event", { requestId, code: "account_unavailable" });
      continue;
    }
    if (!entry.candidates.length) { console.info("instagram_webhook_event", { requestId, code: "no_messaging_events" }); continue; }
    for (const candidate of entry.candidates) {
      let event: InstagramEvent;
      if ("skip" in candidate) { console.info("instagram_webhook_event", { requestId, code: "item_skipped", reason: candidate.skip }); continue; }
      if ("lookup" in candidate) {
        // Incomplete notification: read the authoritative message from Meta with the account's own token.
        const token = await instagramAccountToken(account);
        if (!token) { console.error("instagram_webhook_event", { requestId, code: "lookup_credentials_missing" }); continue; }
        try {
          const found = eventFromGraphMessage(candidate.lookup, await instagramApi(`${encodeURIComponent(candidate.lookup)}?fields=id,created_time,from,to,message,attachments,is_unsupported`, token));
          if (!found) { console.info("instagram_webhook_event", { requestId, code: "lookup_unrecognized" }); continue; }
          event = found;
        } catch (lookupError) {
          console.info("instagram_webhook_event", { requestId, code: "lookup_failed", reason: safeInstagramError(lookupError) });
          if (lookupError instanceof InstagramApiError && lookupError.status >= 400 && lookupError.status < 500) continue;
          return new Response("Lookup unavailable", { status: 503 });
        }
      } else event = candidate.event;
      if (event.message?.is_self === true) { console.info("instagram_webhook_event", { requestId, code: "meta_self_test_ignored" }); continue; }
      const now = new Date(); const classified = classifyInstagramEvent(account.instagram_id, event, now.getTime());
      if (!classified) { console.info("instagram_webhook_event", { requestId, code: "not_eligible_message", direction: event.sender.id === account.instagram_id ? "from_account" : event.recipient.id === account.instagram_id ? "to_account" : "other_ids" }); continue; }
      const { data: result, error: writeError } = await db.rpc("ingest_instagram_message", { p_account: account.id, p_sender: classified.sender, p_mid: classified.mid, p_body: classified.body ?? "", p_kind: classified.kind, p_sent: classified.sentAt, p_inbound: classified.inbound, p_now: now.toISOString() });
      if (writeError) { console.error("instagram_webhook_event", { requestId, code: "storage_failed" }); return new Response("Storage unavailable", { status: 503 }); }
      const outcome = z.object({ duplicate: z.boolean().optional(), ignored: z.boolean().optional(), contact_id: z.string().uuid().optional() }).safeParse(result);
      console.info("instagram_webhook_event", { requestId, code: outcome.success && outcome.data.duplicate ? "duplicate" : outcome.success && outcome.data.ignored ? "ignored" : outcome.success && outcome.data.contact_id ? "persisted" : "unexpected_storage_result" });
      const claim = z.object({ greet: z.literal(true), contact_id: z.string().uuid(), text: z.string().min(1).max(1000), sender: instagramId }).safeParse(result);
      if (!claim.success) continue;
      let state: "accepted" | "unknown" | "failed" = "unknown"; let mid = "";
      try {
        // Re-read after the durable first-contact claim; no retry after any uncertain send.
        const { data: current, error: currentError } = await db.from("instagram_accounts").select("id,company_key,enabled,token_secret_name,instagram_id").eq("id", account.id).eq("company_key", account.company_key).single();
        const token = current ? await instagramAccountToken(current) : undefined;
        if (currentError || !current?.enabled || !token) { state = "failed"; throw new Error("instagram_credentials_missing"); }
        const identity = z.object({ user_id: instagramId }).parse(await instagramApi("me?fields=user_id", token));
        if (identity.user_id !== current.instagram_id) { state = "failed"; throw new Error("instagram_account_mismatch"); }
        const response = z.object({ recipient_id: instagramId, message_id: z.string().min(1).max(512) }).parse(await instagramApi(`${current.instagram_id}/messages`, token, "POST", { recipient: { id: claim.data.sender }, message: { text: claim.data.text } }));
        if (response.recipient_id !== claim.data.sender) throw new Error("instagram_receipt_mismatch");
        mid = response.message_id; state = "accepted";
      } catch (error) {
        await db.from("instagram_accounts").update({ error_code: safeInstagramError(error) }).eq("id", account.id).eq("company_key", account.company_key);
      }
      const { error: finishError } = await db.rpc("finish_instagram_greeting", { p_account: account.id, p_contact: claim.data.contact_id, p_state: state, p_mid: mid, p_now: new Date().toISOString() });
      if (finishError) { console.error("instagram_webhook_event", { requestId, code: "greeting_persistence_failed" }); return new Response("Storage unavailable", { status: 503 }); }
    }
  }
  return new Response("EVENT_RECEIVED");
}