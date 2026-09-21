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

test("environment tenant creation forwards custom fields and metadata", async () => {
  const requests = [];
  const created = {
    id: "tenant-1",
    slug: "acme",
    name: "Acme",
    customFields: JSON.stringify({ cnpj: "00.000.000/0001-00" }),
    publicMetadata: JSON.stringify({ logo: "logo.png" }),
    privateMetadata: JSON.stringify({ billingId: "cus_123" }),
  };
  const client = createClient({
    envKey: "pk_test",
    clientId: "client",
    clientSecret: "secret",
    httpAdapter: {
      async request(request) {
        requests.push(request);
        if (request.url.endsWith("/env/oauth/token")) {
          return globalThis.Response.json({
            access_token: "machine",
            token_type: "Bearer",
            expires_in: 300,
          });
        }
        return globalThis.Response.json(created, { status: 201 });
      },
    },
  });

  const result = await client.environment.tenants.create({
    name: "Acme",
    slug: "acme",
    customFields: { cnpj: "00.000.000/0001-00" },
    publicMetadata: { logo: "logo.png" },
    privateMetadata: { billingId: "cus_123" },
  });

  assert.deepEqual(result, created);
  assert.deepEqual(JSON.parse(requests[1].body), {
    name: "Acme",
    slug: "acme",
    customFields: { cnpj: "00.000.000/0001-00" },
    publicMetadata: { logo: "logo.png" },
    privateMetadata: { billingId: "cus_123" },
  });
});

test("environment tenant metadata update stays on the client API", async () => {
  const requests = [];
  const client = createClient({
    envKey: "pk_test",
    clientId: "client",
    clientSecret: "secret",
    httpAdapter: {
      async request(request) {
        requests.push(request);
        if (request.url.endsWith("/env/oauth/token")) {
          return globalThis.Response.json({
            access_token: "machine",
            token_type: "Bearer",
            expires_in: 300,
          });
        }
        return new globalThis.Response(null, { status: 204 });
      },
    },
  });

  await client.environment.tenants.updateMetadata("tenant/a", {
    publicMetadata: { logo: "logo.png" },
    privateMetadata: { billingId: "cus_123" },
  });

  assert.equal(requests[1].url, "https://api.authyon.com/env/tenants/tenant%2Fa/metadata");
  assert.deepEqual(JSON.parse(requests[1].body), {
    publicMetadata: { logo: "logo.png" },
    privateMetadata: { billingId: "cus_123" },
  });
});
