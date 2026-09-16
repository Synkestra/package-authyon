import assert from "node:assert/strict";
import test from "node:test";
import { createClient, AuthyonError } from "../packages/server/dist/index.js";

function fixture(status = 201) {
  const requests = [];
  const issued = {
    credentialId: "credential-1",
    clientId: "tc_test",
    clientSecret: "sec_test",
    createdAt: "2026-09-04T00:00:00Z",
    permissions: ["monkeypay:transactions:read"],
  };
  const client = createClient({
    envKey: "pk_test",
    clientId: "ec_test",
    clientSecret: "environment-secret",
    httpAdapter: {
      async request(request) {
        requests.push(request);
        const tokenRequest = request.url.endsWith("/env/oauth/token");
        return new globalThis.Response(
          JSON.stringify(
            tokenRequest
              ? { access_token: "environment-token", token_type: "Bearer", expires_in: 300 }
              : status === 201
                ? issued
                : { title: "Forbidden", status: 403 },
          ),
          {
            status: tokenRequest ? 200 : status,
            headers: { "content-type": "application/json" },
          },
        );
      },
    },
  });
  return { client, requests, issued };
}

test("creates an identifiable tenant credential with an environment token and explicit permissions", async () => {
  const { client, requests, issued } = fixture();
  const input = { description: "ERP financeiro", permissions: issued.permissions };
  const result = await client.environment.tenants.credentials.create("tenant/a b", input);
  assert.deepEqual(result, issued);
  const request = requests[1];
  assert.equal(request.url, "https://api.authyon.com/env/tenants/tenant%2Fa%20b/credentials");
  assert.equal(request.method, "POST");
  assert.equal(
    new globalThis.Headers(request.headers).get("authorization"),
    "Bearer environment-token",
  );
  assert.equal(new globalThis.Headers(request.headers).get("x-authyon-environment"), "pk_test");
  assert.deepEqual(JSON.parse(request.body), input);
  await client.environment.tenants.credentials.create("tenant-2", input);
  assert.equal(requests.filter((r) => r.url.endsWith("/env/oauth/token")).length, 1);
});

test("preserves authorization failures without retrying credential issuance", async () => {
  const { client, requests } = fixture(403);
  await assert.rejects(
    client.environment.tenants.credentials.create("tenant-1", {
      description: "ERP",
      permissions: ["monkeypay:transactions:read"],
    }),
    (error) => error instanceof AuthyonError && error.status === 403,
  );
  assert.equal(requests.length, 2);
});

test("validates the current tenant client bearer", async () => {
  const requests = [];
  const validation = {
    valid: true,
    reason: null,
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    environmentId: "environment-1",
    credentialId: "credential-1",
    clientId: "tc_test",
    permissions: ["authyon:users:read"],
  };
  const client = createClient({
    envKey: "pk_test",
    httpAdapter: {
      async request(request) {
        requests.push(request);
        const body = request.url.endsWith("/tenant/oauth/token")
          ? { access_token: "tenant-token", token_type: "Bearer", expires_in: 300 }
          : validation;
        return new globalThis.Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  });

  const tenant = client.tenant({ clientId: "tc_test", clientSecret: "tenant-secret" });
  const result = await tenant.validate();

  assert.deepEqual(result, validation);
  assert.equal(requests[0].url, "https://api.authyon.com/tenant/oauth/token");
  assert.equal(requests[1].url, "https://api.authyon.com/tenant/auth/validate");
  assert.equal(requests[1].method, "POST");
  assert.equal(
    new globalThis.Headers(requests[1].headers).get("authorization"),
    "Bearer tenant-token",
  );
  assert.equal(new globalThis.Headers(requests[1].headers).get("x-authyon-environment"), "pk_test");

  await tenant.validate();
  assert.equal(requests.filter((r) => r.url.endsWith("/tenant/oauth/token")).length, 1);
});

test("validates an existing tenant client bearer without client credentials", async () => {
  const requests = [];
  const validation = {
    valid: true,
    reason: null,
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    environmentId: "environment-1",
    credentialId: "credential-1",
    clientId: "tc_test",
    permissions: ["authyon:users:read"],
  };
  const client = createClient({
    envKey: "pk_test",
    httpAdapter: {
      async request(request) {
        requests.push(request);
        return new globalThis.Response(JSON.stringify(validation), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  });

  const result = await client.tenantAuth.validate("tenant-token", {
    clientIp: "203.0.113.10",
  });

  assert.deepEqual(result, validation);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.authyon.com/tenant/auth/validate");
  assert.equal(requests[0].method, "POST");
  const headers = new globalThis.Headers(requests[0].headers);
  assert.equal(headers.get("authorization"), "Bearer tenant-token");
  assert.equal(headers.get("x-authyon-environment"), "pk_test");
  assert.equal(headers.get("x-forwarded-for"), "203.0.113.10");
});

test("an invalid clientIp on tenantAuth.validate rejects instead of throwing synchronously", async () => {
  const client = createClient({
    envKey: "pk_test",
    httpAdapter: {
      async request() {
        throw new Error("should not reach the network");
      },
    },
  });

  let result;
  assert.doesNotThrow(() => {
    result = client.tenantAuth.validate("tenant-token", { clientIp: "1.2.3.4, 10.0.0.1" });
  });
  await assert.rejects(result, /clientIp/);
});
