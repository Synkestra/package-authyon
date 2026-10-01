import assert from "node:assert/strict";
import test from "node:test";
import { createClient as createServerClient } from "../packages/server/dist/index.js";
import {
  AuthyonError,
  ErrorCodes,
  createClient as createAuthClient,
  createMemoryStorage,
} from "../packages/auth/dist/index.js";

const payload = {
  type: "pix",
  amount: 150.5,
  to: { name: "Maria Silva", pixKey: "maria@example.com" },
};
const pending = {
  id: "auth/1",
  status: "pending",
  subjectId: "user-1",
  payload,
  payloadHash: "a".repeat(64),
  createdAt: "2026-10-01T12:00:00Z",
  expiresAt: "2026-10-01T12:05:00Z",
};

function serverFixture(handler = () => globalThis.Response.json(pending)) {
  const requests = [];
  const client = createServerClient({
    envKey: "pk_test",
    clientId: "ec",
    clientSecret: "secret",
    httpAdapter: {
      async request(request) {
        requests.push(request);
        if (request.url.endsWith("/env/oauth/token"))
          return globalThis.Response.json({ access_token: "environment-token", expires_in: 3600 });
        return handler(request);
      },
    },
  });
  return { client, requests };
}

function authFixture(handler) {
  const requests = [];
  const storage = createMemoryStorage();
  storage.set({
    accessToken: "customer-token",
    refreshToken: "refresh",
    expiresIn: 60,
    expiresAt: Date.now() + 60_000,
  });
  const client = createAuthClient({
    envKey: "pk_test",
    storage,
    autoRefresh: false,
    httpAdapter: {
      async request(request) {
        requests.push(request);
        return handler(request);
      },
    },
  });
  return { client, requests };
}

const header = (request, name) => new globalThis.Headers(request.headers).get(name);

test("server creates with a free-form payload and consumes it", async () => {
  const { client, requests } = serverFixture();
  await client.security.approvals.create({
    subjectId: "user-1",
    payload,
    expiresInSeconds: 120,
    idempotencyKey: "order-42",
  });
  await client.security.approvals.get("auth/1");
  await client.security.approvals.consume("auth/1", payload);
  await client.security.approvals.consume("auth/1");

  const [, create, get, consume, consumeWithoutBody] = requests;
  assert.equal(create.url, "https://api.authyon.com/env/authorizations");
  assert.equal(header(create, "idempotency-key"), "order-42");
  assert.equal(header(create, "authorization"), "Bearer environment-token");
  assert.deepEqual(JSON.parse(create.body), {
    subjectId: "user-1",
    payload,
    expiresInSeconds: 120,
  });
  assert.equal(get.url, "https://api.authyon.com/env/authorizations/auth%2F1");
  assert.equal(consume.url, "https://api.authyon.com/env/authorizations/auth%2F1/consume");
  assert.deepEqual(JSON.parse(consume.body), { payload });
  assert.equal(consumeWithoutBody.body, undefined);
});

test("server create works without an idempotency key", async () => {
  const { client, requests } = serverFixture();
  await client.security.approvals.create({ subjectId: "u" });
  assert.equal(header(requests[1], "idempotency-key"), null);
  assert.deepEqual(JSON.parse(requests[1].body), { subjectId: "u" });
});

test("security.otp.check posts the code for the user and returns the verdict", async () => {
  const { client, requests } = serverFixture((request) =>
    JSON.parse(request.body).code === "123456"
      ? globalThis.Response.json({ valid: true, userId: "user/1", method: "otp", verifiedAt: "x" })
      : globalThis.Response.json({ valid: false, attemptsRemaining: 4 }),
  );
  assert.equal((await client.security.otp.check("user/1", "123456")).valid, true);
  assert.deepEqual(await client.security.otp.check("user/1", "000000"), {
    valid: false,
    attemptsRemaining: 4,
  });
  assert.equal(requests[1].url, "https://api.authyon.com/env/users/user%2F1/otp/verify");
  assert.equal(header(requests[1], "authorization"), "Bearer environment-token");
});

