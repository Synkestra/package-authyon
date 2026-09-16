import assert from "node:assert/strict";
import test from "node:test";

import {
  AuthyonError,
  AuthyonClientBuilder,
  ErrorCodes,
  LoggingHttpAdapter,
  createClient,
  createDefaultStorage,
  createLocalStorage,
  createMemoryStorage,
} from "../packages/auth/dist/index.js";
import {
  AuthyonServerClientBuilder,
  createClient as createServerClient,
} from "../packages/server/dist/index.js";

const session = {
  accessToken: "access",
  refreshToken: "refresh",
  expiresIn: 60,
  expiresAt: Date.now() + 60_000,
};

test("client builders compose progressive configuration", () => {
  const httpAdapter = { request: async () => new globalThis.Response(null, { status: 204 }) };
  const browserClient = new AuthyonClientBuilder("pk_test")
    .withTimeout(1_000)
    .withAutomaticRefresh(false)
    .withStorage(createMemoryStorage())
    .withHttpAdapter(httpAdapter)
    .build();
  const serverClient = new AuthyonServerClientBuilder()
    .withEnvironmentKey("pk_test")
    .withEnvironmentCredentials("client", "secret")
    .withTimeout(1_000)
    .withHttpAdapter(httpAdapter)
    .build();

  assert.ok(browserClient);
  assert.ok(serverClient);
});

test("HTTP logging is sanitized, mutable and cannot break requests", async () => {
  const events = [];
  const logging = {
    enabled: true,
    logger: (event) => events.push(event),
  };
  const adapter = new LoggingHttpAdapter(
    {
      request: async () =>
        new globalThis.Response(null, {
          status: 204,
          headers: { "x-request-id": "request-1" },
        }),
    },
    logging,
  );
  const request = {
    url: "https://api.authyon.com/users?email=sensitive%40example.com&take=10",
    method: "GET",
    headers: { authorization: "Bearer secret" },
    body: "password=secret",
    signal: new globalThis.AbortController().signal,
  };

  await adapter.request(request);
  assert.equal(events.length, 2);
  assert.equal(events[0].type, "request");
  assert.match(events[0].url, /email=REDACTED/);
  assert.doesNotMatch(JSON.stringify(events), /sensitive|Bearer|password|secret/);
  assert.equal(events[1].requestId, "request-1");

  logging.enabled = false;
  await adapter.request(request);
  assert.equal(events.length, 2);

  logging.enabled = true;
  logging.logger = () => {
    throw new Error("logger failure");
  };
  await assert.doesNotReject(adapter.request(request));
});

test("AuthyonError interprets every locally mapped error family", () => {
  const cases = [
    [new AuthyonError(0, { code: ErrorCodes.NetworkError }), "network", "retry", true],
    [new AuthyonError(0, { code: ErrorCodes.Timeout }), "timeout", "retry", true],
    [
      new AuthyonError(401, { code: ErrorCodes.InvalidToken }),
      "authentication",
      "reauthenticate",
      false,
    ],
    [
      new AuthyonError(403, { code: "permission.denied" }),
      "authorization",
      "request_access",
      false,
    ],
    [new AuthyonError(422, { code: ErrorCodes.PasswordWeak }), "validation", "fix_input", false],
    [new AuthyonError(404, { code: "resource.missing" }), "not_found", "not_found", false],
    [new AuthyonError(409, { code: ErrorCodes.EmailTaken }), "conflict", "resolve_conflict", false],
    [new AuthyonError(429, { code: ErrorCodes.RateLimited }), "rate_limit", "retry", true],
    [new AuthyonError(503, { code: "service.unavailable" }), "server", "retry", true],
    [new AuthyonError(418, { code: ErrorCodes.Unknown }), "unknown", "contact_support", false],
  ];

  for (const [error, category, action, retryable] of cases) {
    assert.deepEqual(error.interpret(), { category, action, retryable });
  }
});

test("AuthyonError helpers and JSON preserve support metadata", () => {
  const error = new AuthyonError(
    429,
    { code: ErrorCodes.RateLimited, title: "Slow down" },
    { requestId: "req-42", retryAfter: 15 },
  );
  assert.equal(error.is(ErrorCodes.RateLimited), true);
  assert.equal(error.isAny(ErrorCodes.Timeout, ErrorCodes.RateLimited), true);
  assert.equal(error.hasPrefix("rate"), true);
  assert.equal(error.isStatus(429, 503), true);
  assert.equal(error.category, "rate_limit");
  assert.equal(error.retryable, true);
  assert.equal(error.toJSON().requestId, "req-42");
});

test("default storage is memory-only", () => {
  const first = createDefaultStorage();
  const second = createDefaultStorage();
  first.set(session);
  assert.deepEqual(first.get(), session);
  assert.equal(second.get(), null);
});

test("localStorage adapter discards malformed sessions", () => {
  const values = new Map([["authyon.session", JSON.stringify({ accessToken: "only-one-field" })]]);
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  };
  const storage = createLocalStorage();
  assert.equal(storage.get(), null);
  assert.equal(values.has("authyon.session"), false);
  delete globalThis.window;
});

test("clients reject insecure remote base URLs", () => {
  assert.throws(() => createClient({ envKey: "pk_test", baseUrl: "http://example.com" }), /HTTPS/);
  assert.throws(() => createServerClient({ baseUrl: "http://example.com" }), /HTTPS/);
  assert.doesNotThrow(() => createClient({ envKey: "pk_test", baseUrl: "http://localhost:3000" }));
});

