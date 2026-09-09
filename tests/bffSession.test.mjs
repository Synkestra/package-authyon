import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { AuthyonError } from "../packages/server/dist/index.js";
import { createBffSession, createMemoryBffSessionStore } from "../packages/server/dist/bff.js";

const ORIGIN = "https://app.example.com";

function request(method = "GET", cookie, body, extraHeaders = {}) {
  return new globalThis.Request(`${ORIGIN}/api/session`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(method !== "GET" ? { origin: ORIGIN, "x-authyon-csrf": "1" } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...extraHeaders,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function fixture(options = {}) {
  let sequence = 0;
  const identities = new Map();
  const calls = { refresh: 0, logout: 0, validate: 0 };
  const store = options.store ?? createMemoryBffSessionStore();
  function issue(id = "alice", slug = "tenant-a") {
    const tokens = {
      accessToken: `access-secret-${++sequence}`,
      refreshToken: `refresh-secret-${sequence}`,
      expiresAt: Date.now() + 60_000,
    };
    identities.set(tokens.accessToken, {
      id,
      email: `${id}@example.com`,
      organization: { id: slug, slug },
      accidentalSecret: "not-public",
    });
    return tokens;
  }
  const provider = {
    login: async (input) => issue(input.email?.split("@")[0]),
    verifyTwoFactor: async () => issue(),
    refresh: async () => {
      calls.refresh++;
      return issue();
    },
    logout: async () => {
      calls.logout++;
    },
    switchOrganization: async (_token, slug) => issue("alice", slug),
    validate: async () => {
      calls.validate++;
      return true;
    },
    profile: async (token) => identities.get(token),
  };
  const bffOptions = { origin: ORIGIN, provider, store, ...options };
  const bff = createBffSession(bffOptions);
  async function login(email = "alice@example.com") {
    const response = await bff.login(
      request("POST", undefined, { email, password: "password-secret" }),
    );
    assert.equal(response.status, 200);
    return { response, cookie: response.headers.get("set-cookie").split(";")[0] };
  }
  return { bff, bffOptions, store, provider, calls, issue, login };
}

function keyFromCookie(cookie) {
  return createHash("sha256")
    .update(`${ORIGIN}\0${cookie.split("=")[1]}`)
    .digest("hex");
}

test("login emits an opaque protected cookie and allowlists the public response", async () => {
  const f = fixture();
  const { response, cookie } = await f.login();
  assert.match(
    response.headers.get("set-cookie"),
    /^__Host-authyon.session=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Lax; Secure; Max-Age=/,
  );
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.doesNotMatch(
    await response.text(),
    /access-secret|refresh-secret|password-secret|not-public/,
  );
  const session = await f.bff.session(request("GET", cookie));
  assert.equal((await session.json()).user.id, "alice");
});

test("independent browsers keep separate user credentials", async () => {
  const f = fixture();
  const alice = await f.login();
  const bob = await f.login("bob@example.com");
  const [first, second] = await Promise.all([
    f.bff.requireSession(request("GET", alice.cookie)),
    f.bff.requireSession(request("GET", bob.cookie)),
  ]);
  assert.notEqual(first.accessToken, second.accessToken);
  assert.equal(first.user.id, "alice");
  assert.equal(second.user.id, "bob");
});

test("parallel BFF instances rotate the single-use token exactly once", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const f = fixture();
  const { cookie } = await f.login();
  now += 35_000;
  const secondInstance = createBffSession(f.bffOptions);
  const responses = await Promise.all([
    f.bff.session(request("GET", cookie)),
    secondInstance.session(request("GET", cookie)),
    secondInstance.session(request("GET", cookie)),
  ]);
  assert.deepEqual(
    responses.map((response) => response.status),
    [200, 200, 200],
  );
  assert.equal(f.calls.refresh, 1);
});

test("absolute lifetime cannot be extended by activity", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const f = fixture({ absoluteTimeoutMs: 1000, idleTimeoutMs: 800 });
  const { cookie } = await f.login();
  now += 700;
  assert.equal((await f.bff.session(request("GET", cookie))).status, 200);
  now += 301;
  assert.equal((await f.bff.session(request("GET", cookie))).status, 401);
});

test("idle timeout invalidates an unused session", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const f = fixture({ absoluteTimeoutMs: 2000, idleTimeoutMs: 500 });
  const { cookie } = await f.login();
  now += 501;
  const response = await f.bff.session(request("GET", cookie));
  assert.equal(response.status, 401);
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
});

test("upstream revocation invalidates the local cookie", async () => {
  const f = fixture();
  const { cookie } = await f.login();
  f.provider.validate = async () => false;
  assert.equal((await f.bff.session(request("GET", cookie))).status, 401);
  f.provider.validate = async () => true;
  assert.equal((await f.bff.session(request("GET", cookie))).status, 401);
});

