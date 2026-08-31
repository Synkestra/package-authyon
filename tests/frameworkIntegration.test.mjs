import assert from "node:assert/strict";
import test from "node:test";

import {
  AuthorizationError,
  createAuthorizationErrorResponse,
  authorizeRequest,
  createExpressAuthorizationMiddleware,
  normalizeClientIp,
} from "../packages/server/dist/index.js";

test("validates a single client IP and blocks forwarded-header injection", () => {
  assert.equal(normalizeClientIp("::ffff:203.0.113.1"), "::ffff:203.0.113.1");
  assert.equal(normalizeClientIp("203.0.113.1"), "203.0.113.1");
  assert.throws(() => normalizeClientIp("203.0.113.1, 10.0.0.1"), /single valid/);
  assert.throws(() => normalizeClientIp("203.0.113.1\r\nX-Evil: true"), /single valid/);
});

const client = {
  contexts: [],
  async validate(token, context) {
    this.contexts.push(context);
    return token === "valid"
      ? { valid: true, user: { id: "user-1", permissions: ["reports:read"] } }
      : { valid: false, user: null };
  },
};

test("authorizes Next.js and Fetch Request handlers", async () => {
  const request = new globalThis.Request("https://app.example.com/api/reports", {
    headers: { authorization: "Bearer valid" },
  });
  const context = await authorizeRequest(client, request, {
    requirement: { action: "read", subject: "reports" },
    resolveClientIp: () => "203.0.113.10",
  });
  assert.equal(context.userId, "user-1");
  assert.equal(context.ability.can("read", "reports"), true);
  assert.equal(client.contexts.at(-1).clientIp, "203.0.113.10");
  await assert.rejects(
    authorizeRequest(client, request, {
      requirement: { action: "delete", subject: "reports" },
    }),
    (error) => error instanceof AuthorizationError && error.status === 403,
  );
});

test("provides dependency-free Express middleware", async () => {
  const middleware = createExpressAuthorizationMiddleware(client, {
    requirement: { action: "read", subject: "reports" },
  });
  const request = {
    headers: {
      authorization: "Bearer valid",
      "x-forwarded-for": "198.51.100.99",
    },
    socket: { remoteAddress: "::ffff:203.0.113.20" },
  };
  let nextCalled = false;
  await middleware(
    request,
    { status: () => ({ json: () => undefined }), json: () => undefined },
    () => {
      nextCalled = true;
    },
  );
  assert.equal(nextCalled, true);
  assert.equal(request.authyon.userId, "user-1");
  assert.equal(client.contexts.at(-1).clientIp, "203.0.113.20");
});

test("uses proxy-aware IP only when explicitly trusted", async () => {
  const middleware = createExpressAuthorizationMiddleware(client, { trustProxy: true });
  await middleware(
    {
      headers: { authorization: "Bearer valid" },
      ip: "198.51.100.30",
      socket: { remoteAddress: "10.0.0.5" },
    },
    { status: () => ({ json: () => undefined }), json: () => undefined },
    () => undefined,
  );
  assert.equal(client.contexts.at(-1).clientIp, "198.51.100.30");
});

test("normalizes authorization errors without exposing tokens", async () => {
  const middleware = createExpressAuthorizationMiddleware(client);
  let status;
  let body;
  await middleware(
    { headers: { authorization: "Bearer invalid" } },
    {
      status(value) {
        status = value;
        return this;
      },
      json(value) {
        body = value;
      },
    },
    () => undefined,
  );
  assert.equal(status, 401);
  assert.doesNotMatch(JSON.stringify(body), /invalid/);
  const response = createAuthorizationErrorResponse(
    new AuthorizationError(403, "authorization.forbidden", "Permission denied"),
  );
  assert.equal(response.status, 403);
});
