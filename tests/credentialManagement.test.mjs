import assert from "node:assert/strict";
import test from "node:test";
import {
  createClient,
  AuthyonError,
  AuthyonServerClientBuilder,
} from "../packages/server/dist/index.js";

const summary = {
  id: "c1",
  clientId: "tc_1",
  description: "ERP",
  permissions: ["billing:invoices:read"],
  createdAt: "2026-09-01T00:00:00Z",
  lastUsedAt: null,
  revokedAt: null,
  expiresAt: null,
  isActive: true,
};
function page(data, hasNext = false) {
  return {
    data,
    perPage: 1,
    pageSize: 25,
    total: hasNext ? 2 : data.length,
    pages: hasNext ? 2 : 1,
    hasNext,
    hasPrev: false,
  };
}
function fixture(handler) {
  const requests = [];
  const client = createClient({
    envKey: "pk_test",
    clientId: "ec_test",
    clientSecret: "secret-never-log",
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
const scope = { workspaceId: "ws/a", environmentId: "env b", tenantId: "tenant/a" };
const base =
  "https://api.authyon.com/platform/workspaces/ws%2Fa/environments/env%20b/tenants/tenant%2Fa/credentials";

test("legacy list consumes current API pages and strips unexpected secrets", async () => {
  const { client, requests } = fixture((request) =>
    globalThis.Response.json(
      request.url.includes("skip=")
        ? page([{ ...summary, id: "c2" }])
        : page([{ ...summary, clientSecret: "leak" }], true),
    ),
  );
  assert.deepEqual(await client.environment.tenants.credentials.list("tenant/a"), [
    summary,
    { ...summary, id: "c2" },
  ]);
  assert.equal(requests[1].url, "https://api.authyon.com/env/tenants/tenant%2Fa/credentials");
  assert.match(requests[2].url, /skip=1&take=100$/);
  assert.ok(!JSON.stringify(client).includes("secret-never-log"));
  assert.ok(!JSON.stringify(client).includes("environment-token"));
});
test("legacy list rejects stalled or overlapping pagination", async () => {
  for (const data of [[], [summary]]) {
    const { client } = fixture(() => globalThis.Response.json(page(data, true)));
    await assert.rejects(
      client.environment.tenants.credentials.list("tenant"),
      /pagination|overlapped/,
    );
  }
});
test("listPage forwards combined search and offsets with safe response projection", async () => {
  const { client, requests } = fixture(() =>
    globalThis.Response.json({
      ...page([{ ...summary, secretHash: "hidden" }]),
      clientSecret: "hidden",
    }),
  );
  const result = await client.environment.tenants.credentials.listPage("tenant/a", {
    search: "  billing:invoices:read  ",
    skip: 20,
    take: 10,
  });
  assert.deepEqual(result, page([summary]));
  const url = new globalThis.URL(requests[1].url);
  assert.equal(url.searchParams.get("search"), "billing:invoices:read");
  assert.equal(url.searchParams.get("skip"), "20");
  assert.equal(url.searchParams.get("take"), "10");
});
test("detail exposes metadata and no secrets, including creator projection", async () => {
  const expected = {
    ...summary,
    createdBy: { id: "actor", type: "platform_user", displayName: "Operator" },
    updatedAt: null,
    secretRotatedAt: null,
    expiresAt: null,
    ageSeconds: 123,
    lifetimeSeconds: null,
    accessTokenLifetimeSeconds: 1800,
  };
  const { client, requests } = fixture(() =>
    globalThis.Response.json({
      ...expected,
      clientSecret: "hidden",
      secretHash: "hidden",
      createdBy: { ...expected.createdBy, password: "hidden" },
    }),
  );
  assert.deepEqual(await client.environment.tenants.credentials.get("tenant", "c/a"), expected);
  assert.match(requests[1].url, /credentials\/c%2Fa$/);
  assert.deepEqual(await client.platform("platform-token").credentials.get(scope, "c/a"), expected);
  assert.equal(requests[2].url, `${base}/c%2Fa`);
});
test("scopes is normalized into explicit wire permissions on creation", async () => {
  const { client, requests } = fixture(() =>
    globalThis.Response.json(
      { credentialId: "c1", clientSecret: "returned-once" },
      { status: 201 },
    ),
  );
  const issued = await client.environment.tenants.credentials.create("tenant", {
    description: "ERP",
    scopes: [" Billing:Invoices:Read ", "billing:invoices:read"],
  });
  assert.equal(issued.clientSecret, "returned-once");
  assert.deepEqual(JSON.parse(requests[1].body), {
    description: "ERP",
    permissions: ["billing:invoices:read"],
  });
});
test("invalid scope aliases and path segments fail before network activity", async () => {
  const { client, requests } = fixture(() => {
    throw new Error("unexpected request");
  });
  for (const input of [
    { scopes: [] },
    { scopes: ["read"] },
    { scopes: ["a:b:c"], permissions: ["x:y:z"] },
    {},
  ]) {
    await assert.rejects(
      async () => client.environment.tenants.credentials.create("tenant", input),
      TypeError,
    );
  }
  for (const id of ["", ".", "..", "bad\nvalue"])
    await assert.rejects(
      async () => client.platform("token").credentials.revoke(scope, id),
      TypeError,
    );
  for (const options of [{ skip: -1 }, { take: 101 }, { take: 0 }, { search: "x".repeat(201) }])
    await assert.rejects(
      client.environment.tenants.credentials.listPage("tenant", options),
      RangeError,
    );
  assert.equal(requests.length, 0);
});
test("platform credential lifecycle uses only supplied platform token and correct routes", async () => {
  const { client, requests } = fixture((request) =>
    request.method === "GET"
      ? globalThis.Response.json(page([summary]))
      : request.url.endsWith("/rotate") || request.method === "POST"
        ? globalThis.Response.json({ clientSecret: "new-secret" })
        : new globalThis.Response(null, { status: 204 }),
  );
  let token = "platform-one";
  const platform = client.platform(() => token);
  await platform.credentials.list(scope, { search: "ERP", skip: 0, take: 25 });
  token = "platform-two";
  await platform.credentials.create(scope, { scopes: ["a:b:c"] });
  await platform.credentials.updateScopes(scope, "c1", ["a:b:d"]);
  await platform.credentials.rotate(scope, "c1");
  await platform.credentials.revoke(scope, "c1");
  assert.deepEqual(
    requests.map((r) => r.method),
    ["GET", "POST", "PUT", "POST", "DELETE"],
  );
  assert.equal(requests[2].url, `${base}/c1/permissions`);
  assert.deepEqual(JSON.parse(requests[2].body), { permissions: ["a:b:d"] });
  assert.equal(requests[3].url, `${base}/c1/rotate`);
  assert.equal(requests[4].url, `${base}/c1`);
  for (const [i, request] of requests.entries()) {
    const headers = new globalThis.Headers(request.headers);
    assert.equal(
      headers.get("authorization"),
      i === 0 ? "Bearer platform-one" : "Bearer platform-two",
    );
    assert.equal(headers.get("x-authyon-environment"), null);
  }
  assert.ok(!JSON.stringify(platform).includes("platform-two"));
  await platform.credentials.revoke({ workspaceId: "ws", environmentId: "env" }, "c1");
  assert.equal(
    requests.at(-1).url,
    "https://api.authyon.com/platform/workspaces/ws/environments/env/credentials/c1",
  );
});
test("environment tenant credential lifecycle supports rotate and revoke", async () => {
  const { client, requests } = fixture((request) =>
    request.url.endsWith("/rotate")
      ? globalThis.Response.json({
          credentialId: "c1",
          clientId: "tc_1",
          clientSecret: "new-secret",
        })
      : new globalThis.Response(null, { status: 204 }),
  );
  const rotated = await client.environment.tenants.credentials.rotate("tenant/a", "c/a");
  await client.environment.tenants.credentials.updatePermissions("tenant/a", "c/a", {
    permissions: ["billing:invoices:write"],
  });
  await client.environment.tenants.credentials.revoke("tenant/a", "c/a");
  assert.equal(rotated.clientSecret, "new-secret");
  assert.equal(
    requests[1].url,
    "https://api.authyon.com/env/tenants/tenant%2Fa/credentials/c%2Fa/rotate",
  );
  assert.equal(requests[1].method, "POST");
  assert.equal(
    requests[2].url,
    "https://api.authyon.com/env/tenants/tenant%2Fa/credentials/c%2Fa/permissions",
  );
  assert.equal(requests[2].method, "PUT");
  assert.deepEqual(JSON.parse(requests[2].body), {
    permissions: ["billing:invoices:write"],
  });
  assert.equal(requests[3].url, "https://api.authyon.com/env/tenants/tenant%2Fa/credentials/c%2Fa");
  assert.equal(requests[3].method, "DELETE");
  for (const request of requests.slice(1)) {
    const headers = new globalThis.Headers(request.headers);
    assert.equal(headers.get("authorization"), "Bearer environment-token");
    assert.equal(headers.get("x-authyon-environment"), "pk_test");
  }
});
test("authorization and step-up failures never retry or fall back to machine credentials", async () => {
  const { client, requests } = fixture(() =>
    globalThis.Response.json(
      { code: "auth.step_up_required", title: "Step up required" },
      { status: 403 },
    ),
  );
  await assert.rejects(
    client.platform("platform-token").credentials.revoke(scope, "c1"),
    (error) => error instanceof AuthyonError && error.status === 403,
  );
  assert.equal(requests.length, 1);
  await assert.rejects(client.platform("").credentials.revoke(scope, "c1"), TypeError);
  assert.equal(requests.length, 1);
});

test("builder serialization does not expose environment secrets", () => {
  const builder = new AuthyonServerClientBuilder().withEnvironmentCredentials(
    "ec",
    "builder-secret",
  );
  assert.ok(!JSON.stringify(builder).includes("builder-secret"));
  assert.ok(!JSON.stringify(builder.build()).includes("builder-secret"));
});
