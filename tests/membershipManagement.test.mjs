import assert from "node:assert/strict";
import test from "node:test";
import {
  createClient,
  FetchHttpAdapter,
  LoggingHttpAdapter,
} from "../packages/server/dist/index.js";
function fixture() {
  const requests = [];
  const client = createClient({
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
  return { client, requests };
}
test("tenant email invitations use user identity; machine membership adds existing user by id", async () => {
  const { client, requests } = fixture();
  const user = client.user(async () => "user-token");
  await user.tenants.members.invite("tenant/a", { email: "person@example.com", roles: ["reader"] });
  await user.tenants.members.list("tenant/a", { skip: 10, take: 10 });
  await user.tenants.members.remove("tenant/a", "user/a");
  assert.equal(requests[0].url, "https://api.authyon.com/auth/tenants/tenant%2Fa/members");
  assert.deepEqual(JSON.parse(requests[0].body), {
    email: "person@example.com",
    roles: ["reader"],
  });
  for (const request of requests) {
    assert.equal(new globalThis.Headers(request.headers).get("authorization"), "Bearer user-token");
    assert.equal(new globalThis.Headers(request.headers).get("x-authyon-environment"), "pk_test");
  }
  await client.environment.tenants.members.add("tenant", "user-id", ["reader"]);
  await client.environment.tenants.members.remove("tenant", "user-id");
  assert.deepEqual(JSON.parse(requests[4].body), { userId: "user-id", roles: ["reader"] });
  assert.equal(requests[5].method, "DELETE");
  for (const request of requests.slice(4)) {
    assert.equal(
      new globalThis.Headers(request.headers).get("authorization"),
      "Bearer environment-token",
    );
    assert.equal(new globalThis.Headers(request.headers).get("x-authyon-environment"), "pk_test");
  }
});
test("default fetch prevents redirect replay of credentials", async () => {
  let options;
  const adapter = new FetchHttpAdapter(async (_url, init) => {
    options = init;
    return globalThis.Response.json({});
  });
  await adapter.request({
    url: "https://api.authyon.com/env/oauth/token",
    method: "POST",
    headers: {},
    body: "secret",
  });
  assert.equal(options.redirect, "error");
});
test("logging removes path tokens, query, fragment and URL credentials", async () => {
  const events = [];
  const adapter = new LoggingHttpAdapter(
    {
      async request() {
        return globalThis.Response.json({});
      },
    },
    { enabled: true, logger: (event) => events.push(event) },
  );
  await adapter.request({
    url: "https://user:password@api.authyon.com/auth/callback?token=secret-query#secret-fragment",
    method: "POST",
    headers: {},
  });
  assert.ok(!/secret-|password|user:/.test(JSON.stringify(events)));
});
