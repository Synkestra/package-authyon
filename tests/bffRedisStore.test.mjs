import assert from "node:assert/strict";
import test from "node:test";
import { createRedisBffSessionStore } from "../packages/server/dist/bff.js";

// Models Redis CAS/TTL semantics for adapter tests; does not execute the Lua script.
function redisDouble() {
  const data = new Map();
  return {
    data,
    async get(key) {
      const entry = data.get(key);
      return entry && entry.expiresAt > Date.now() ? entry.value : null;
    },
    async eval(_script, { keys, arguments: args }) {
      const previous = data.get(keys[0]);
      const current =
        previous && previous.expiresAt > Date.now() ? JSON.parse(previous.value) : null;
      if ((current?.revision ?? "") !== args[0]) return 0;
      if (args[1]) data.set(keys[0], { value: args[1], expiresAt: Date.now() + Number(args[2]) });
      else data.delete(keys[0]);
      return 1;
    },
  };
}

function record(revision = "one") {
  return {
    revision,
    tokens: {
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
      expiresAt: Date.now() + 60_000,
    },
    user: { id: "alice", email: "alice@example.com", organization: null },
    expiresAt: Date.now() + 120_000,
    idleExpiresAt: Date.now() + 60_000,
    busyUntil: null,
  };
}

test("Redis stores encrypted token material and supports fenced updates", async () => {
  const client = redisDouble();
  const store = createRedisBffSessionStore({ client, encryptionKey: new Uint8Array(32).fill(7) });
  const first = record();
  assert.equal(await store.compareAndSwap("session", null, first), true);
  assert.doesNotMatch(
    client.data.get("authyon:bff:session").value,
    /access-secret|refresh-secret|alice/,
  );
  assert.deepEqual(await store.read("session"), first);
  assert.equal(await store.compareAndSwap("session", "stale", record("two")), false);
  assert.equal(await store.compareAndSwap("session", "one", record("two")), true);
  assert.equal(await store.compareAndSwap("session", "one", null), false);
  assert.equal(await store.compareAndSwap("session", "two", null), true);
});

test("Redis encryption binds a record to its session key", async () => {
  const client = redisDouble();
  const store = createRedisBffSessionStore({ client, encryptionKey: new Uint8Array(32).fill(7) });
  await store.compareAndSwap("alice", null, record());
  client.data.set("authyon:bff:bob", client.data.get("authyon:bff:alice"));
  await assert.rejects(store.read("bob"), { code: "session.storage_invalid" });
});

test("Redis envelope tampering and wrong encryption keys fail closed", async () => {
  const client = redisDouble();
  const store = createRedisBffSessionStore({ client, encryptionKey: new Uint8Array(32).fill(7) });
  await store.compareAndSwap("session", null, record());
  const wrongKey = createRedisBffSessionStore({
    client,
    encryptionKey: new Uint8Array(32).fill(8),
  });
  await assert.rejects(wrongKey.read("session"), { code: "session.storage_invalid" });
  const entry = client.data.get("authyon:bff:session");
  const envelope = JSON.parse(entry.value);
  entry.value = JSON.stringify({ ...envelope, revision: "forged" });
  await assert.rejects(store.read("session"), { code: "session.storage_invalid" });
});

test("Redis session records expire at the earliest timeout", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const client = redisDouble();
  const store = createRedisBffSessionStore({ client, encryptionKey: new Uint8Array(32).fill(7) });
  await store.compareAndSwap("session", null, { ...record(), idleExpiresAt: now + 500 });
  now += 501;
  assert.equal(await store.read("session"), null);
});
