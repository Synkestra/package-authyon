import assert from "node:assert/strict";
import test from "node:test";
import { createClient, createMemoryStorage } from "../packages/auth/dist/index.js";

test("organization list forwards search and pagination filters", async () => {
  const requestedUrls = [];
  const organizations = [{ id: "tenant-1", slug: "acme", name: "Acme" }];
  const httpAdapter = {
    async request(request) {
      requestedUrls.push(request.url);
      return new globalThis.Response(JSON.stringify(organizations), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  };
  const storage = createMemoryStorage();
  storage.set({
    accessToken: "access",
    refreshToken: "refresh",
    expiresIn: 60,
    expiresAt: Date.now() + 60_000,
  });
  const client = createClient({
    envKey: "pk_test",
    httpAdapter,
    storage,
  });

  const result = await client.organization.list({
    search: "acme company",
    skip: 20,
    take: 20,
  });

  assert.deepEqual(result, organizations);
  assert.equal(
    requestedUrls.includes(
      "https://api.authyon.com/auth/tenants?search=acme+company&skip=20&take=20",
    ),
    true,
  );
});