test("security.otp.check lockout surfaces as rate_limited with retryAfterSeconds", async () => {
  const { client } = serverFixture(() =>
    globalThis.Response.json({ error: "rate_limited", retryAfterSeconds: 900 }, { status: 429 }),
  );
  const error = await client.security.otp.check("u", "123456").catch((cause) => cause);
  assert.equal(error.code, ErrorCodes.RateLimited);
  assert.equal(error.extensions.retryAfterSeconds, 900);
  assert.equal(error.retryable, true);
});

test("customer confirms with an authenticator code using their own bearer", async () => {
  const { client, requests } = authFixture(() =>
    globalThis.Response.json({ ...pending, status: "approved" }),
  );
  const approved = await client.security.approvals.confirm("auth/1", {
    method: "authenticator",
    code: "123456",
  });
  assert.equal(approved.status, "approved");
  assert.equal(requests[0].url, "https://api.authyon.com/auth/authorizations/auth%2F1/confirm");
  assert.equal(header(requests[0], "authorization"), "Bearer customer-token");
  assert.equal(header(requests[0], "x-authyon-environment"), "pk_test");
  assert.deepEqual(JSON.parse(requests[0].body), { method: "authenticator", code: "123456" });
});

test("customer passkey flow, reject and confirm without body", async () => {
  const { client, requests } = authFixture((request) =>
    request.url.endsWith("/webauthn/options")
      ? globalThis.Response.json({ ceremonyToken: "c1", optionsJson: "{}" })
      : globalThis.Response.json(pending),
  );
  const options = await client.security.approvals.webauthnOptions("auth-1");
  await client.security.approvals.confirm("auth-1", {
    method: "webauthn",
    webAuthn: { ceremonyToken: options.ceremonyToken, assertionJson: '{"id":"x"}' },
  });
  await client.security.approvals.confirm("auth-1");
  await client.security.approvals.reject("auth-1");

  assert.equal(requests[0].method, "POST");
  assert.deepEqual(JSON.parse(requests[1].body).webAuthn, {
    ceremonyToken: "c1",
    assertionJson: '{"id":"x"}',
  });
  assert.equal(requests[2].body, undefined);
  assert.equal(requests[3].url, "https://api.authyon.com/auth/authorizations/auth-1/reject");
});

test("OAuth-style security errors map to code, detail and extensions", async () => {
  const { client } = authFixture(() =>
    globalThis.Response.json(
      {
        error: "invalid_code",
        error_description: "The second factor could not be verified.",
        attemptsRemaining: 3,
      },
      { status: 400 },
    ),
  );
  const error = await client.security.approvals
    .confirm("auth-1", { method: "authenticator", code: "000000" })
    .catch((cause) => cause);
  assert.ok(error instanceof AuthyonError);
  assert.equal(error.code, ErrorCodes.InvalidSecondFactorCode);
  assert.equal(error.detail, "The second factor could not be verified.");
  assert.equal(error.extensions.attemptsRemaining, 3);
  assert.equal(error.category, "validation");
  assert.equal("extensions" in error.toJSON(), false);
});

test("step_up_required asks the customer to authenticate again", async () => {
  const { client } = authFixture(() =>
    globalThis.Response.json(
      { error: "step_up_required", requiredMethods: ["webauthn", "totp"], maxAgeSeconds: 300 },
      { status: 403 },
    ),
  );
  const error = await client.security.approvals.confirm("auth-1").catch((cause) => cause);
  assert.equal(error.code, ErrorCodes.StepUpRequired);
  assert.equal(error.interpret().action, "reauthenticate");
  assert.deepEqual(error.extensions.requiredMethods, ["webauthn", "totp"]);
});

test("server user scope exposes security.approvals for BFFs", async () => {
  const { client, requests } = serverFixture();
  await client.user("customer-token").security.approvals.get("auth-1");
  assert.equal(requests[0].url, "https://api.authyon.com/auth/authorizations/auth-1");
  assert.equal(header(requests[0], "authorization"), "Bearer customer-token");
});