test("a validation outage preserves the session and returns an unavailable response", async () => {
  const f = fixture();
  const { cookie } = await f.login();
  f.provider.validate = async () => {
    throw new Error("private-provider-detail");
  };
  const response = await f.bff.session(request("GET", cookie));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.doesNotMatch(await response.text(), /private-provider-detail/);
  f.provider.validate = async () => true;
  assert.equal((await f.bff.session(request("GET", cookie))).status, 200);
});

test("ambiguous refresh failure cannot replay a potentially consumed token", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const f = fixture();
  const { cookie } = await f.login();
  now += 35_000;
  f.provider.refresh = async () => {
    f.calls.refresh++;
    throw new Error("connection lost");
  };
  assert.equal((await f.bff.session(request("GET", cookie))).status, 503);
  assert.equal((await f.bff.session(request("GET", cookie))).status, 401);
  assert.equal(f.calls.refresh, 1);
});

test("rate limit before rotation retains the old session and Retry-After", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const f = fixture();
  const { cookie } = await f.login();
  now += 35_000;
  f.provider.refresh = async () => {
    throw new AuthyonError(429, {}, { retryAfter: 10 });
  };
  const response = await f.bff.session(request("GET", cookie));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "10");
  assert.equal(response.headers.get("set-cookie"), null);
  f.provider.refresh = async () => f.issue();
  assert.equal((await f.bff.session(request("GET", cookie))).status, 200);
});

test("rate limit after issuance cannot restore a consumed token pair", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const f = fixture();
  const { cookie } = await f.login();
  now += 35_000;
  f.provider.profile = async () => {
    throw new AuthyonError(429, {});
  };
  assert.equal((await f.bff.session(request("GET", cookie))).status, 503);
  assert.equal((await f.bff.session(request("GET", cookie))).status, 401);
  assert.equal(f.calls.logout, 1);
});

test("tenant switch publishes matching tokens and profile", async () => {
  const f = fixture();
  const { cookie } = await f.login();
  const response = await f.bff.switchOrganization(
    request("POST", cookie, { organizationSlug: "tenant-b" }),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.organization.slug, "tenant-b");
  const session = await f.bff.requireSession(request("GET", cookie));
  assert.equal(
    (await f.provider.profile(session.accessToken)).organization.slug,
    session.user.organization.slug,
  );
});

test("forbidden tenant switch preserves the original session", async () => {
  const f = fixture();
  const { cookie } = await f.login();
  f.provider.switchOrganization = async () => {
    throw new AuthyonError(403, {});
  };
  assert.equal(
    (await f.bff.switchOrganization(request("POST", cookie, { organizationSlug: "forbidden" })))
      .status,
    403,
  );
  const response = await f.bff.session(request("GET", cookie));
  assert.equal((await response.json()).user.organization.slug, "tenant-a");
});

test("wrong tenant or user after a switch fails closed", async () => {
  const f = fixture();
  const { cookie } = await f.login();
  f.provider.switchOrganization = async () => f.issue("mallory", "tenant-b");
  assert.equal(
    (await f.bff.switchOrganization(request("POST", cookie, { organizationSlug: "tenant-b" })))
      .status,
    503,
  );
  assert.equal((await f.bff.session(request("GET", cookie))).status, 401);
});

test("logout remains locally effective when upstream revocation fails", async () => {
  const f = fixture();
  const { cookie } = await f.login();
  f.provider.logout = async () => {
    throw new Error("network down");
  };
  const response = await f.bff.logout(request("POST", cookie));
  assert.equal(response.status, 503);
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal((await f.bff.session(request("GET", cookie))).status, 401);
});

test("logout racing with refresh cannot leave a revived session", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const f = fixture();
  const { cookie } = await f.login();
  now += 35_000;
  const secondInstance = createBffSession(f.bffOptions);
  const responses = await Promise.all([
    f.bff.session(request("GET", cookie)),
    secondInstance.logout(request("POST", cookie)),
  ]);
  assert.equal(responses[1].status, 204);
  assert.equal((await f.bff.session(request("GET", cookie))).status, 401);
});

test("stale compare-and-swap cannot resurrect a deleted session", async () => {
  const f = fixture();
  const { cookie } = await f.login();
  const key = keyFromCookie(cookie);
  const previous = await f.store.read(key);
  await f.bff.logout(request("POST", cookie));
  assert.equal(await f.store.compareAndSwap(key, previous.revision, previous), false);
});

test("a crashed rotation expires closed rather than releasing its old tokens", async () => {
  const f = fixture();
  const { cookie } = await f.login();
  const key = keyFromCookie(cookie);
  const previous = await f.store.read(key);
  await f.store.compareAndSwap(key, previous.revision, { ...previous, busyUntil: Date.now() - 1 });
  const response = await f.bff.session(request("GET", cookie));
  assert.equal(response.status, 503);
  assert.equal(await f.store.read(key), null);
});

