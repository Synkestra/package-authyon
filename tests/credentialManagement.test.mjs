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
      async () => client.environment.tenants.credentials.revoke("tenant", id),
      TypeError,
    );
  for (const options of [{ skip: -1 }, { take: 101 }, { take: 0 }, { search: "x".repeat(201) }])
    await assert.rejects(
      client.environment.tenants.credentials.listPage("tenant", options),
      RangeError,
    );
  assert.equal(requests.length, 0);
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
test("environment authorization failures are not retried", async () => {
  const { client, requests } = fixture(() =>
    globalThis.Response.json(
      { code: "auth.step_up_required", title: "Step up required" },
      { status: 403 },
    ),
  );
  await assert.rejects(
    client.environment.tenants.credentials.revoke("tenant", "c1"),
    (error) => error instanceof AuthyonError && error.status === 403,
  );
  assert.equal(requests.length, 2);
});

test("builder serialization does not expose environment secrets", () => {
  const builder = new AuthyonServerClientBuilder().withEnvironmentCredentials(
    "ec",
    "builder-secret",
  );
  assert.ok(!JSON.stringify(builder).includes("builder-secret"));
  assert.ok(!JSON.stringify(builder.build()).includes("builder-secret"));
});
