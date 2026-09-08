import assert from "node:assert/strict";
import test from "node:test";

import { PermissionGuard } from "../packages/server/dist/next.js";

function clientWithPermissions(permissions) {
  return {
    async validate(token) {
      return {
        valid: token === "valid-token",
        user: token === "valid-token" ? { id: "user-1", permissions } : undefined,
      };
    },
  };
}

test("server PermissionGuard renders children when the token has permission", async () => {
  const result = await PermissionGuard({
    client: clientWithPermissions(["reports:read"]),
    token: "valid-token",
    action: "read",
    subject: "reports",
    children: "private reports",
  });

  assert.equal(result, "private reports");
});

test("server PermissionGuard renders unauthenticated fallback without a valid token", async () => {
  const result = await PermissionGuard({
    client: clientWithPermissions(["reports:read"]),
    token: null,
    action: "read",
    subject: "reports",
    children: "private reports",
    unauthenticatedFallback: ({ error }) => error.code,
  });

  assert.equal(result, "authorization.unauthenticated");
});

test("server PermissionGuard renders forbidden fallback when permission is missing", async () => {
  const result = await PermissionGuard({
    client: clientWithPermissions(["tickets:read"]),
    token: "valid-token",
    action: "read",
    subject: "reports",
    children: "private reports",
    forbiddenFallback: "forbidden",
  });

  assert.equal(result, "forbidden");
});