test("both clients accept the shared HttpAdapter contract", async () => {
  const requests = [];
  const httpAdapter = {
    async request(request) {
      requests.push(request);
      return new globalThis.Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  };
  const browserClient = createClient({ envKey: "pk_test", httpAdapter });
  const serverClient = createServerClient({ envKey: "pk_test", httpAdapter });

  await browserClient.sso.providers();
  await serverClient.discovery.jwks();

  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "https://api.authyon.com/auth/sso/providers");
  assert.equal(requests[1].url, "https://api.authyon.com/.well-known/jwks.json");
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[0].headers["x-authyon-environment"], "pk_test");
  assert.equal(requests[0].signal instanceof globalThis.AbortSignal, true);
});

test("both clients forward a configured origin IP on every request", async () => {
  const requests = [];
  const httpAdapter = {
    async request(request) {
      requests.push(request);
      return new globalThis.Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  };
  const browserClient = createClient({
    envKey: "pk_test",
    clientIp: "203.0.113.10",
    httpAdapter,
  });
  const serverClient = createServerClient({
    envKey: "pk_test",
    clientIp: "2001:db8::10",
    httpAdapter,
  });

  await browserClient.sso.providers();
  await serverClient.discovery.jwks();

  assert.equal(new globalThis.Headers(requests[0].headers).get("x-forwarded-for"), "203.0.113.10");
  assert.equal(new globalThis.Headers(requests[1].headers).get("x-forwarded-for"), "2001:db8::10");
});

test("per-call server origin IP overrides the configured default", async () => {
  const requests = [];
  const client = createServerClient({
    envKey: "pk_test",
    clientId: "client",
    clientSecret: "secret",
    clientIp: "203.0.113.10",
    httpAdapter: {
      async request(request) {
        requests.push(request);
        const body = request.url.endsWith("/env/oauth/token")
          ? { access_token: "machine", token_type: "Bearer", expires_in: 300 }
          : { valid: true, profile: null };
        return new globalThis.Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  });

  await client.validate("access-token", { clientIp: "198.51.100.20" });

  assert.equal(new globalThis.Headers(requests[1].headers).get("x-forwarded-for"), "198.51.100.20");
});

test("httpAdapter and legacy fetch cannot be configured together", () => {
  assert.throws(
    () =>
      createClient({
        envKey: "pk_test",
        httpAdapter: { request: async () => new globalThis.Response() },
        fetch: globalThis.fetch,
      }),
    /either `httpAdapter` or `fetch`/,
  );
});

test("server machine-token acquisition is shared by concurrent calls", async () => {
  let tokenRequests = 0;
  const requestedUrls = [];
  const httpAdapter = {
    async request(request) {
      requestedUrls.push(request.url);
      if (request.url.endsWith("/env/oauth/token")) {
        tokenRequests += 1;
        await new Promise((resolve) => globalThis.setTimeout(resolve, 5));
        return new globalThis.Response(
          JSON.stringify({ access_token: "machine", token_type: "Bearer", expires_in: 300 }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new globalThis.Response(
        JSON.stringify({
          data: [],
          pageSize: 10,
          total: 0,
          pages: 0,
          hasNext: false,
          hasPrev: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  };
  const client = createServerClient({
    envKey: "pk_test",
    clientId: "client",
    clientSecret: "secret",
    httpAdapter,
  });

  await Promise.all([
    client.environment.users.list({ skip: 0, take: 10 }),
    client.environment.users.list({ skip: 10, take: 10 }),
  ]);

  assert.equal(tokenRequests, 1);
  assert.equal(requestedUrls.includes("https://api.authyon.com/env/users?skip=0&take=10"), true);
  assert.equal(requestedUrls.includes("https://api.authyon.com/env/users?skip=10&take=10"), true);
});

test("auth state distinguishes active and expired sessions", () => {
  const storage = createMemoryStorage();
  const client = createClient({ envKey: "pk_test", storage });
  assert.equal(client.getAuthState(), "signed_out");
  storage.set(session);
  assert.equal(client.getAuthState(), "authenticated");
  storage.set({ ...session, expiresAt: Date.now() - 1 });
  assert.equal(client.getAuthState(), "expired");
  assert.equal(client.isAuthenticated(), false);
});

test("network failures are structured without leaking request bodies", async () => {
  const client = createClient({
    envKey: "pk_test",
    fetch: async () => {
      throw new Error("offline");
    },
  });
  await assert.rejects(client.register({ email: "a@example.com", password: "secret" }), (error) => {
    assert.equal(error.code, "request.network_error");
    assert.equal(error.status, 0);
    assert.doesNotMatch(error.message, /secret/);
    return true;
  });
});

test("request timeout has a dedicated error code", async () => {
  const client = createClient({
    envKey: "pk_test",
    timeoutMs: 5,
    fetch: (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("Aborted")));
      }),
  });
  await assert.rejects(client.register({ email: "a@example.com", password: "secret" }), {
    code: "request.timeout",
  });
});

test("getAccessToken does not disguise transient refresh failures as logout", async () => {
  const storage = createMemoryStorage();
  storage.set({ ...session, expiresAt: Date.now() - 1 });
  const client = createClient({
    envKey: "pk_test",
    storage,
    fetch: async () => {
      throw new Error("offline");
    },
  });
  await assert.rejects(client.getAccessToken(), { code: "request.network_error" });
  assert.notEqual(storage.get(), null);
});

test("API errors expose safe operational metadata", async () => {
  const client = createClient({
    envKey: "pk_test",
    fetch: async () =>
      new globalThis.Response(JSON.stringify({ code: "rate_limited", title: "Slow down" }), {
        status: 429,
        headers: {
          "content-type": "application/json",
          "retry-after": "12",
          "x-request-id": "req-123",
        },
      }),
  });
  await assert.rejects(client.register({ email: "a@example.com", password: "secret" }), (error) => {
    assert.equal(error.retryAfter, 12);
    assert.equal(error.requestId, "req-123");
    return true;
  });
});
