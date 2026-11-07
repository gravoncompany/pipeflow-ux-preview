import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createClient } from "@supabase/supabase-js";

test("persisted knowledge keeps exact prices, deduplicates events, rejects stale/foreign/unauthorized writes and preserves unrelated text", async () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert.ok(url && key, "Server-only integration test credentials required");
  const db = createClient(url, key, {
    auth: { persistSession: false },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`)
          headers.delete("Authorization");
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });
  const { data: channels, error } = await db
    .from("portal_admin_channels")
    .select("user_id,company_key")
    .limit(2);
  assert.equal(error, null);
  assert.equal(channels?.length, 1);
  const actor = channels?.[0];
  assert.ok(actor);
  const content =
    "Implantação do Gravon Portal com CRM: R$350 por conta. Para sete contas, total de R$2.450. Mensalidade ainda não definida.";
  const event = `integration:${crypto.randomUUID()}`;
  const base = {
    p_author: actor.user_id,
    p_company: actor.company_key,
    p_origin: "menu",
    p_event: event,
    p_operation: "create",
    p_id: "00000000-0000-0000-0000-000000000000",
    p_revision: 0,
    p_title: "Teste descartável de isolamento",
    p_text: content,
  };
  let id: string | null = null;
  try {
    const first = await db.rpc("write_commercial_knowledge", base);
    assert.equal(first.error, null);
    id = first.data.record.id;
    assert.equal(first.data.record.text, content);
    assert.equal(first.data.record.company_key, actor.company_key);
    const replay = await db.rpc("write_commercial_knowledge", base);
    assert.equal(replay.error, null);
    assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.record.id, id);
    const changedEvent = await db.rpc("write_commercial_knowledge", {
      ...base,
      p_text: "different",
    });
    assert.ok(changedEvent.error);
    const foreign = await db.rpc("write_commercial_knowledge", {
      ...base,
      p_company: "test:foreign-company",
      p_event: event + ":foreign",
    });
    assert.equal(foreign.error?.code, "42501");
    const unauthorized = await db.rpc("write_commercial_knowledge", {
      ...base,
      p_author: "00000000-0000-0000-0000-000000000001",
      p_event: event + ":unauthorized",
    });
    assert.equal(unauthorized.error?.code, "42501");
    const append = await db.rpc("write_commercial_knowledge", {
      ...base,
      p_event: event + ":append",
      p_operation: "append",
      p_id: id,
      p_text: "Condição adicional de teste.",
    });
    assert.equal(append.error, null);
    assert.ok(append.data.record.text.startsWith(content));
    assert.equal(append.data.record.revision, 1);
    const stale = await db.rpc("write_commercial_knowledge", {
      ...base,
      p_event: event + ":stale",
      p_operation: "append",
      p_id: id,
      p_text: "stale",
    });
    assert.ok(stale.error);
    const oversized = await db.rpc("write_commercial_knowledge", {
      ...base,
      p_event: event + ":oversized",
      p_operation: "append",
      p_id: id,
      p_revision: 1,
      p_text: "x".repeat(7900),
    });
    assert.ok(oversized.error);
    const crossRead = await db
      .from("ai_knowledge")
      .select("id")
      .eq("company_key", "test:foreign-company")
      .eq("id", id);
    assert.equal(crossRead.error, null);
    assert.deepEqual(crossRead.data, []);
    const check = await db.from("ai_knowledge").select("text,revision").eq("id", id).single();
    assert.equal(check.error, null);
    assert.equal(check.data?.revision, 1);
    assert.ok(check.data?.text.startsWith(content));
    const publicKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    assert.ok(publicKey);
    const publicClient = createClient(url, publicKey, { auth: { persistSession: false } });
    const publicWrite = await publicClient.rpc("write_commercial_knowledge", base);
    assert.equal(publicWrite.error?.code, "42501");
    const publicRead = await publicClient.from("ai_knowledge").select("id").eq("id", id);
    assert.ok(publicRead.error || publicRead.data?.length === 0);
  } finally {
    if (id) {
      const ops = await db.from("ai_knowledge_operations").delete().eq("knowledge_id", id);
      assert.equal(ops.error, null);
      const row = await db.from("ai_knowledge").delete().eq("id", id);
      assert.equal(row.error, null);
    }
  }
});
