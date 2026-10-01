import assert from "node:assert/strict";
import test from "node:test";
import { createClient as createServerClient } from "../packages/server/dist/index.js";
import {
  AuthyonError,
  ErrorCodes,
  createClient as createAuthClient,
  createMemoryStorage,
} from "../packages/auth/dist/index.js";

const transaction = {
  action: "pix.transfer",
  amount: 150.5,
  currency: "BRL",
  beneficiary: "Maria Silva — 123.456.789-00",
  metadata: { pixKey: "maria@example.com" },
};
const pending = {
  id: "auth/1",
  status: "pending",
  subjectId: "user-1",
  ...transaction,
  transactionHash: "a".repeat(64),
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

test("server creates with Idempotency-Key header and consumes with the same transaction", async () => {
  const { client, requests } = serverFixture();
  await client.environment.financialAuthorizations.create({
    ...transaction,
    subjectId: "user-1",
    expiresInSeconds: 120,
    idempotencyKey: "order-42",
  });
  await client.environment.financialAuthorizations.get("auth/1");
  await client.environment.financialAuthorizations.consume("auth/1", transaction);

  const [, create, get, consume] = requests;
  assert.equal(create.url, "https://api.authyon.com/env/authorizations");
  assert.equal(header(create, "idempotency-key"), "order-42");
  assert.equal(header(create, "authorization"), "Bearer environment-token");
  assert.deepEqual(JSON.parse(create.body), {
    ...transaction,
    subjectId: "user-1",
    expiresInSeconds: 120,
  });
  assert.equal(get.url, "https://api.authyon.com/env/authorizations/auth%2F1");
  assert.equal(consume.url, "https://api.authyon.com/env/authorizations/auth%2F1/consume");
  assert.deepEqual(JSON.parse(consume.body), transaction);
});

test("server create requires an idempotency key", () => {
  const { client } = serverFixture();
  assert.throws(
    () => client.environment.financialAuthorizations.create({ ...transaction, subjectId: "u" }),
    TypeError,
  );
});

test("customer confirms with an authenticator code using their own bearer", async () => {
  const { client, requests } = authFixture(() =>
    globalThis.Response.json({ ...pending, status: "approved" }),
  );
  const approved = await client.financialAuthorizations.confirm("auth/1", {
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
  const options = await client.financialAuthorizations.webauthnOptions("auth-1");
  await client.financialAuthorizations.confirm("auth-1", {
    method: "webauthn",
    webAuthn: { ceremonyToken: options.ceremonyToken, assertionJson: '{"id":"x"}' },
  });
  await client.financialAuthorizations.confirm("auth-1");
  await client.financialAuthorizations.reject("auth-1");

  assert.equal(requests[0].method, "POST");
  assert.deepEqual(JSON.parse(requests[1].body).webAuthn, {
    ceremonyToken: "c1",
    assertionJson: '{"id":"x"}',
  });
  assert.equal(requests[2].body, undefined);
  assert.equal(requests[3].url, "https://api.authyon.com/auth/authorizations/auth-1/reject");
});

test("OAuth-style financial errors map to code, detail and extensions", async () => {
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
  const error = await client.financialAuthorizations
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
  const error = await client.financialAuthorizations.confirm("auth-1").catch((cause) => cause);
  assert.equal(error.code, ErrorCodes.StepUpRequired);
  assert.equal(error.interpret().action, "reauthenticate");
  assert.deepEqual(error.extensions.requiredMethods, ["webauthn", "totp"]);
});

test("server user scope exposes customer approval for BFFs", async () => {
  const { client, requests } = serverFixture();
  await client.user("customer-token").financialAuthorizations.get("auth-1");
  assert.equal(requests[0].url, "https://api.authyon.com/auth/authorizations/auth-1");
  assert.equal(header(requests[0], "authorization"), "Bearer customer-token");
});
