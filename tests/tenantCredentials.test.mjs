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