test("all mutation handlers reject foreign Origin before provider calls", async () => {
  const f = fixture();
  for (const handler of [
    f.bff.login,
    f.bff.verifyTwoFactor,
    f.bff.switchOrganization,
    f.bff.logout,
  ]) {
    assert.equal(
      (await handler(request("POST", undefined, {}, { origin: "https://evil.example" }))).status,
      403,
    );
  }
  assert.equal(f.calls.validate, 0);
});

test("mutations require the CSRF header, JSON and correct HTTP method", async () => {
  const f = fixture();
  assert.equal(
    (await f.bff.login(request("POST", undefined, {}, { "x-authyon-csrf": "" }))).status,
    403,
  );
  assert.equal(
    (await f.bff.login(request("POST", undefined, {}, { "content-type": "text/plain" }))).status,
    415,
  );
  assert.equal((await f.bff.logout(request("GET"))).status, 405);
});

test("duplicate session cookies and cross-site reads are denied", async () => {
  const f = fixture();
  const { cookie } = await f.login();
  assert.equal((await f.bff.session(request("GET", `${cookie}; ${cookie}`))).status, 401);
  assert.equal(
    (await f.bff.session(request("GET", cookie, undefined, { "sec-fetch-site": "cross-site" })))
      .status,
    403,
  );
});

test("oversized and malformed input is rejected", async () => {
  const f = fixture();
  assert.equal(
    (await f.bff.login(request("POST", undefined, { password: "x".repeat(17000) }))).status,
    413,
  );
  assert.equal(
    (await f.bff.login(request("POST", undefined, { password: 123, email: "alice" }))).status,
    400,
  );
});

test("two-factor challenge does not establish a session or expose arbitrary provider fields", async () => {
  const f = fixture();
  f.provider.login = async () => ({
    twoFactorRequired: true,
    challengeToken: "challenge",
    methods: ["authenticator"],
    refreshToken: "private",
  });
  const response = await f.bff.login(
    request("POST", undefined, { email: "alice", password: "password" }),
  );
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(await response.json(), {
    twoFactorRequired: true,
    challengeToken: "challenge",
    methods: ["authenticator"],
  });
  const completed = await f.bff.verifyTwoFactor(
    request("POST", undefined, {
      challengeToken: "challenge",
      method: "authenticator",
      code: "123456",
    }),
  );
  assert.equal(completed.status, 200);
  assert.match(completed.headers.get("set-cookie"), /HttpOnly/);
});

test("login cannot silently replace an authenticated identity", async () => {
  const f = fixture();
  const { cookie } = await f.login();
  assert.equal(
    (await f.bff.login(request("POST", cookie, { email: "bob", password: "secret" }))).status,
    409,
  );
});

test("remote HTTP origins stay rejected even with the local development option", () => {
  assert.throws(
    () => fixture({ origin: "http://app.example.com", allowInsecureLocalhost: true }),
    /HTTPS origin/,
  );
  assert.throws(() => fixture({ origin: `${ORIGIN}/path` }), /HTTPS origin/);
  assert.throws(() => fixture({ origin: "https://user:secret@app.example.com" }), /HTTPS origin/);
});

test("session identifiers are bound to the configured application origin", async () => {
  const f = fixture();
  const { cookie } = await f.login();
  const otherOrigin = "https://other.example.com";
  const otherApp = createBffSession({ ...f.bffOptions, origin: otherOrigin });
  const response = await otherApp.session(
    new globalThis.Request(`${otherOrigin}/session`, { headers: { cookie } }),
  );
  assert.equal(response.status, 401);
});

test("login cannot silently ignore the requested organization", async () => {
  const f = fixture();
  const response = await f.bff.login(
    request("POST", undefined, {
      email: "alice",
      password: "secret",
      organizationSlug: "tenant-b",
    }),
  );
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(f.calls.logout, 1);
});

test("late rotation cannot publish after the operation deadline", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const f = fixture();
  const { cookie } = await f.login();
  now += 35_000;
  f.provider.refresh = async () => {
    now += 120_001;
    return f.issue();
  };
  assert.equal((await f.bff.session(request("GET", cookie))).status, 503);
  assert.equal((await f.bff.session(request("GET", cookie))).status, 401);
});

test("unavailable storage cannot return an authenticated response", async () => {
  const f = fixture();
  const { cookie } = await f.login();
  f.store.read = async () => {
    throw new Error("Redis down");
  };
  const response = await f.bff.session(request("GET", cookie));
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /Redis down|accessToken/);
});

test("a failed session insert revokes issued tokens and does not set a cookie", async () => {
  const f = fixture();
  f.store.compareAndSwap = async () => {
    throw new Error("Redis down");
  };
  const response = await f.bff.login(
    request("POST", undefined, { email: "alice", password: "secret" }),
  );
  assert.equal(response.status, 503);
  assert.equal(f.calls.logout, 1);
  assert.equal(response.headers.get("set-cookie"), null);
});
