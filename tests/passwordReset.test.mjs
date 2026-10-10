import assert from "node:assert/strict";
import test from "node:test";
import { createClient as createServerClient } from "../packages/server/dist/index.js";
import { createClient, createMemoryStorage } from "../packages/auth/dist/index.js";

const header = (request, name) => new globalThis.Headers(request.headers).get(name);

function serverFixture(respond = () => globalThis.Response.json({ ok: true })) {
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
        return respond(request);
      },
    },
  });
  return { client, requests: () => requests.filter((r) => !r.url.endsWith("/env/oauth/token")) };
}

function browserFixture(respond = () => globalThis.Response.json({ ok: true })) {
  const requests = [];
  const client = createClient({
    envKey: "pk_test",
    storage: createMemoryStorage(),
    httpAdapter: {
      async request(request) {
        requests.push(request);
        return respond(request);
      },
    },
  });
  return { client, requests };
}

test("issuing a reset goes to /env with the environment credential and does not mail by default", async () => {
  const { client, requests } = serverFixture();
  await client.environment.users.issuePasswordReset({ email: "p@example.com" });
  await client.environment.users.issuePasswordReset({
    email: "q@example.com",
    redirectUri: "https://app.example.com/login",
    sendEmail: true,
  });

  const [tokenOnly, mailed] = requests();
  assert.equal(tokenOnly.url, "https://api.authyon.com/env/password-resets");
  assert.equal(tokenOnly.method, "POST");
  assert.deepEqual(JSON.parse(tokenOnly.body), { email: "p@example.com", sendEmail: false });
  assert.deepEqual(JSON.parse(mailed.body), {
    email: "q@example.com",
    redirectUri: "https://app.example.com/login",
    sendEmail: true,
  });
  for (const request of requests())
    assert.equal(header(request, "authorization"), "Bearer environment-token");
});

test("server-side validate and confirm are public: environment key, no bearer", async () => {
  const { client, requests } = serverFixture((request) =>
    request.url.endsWith("/confirm")
      ? globalThis.Response.json({ redirectUri: "https://app.example.com/login" })
      : globalThis.Response.json({
          email: "p@example.com",
          expiresAt: "2026-01-01T00:00:00Z",
          redirectUri: null,
        }),
  );
  const preview = await client.environment.users.validatePasswordReset("tok");
  const done = await client.environment.users.confirmPasswordReset("tok", "N3w-passw0rd!");

  const [validate, confirm] = requests();
  assert.equal(validate.url, "https://api.authyon.com/auth/password-reset/validate");
  assert.deepEqual(JSON.parse(validate.body), { token: "tok" });
  assert.equal(confirm.url, "https://api.authyon.com/auth/password-reset/confirm");
  assert.deepEqual(JSON.parse(confirm.body), { token: "tok", newPassword: "N3w-passw0rd!" });
  for (const request of [validate, confirm]) {
    assert.equal(header(request, "authorization"), null);
    assert.equal(header(request, "x-authyon-environment"), "pk_test");
  }
  assert.equal(preview.email, "p@example.com");
  assert.deepEqual(done, { redirectUri: "https://app.example.com/login" });
});

test("the browser client sends redirectUri only when given and validates without a bearer", async () => {
  const { client, requests } = browserFixture();
  await client.user.requestPasswordReset("p@example.com");
  await client.user.requestPasswordReset("p@example.com", {
    redirectUri: "https://app.example.com/login",
  });
  await client.user.validatePasswordReset("tok");

  const [plain, withRedirect, validate] = requests;
  assert.deepEqual(JSON.parse(plain.body), { email: "p@example.com" });
  assert.deepEqual(JSON.parse(withRedirect.body), {
    email: "p@example.com",
    redirectUri: "https://app.example.com/login",
  });
  assert.equal(validate.url, "https://api.authyon.com/auth/password-reset/validate");
  assert.deepEqual(JSON.parse(validate.body), { token: "tok" });
  assert.equal(header(validate, "authorization"), null);
});

test("confirm resolves the redirect, and null when the API answers 204", async () => {
  const withRedirect = browserFixture(() =>
    globalThis.Response.json({ redirectUri: "https://app.example.com/login" }),
  );
  assert.deepEqual(await withRedirect.client.user.confirmPasswordReset("tok", "N3w-passw0rd!"), {
    redirectUri: "https://app.example.com/login",
  });

  const without = browserFixture(() => new globalThis.Response(null, { status: 204 }));
  assert.deepEqual(await without.client.user.confirmPasswordReset("tok", "N3w-passw0rd!"), {
    redirectUri: null,
  });
});
