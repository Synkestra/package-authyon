import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "../packages/server/dist/index.js";

test("lists tenant credential metadata using the environment identity", async () => {
  const requests = [];
  const credentials = [
    {
      id: "credential-1",
      clientId: "tc_test",
      description: "ERP",
      createdAt: "2026-09-04T12:00:00Z",
      lastUsedAt: null,
      revokedAt: null,
      expiresAt: null,
      isActive: true,
      permissions: ["monkeypay:transactions:read"],
    },
  ];
  const client = createClient({
    envKey: "pk_test",
    clientId: "ec_test",
    clientSecret: "test-secret",
    httpAdapter: {
      async request(request) {
        requests.push(request);
        return new globalThis.Response(
          JSON.stringify(
            request.url.endsWith("/env/oauth/token")
              ? { access_token: "environment-token", token_type: "Bearer", expires_in: 300 }
              : credentials,
          ),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    },
  });
  assert.deepEqual(await client.environment.tenants.credentials.list("tenant/a b"), credentials);
  assert.equal(requests[1].method, "GET");
  assert.equal(requests[1].url, "https://api.authyon.com/env/tenants/tenant%2Fa%20b/credentials");
  assert.equal(
    new globalThis.Headers(requests[1].headers).get("authorization"),
    "Bearer environment-token",
  );
});
