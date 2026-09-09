import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import process from "node:process";
import test from "node:test";
import { createClient } from "redis";
import { createRedisBffSessionStore } from "../packages/server/dist/bff.js";

const redisUrl = process.env.AUTHYON_REDIS_TEST_URL;

function record(revision) {
  const now = Date.now();
  return {
    revision,
    tokens: {
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
      expiresAt: now + 60_000,
    },
    user: { id: "alice", email: "alice@example.com", organization: null },
    expiresAt: now + 120_000,
    idleExpiresAt: now + 60_000,
    busyUntil: null,
  };
}

test(
  "Redis real fences concurrent writers across BFF instances",
  { skip: redisUrl ? false : "AUTHYON_REDIS_TEST_URL is not set" },
  async (t) => {
    const firstClient = createClient({ url: redisUrl });
    const secondClient = createClient({ url: redisUrl });
    const prefix = `authyon:test:${randomUUID()}:`;
    const sessionKey = "session";
    const redisKey = prefix + sessionKey;

    await Promise.all([firstClient.connect(), secondClient.connect()]);
    t.after(async () => {
      await firstClient.del(redisKey);
      await Promise.all([firstClient.quit(), secondClient.quit()]);
    });

    const options = { encryptionKey: new Uint8Array(32).fill(7), prefix };
    const firstStore = createRedisBffSessionStore({ ...options, client: firstClient });
    const secondStore = createRedisBffSessionStore({ ...options, client: secondClient });

    assert.equal(await firstStore.compareAndSwap(sessionKey, null, record("one")), true);

    const rawRecord = await firstClient.get(redisKey);
    assert.ok(rawRecord);
    assert.doesNotMatch(rawRecord, /access-secret|refresh-secret|alice/);
    assert.ok((await firstClient.pTTL(redisKey)) > 0);

    const results = await Promise.all([
      firstStore.compareAndSwap(sessionKey, "one", record("two")),
      secondStore.compareAndSwap(sessionKey, "one", record("three")),
    ]);
    assert.equal(results.filter(Boolean).length, 1);

    const winner = await secondStore.read(sessionKey);
    assert.ok(winner?.revision === "two" || winner?.revision === "three");
    assert.equal(await firstStore.compareAndSwap(sessionKey, "one", null), false);
    assert.equal(await secondStore.compareAndSwap(sessionKey, winner.revision, null), true);
  },
);
