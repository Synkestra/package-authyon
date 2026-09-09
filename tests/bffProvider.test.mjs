import assert from "node:assert/strict";
import test from "node:test";
import { AuthyonError } from "../packages/server/dist/index.js";
import { createAuthyonBffProvider } from "../packages/server/dist/bff.js";

function fixture(responses) {
  const requests = [];
  const validator = { validate: async () => ({ valid: true, user: { id: "alice" } }) };
  const provider = createAuthyonBffProvider({
    envKey: "pk_test",
    validator,
    httpAdapter: {
      request: async (request) => {
        requests.push(request);
        return globalThis.Response.json(responses.shift());
      },
    },
  });
  return { provider, requests, validator };
}

const tokens = { accessToken: "access", refreshToken: "refresh", expiresIn: 60 };

test("BFF provider reuses Authyon token endpoints and tenant wire naming", async () => {
  const f = fixture([
    { tokens },
    tokens,
    { tokens },
    {
      id: "alice",
      email: "alice@example.com",
      tenant: { id: "tenant-b", slug: "b" },
      refreshToken: "private",
    },
    {},
  ]);
  await f.provider.login({
    email: "alice@example.com",
    password: "password",
    organizationSlug: "a",
  });
  await f.provider.refresh("refresh");
  await f.provider.switchOrganization("access", "b");
  const profile = await f.provider.profile("access");
  await f.provider.logout("refresh");
  assert.deepEqual(
    f.requests.map((request) => new globalThis.URL(request.url).pathname),
    ["/auth/login", "/auth/refresh", "/auth/switch-tenant", "/auth/me", "/auth/logout"],
  );
  assert.equal(JSON.parse(f.requests[0].body).tenantSlug, "a");
  assert.equal(f.requests[2].headers.authorization, "Bearer access");
  assert.equal(profile.organization.slug, "b");
  assert.equal(profile.refreshToken, undefined);
});

test("BFF requires an explicit upstream token lifetime", async () => {
  for (const expiresIn of [undefined, 0, -1, "60"]) {
    const f = fixture([{ ...tokens, expiresIn }]);
    await assert.rejects(f.provider.refresh("refresh"), {
      code: "provider.missing_token_lifetime",
    });
  }
});

test("BFF projects only documented two-factor challenge fields", async () => {
  const f = fixture([
    { twoFactor: { challengeToken: "challenge", methods: ["email"], accessToken: "private" } },
  ]);
  assert.deepEqual(await f.provider.login({ email: "alice", password: "password" }), {
    twoFactorRequired: true,
    challengeToken: "challenge",
    methods: ["email"],
  });
});

test("validation caller rejection remains provider failure, not user logout", async () => {
  const f = fixture([]);
  f.validator.validate = async () => {
    throw new AuthyonError(401, {});
  };
  await assert.rejects(f.provider.validate("access"), {
    code: "provider.validation_unavailable",
    status: 503,
    clearCookie: false,
  });
});

test("machine tokens and malformed validation responses cannot establish a user session", async () => {
  const f = fixture([]);
  f.validator.validate = async () => ({ valid: true, user: null });
  assert.equal(await f.provider.validate("machine"), false);
  f.validator.validate = async () => ({ valid: true });
  assert.equal(await f.provider.validate("unknown"), false);
});
