import assert from "node:assert/strict";
import test from "node:test";
import { createClient as createServerClient } from "../packages/server/dist/index.js";
import { createClient, createMemoryStorage } from "../packages/auth/dist/index.js";

const header = (request, name) => new globalThis.Headers(request.headers).get(name);

function serverFixture() {
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
        return globalThis.Response.json({ ok: true });
      },
    },
  });
  return { client, requests: () => requests.filter((r) => !r.url.endsWith("/env/oauth/token")) };
}

test("environment invites hit /env with the environment credential and default to sending the email", async () => {
  const { client, requests } = serverFixture();
  await client.environment.tenants.invites.create("tenant/a", {
    email: "p@example.com",
    roles: ["reader"],
  });
  await client.environment.tenants.invites.create("tenant/a", {
    email: "q@example.com",
    sendEmail: false,
    redirectUri: "https://app.example.com/welcome",
  });
  await client.environment.tenants.invites.list("tenant/a");
  await client.environment.tenants.invites.resend("tenant/a", "invite/1", { sendEmail: false });
  await client.environment.tenants.invites.revoke("tenant/a", "invite/1");

  const [create, linkOnly, list, resend, revoke] = requests();
  assert.equal(create.url, "https://api.authyon.com/env/tenants/tenant%2Fa/invites");
  assert.deepEqual(JSON.parse(create.body), {
    email: "p@example.com",
    roles: ["reader"],
    sendEmail: true,
  });
  assert.equal(JSON.parse(linkOnly.body).sendEmail, false);
  assert.equal(JSON.parse(linkOnly.body).redirectUri, "https://app.example.com/welcome");
  assert.equal(list.method, "GET");
  assert.equal(
    resend.url,
    "https://api.authyon.com/env/tenants/tenant%2Fa/invites/invite%2F1/resend",
  );
  assert.deepEqual(JSON.parse(resend.body), { sendEmail: false });
  assert.equal(revoke.method, "DELETE");
  for (const request of requests())
    assert.equal(header(request, "authorization"), "Bearer environment-token");
});

test("invite preview and accept are public: environment key, no bearer", async () => {
  const { client, requests } = serverFixture();
  await client.environment.tenants.invites.preview("tok");
  await client.environment.tenants.invites.accept({ token: "tok", password: "s3cret-pass" });

  const [preview, accept] = requests();
  assert.equal(preview.url, "https://api.authyon.com/auth/tenant-invites/preview");
  assert.deepEqual(JSON.parse(preview.body), { token: "tok" });
  assert.equal(accept.url, "https://api.authyon.com/auth/tenant-invites/accept");
  for (const request of [preview, accept]) {
    assert.equal(header(request, "authorization"), null);
    assert.equal(header(request, "x-authyon-environment"), "pk_test");
  }
});

test("user-scoped invites act as the user on /auth", async () => {
  const { client, requests } = serverFixture();
  const user = client.user(async () => "user-token");
  await user.tenants.invites.create("tenant", { email: "p@example.com" });
  await user.tenants.invites.list("tenant");
  await user.tenants.invites.revoke("tenant", "invite");

  const [create] = requests();
  assert.equal(create.url, "https://api.authyon.com/auth/tenants/tenant/invites");
  assert.equal(JSON.parse(create.body).sendEmail, true);
  for (const request of requests())
    assert.equal(header(request, "authorization"), "Bearer user-token");
});

test("browser client manages invites with the session and redeems them anonymously", async () => {
  const requests = [];
  const storage = createMemoryStorage();
  storage.set({
    accessToken: "access",
    refreshToken: "refresh",
    expiresIn: 60,
    expiresAt: Date.now() + 60_000,
  });
  const client = createClient({
    envKey: "pk_test",
    storage,
    httpAdapter: {
      async request(request) {
        requests.push(request);
        return globalThis.Response.json({ ok: true });
      },
    },
  });

  await client.organization.invites.create("org", { email: "p@example.com", sendEmail: false });
  await client.organization.invites.resend("org", "invite");
  await client.organization.invites.accept({ token: "tok" });

  const [create, resend, accept] = requests;
  assert.equal(create.url, "https://api.authyon.com/auth/tenants/org/invites");
  assert.equal(JSON.parse(create.body).sendEmail, false);
  assert.equal(header(create, "authorization"), "Bearer access");
  assert.deepEqual(JSON.parse(resend.body), { sendEmail: true });
  assert.equal(accept.url, "https://api.authyon.com/auth/tenant-invites/accept");
  assert.equal(header(accept, "authorization"), null);
});
