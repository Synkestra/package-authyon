import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "../packages/server/dist/index.js";

test("environment tenants forwards pagination and search parameters", async () => {
  const requestedUrls = [];
  const response = {
    data: [{ id: "tenant-1", slug: "acme", name: "Acme" }],
    pageSize: 20,
    total: 1,
    pages: 1,
    hasNext: false,
    hasPrev: false,
  };
  const httpAdapter = {
    async request(request) {
      requestedUrls.push(request.url);
      if (request.url.endsWith("/env/oauth/token")) {
        return new globalThis.Response(
          JSON.stringify({ access_token: "machine", token_type: "Bearer", expires_in: 300 }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      return new globalThis.Response(JSON.stringify(response), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  };
  const client = createClient({
    envKey: "pk_test",
    clientId: "client",
    clientSecret: "secret",
    httpAdapter,
  });

  const result = await client.environment.tenants.list({
    search: "acme company",
    skip: 20,
    take: 20,
  });

  assert.deepEqual(result, response);
  assert.equal(
    requestedUrls.includes(
      "https://api.authyon.com/env/tenants?search=acme+company&skip=20&take=20",
    ),
    true,
  );
});
