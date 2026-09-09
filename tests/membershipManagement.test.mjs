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
        return globalThis.Response.json({ ok: true });
      },
    },
  });
  return { client, requests };
}
test("workspace invitations, revocation and membership lifecycle use platform endpoints", async () => {
  const { client, requests } = fixture();
  const platform = client.platform("platform-token");
  await platform.workspaces.team("ws/a");
  await platform.workspaces.members.invite("ws/a", {
    email: "person@example.com",
    role: "auditor",
  });
  await platform.workspaces.invites.revoke("ws/a", "invite/a");
  await platform.workspaces.members.changeRole("ws/a", "member/a", "admin");
  await platform.workspaces.members.remove("ws/a", "member/a");
  await platform.auth.stepUp("current-password");
  assert.deepEqual(
    requests.map((r) => [r.method, new globalThis.URL(r.url).pathname]),
    [
      ["GET", "/platform/workspaces/ws%2Fa/team"],
      ["POST", "/platform/workspaces/ws%2Fa/invites"],
      ["DELETE", "/platform/workspaces/ws%2Fa/invites/invite%2Fa"],
      ["PATCH", "/platform/workspaces/ws%2Fa/members/member%2Fa"],
      ["DELETE", "/platform/workspaces/ws%2Fa/members/member%2Fa"],
      ["POST", "/platform/auth/step-up"],
    ],
  );
  assert.deepEqual(JSON.parse(requests[1].body), { email: "person@example.com", role: "auditor" });
  assert.deepEqual(JSON.parse(requests[5].body), { currentPassword: "current-password" });
  await assert.rejects(
    async () => platform.workspaces.members.invite("ws", { email: "x@y.com", role: "owner" }),
    TypeError,
  );
  assert.equal(requests.length, 6);
});
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
  const scope = { workspaceId: "ws", environmentId: "env", tenantId: "tenant" };
  await client.platform("platform-token").tenants.members.add(scope, "user-id", ["reader"]);
  await client.platform("platform-token").tenants.members.remove(scope, "user-id");
  assert.deepEqual(JSON.parse(requests[3].body), { userId: "user-id", roles: ["reader"] });
  assert.equal(requests[4].method, "DELETE");
});
test("invitation redemption is anonymous and never logs bearer invitation paths or passwords", async () => {
  const events = [],
    requests = [];
  const client = createClient({
    clientId: "ec",
    clientSecret: "machine-secret",
    envKey: "pk_test",
    httpLogger: { enabled: true, logger: (event) => events.push(event) },
    httpAdapter: {
      async request(request) {
        requests.push(request);
        return globalThis.Response.json({ ok: true });
      },
    },
  });
  await client.workspaceInvites.preview("sensitive-token");
  await client.workspaceInvites.accept("sensitive-token", {
    name: "Person",
    password: "sensitive-password",
  });
  for (const request of requests) {
    assert.equal(new globalThis.Headers(request.headers).get("authorization"), null);
    assert.equal(new globalThis.Headers(request.headers).get("x-authyon-environment"), null);
  }
  assert.ok(events.length > 0);
  assert.ok(!JSON.stringify(events).includes("sensitive-token"));
  assert.ok(!JSON.stringify(events).includes("sensitive-password"));
  assert.ok(JSON.stringify(events).includes("REDACTED"));
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
test("logging removes invitation token, query, fragment and URL credentials", async () => {
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
    url: "https://user:password@api.authyon.com/platform/workspace-invites/secret-token/accept?token=secret-query#secret-fragment",
    method: "POST",
    headers: {},
  });
  assert.ok(!/secret-|password|user:/.test(JSON.stringify(events)));
});
