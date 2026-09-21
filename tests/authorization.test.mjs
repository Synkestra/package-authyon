import assert from "node:assert/strict";
import test from "node:test";

import {
  AuthyonAbilityBuilder,
  createAuthyonAbility,
  hasPermission,
  hasPermissionGroup,
} from "../packages/auth/dist/index.js";
import { createAuthyonAbility as createServerAbility } from "../packages/server/dist/index.js";

test("creates deny-by-default abilities from Authyon permissions", () => {
  const ability = createAuthyonAbility({
    permissions: ["tickets:read", "reports:*"],
  });

  assert.equal(ability.can("read", "tickets"), true);
  assert.equal(ability.can("update", "tickets"), false);
  assert.equal(ability.can("read", "reports"), true);
  assert.equal(ability.can("delete", "reports"), true);
  assert.equal(ability.cannot("delete", "tickets"), true);
});

test("supports wildcards in namespaced permission segments", () => {
  const source = { permissions: ["monkeypay:*:*"] };
  const ability = createAuthyonAbility(source);

  assert.equal(ability.can("read", "monkeypay:wallets"), true);
  assert.equal(ability.can("write", "monkeypay:routing-rules"), true);
  assert.equal(ability.can("read", "another:wallets"), false);
  assert.equal(hasPermission(source, "monkeypay:wallets:read"), true);
  assert.equal(hasPermission(source.permissions, "monkeypay:wallets:read"), true);
  assert.equal(hasPermission(source, "another:wallets:read"), false);
});

test("evaluates allOf and anyOf permission groups", () => {
  const source = {
    permissions: ["split.rules:read", "split.payments:*"],
  };

  assert.equal(
    hasPermissionGroup(source, {
      allOf: ["split.rules:read", "split.payments:create"],
      anyOf: ["split.audit:read", "split.payments:update"],
    }),
    true,
  );
  assert.equal(
    hasPermissionGroup(source, {
      allOf: ["split.rules:read", "split.audit:read"],
    }),
    false,
  );
  assert.equal(hasPermissionGroup(source, {}), true);
});

test("supports conditions, fields, inverted rules and last-rule precedence", () => {
  const ability = createAuthyonAbility(
    { permissions: ["documents:update"] },
    {
      rules: [
        {
          action: "update",
          subject: "documents",
          inverted: true,
          conditions: { locked: true },
          reason: "Locked documents cannot be changed",
        },
        {
          action: "update",
          subject: "profiles",
          fields: ["name", "address.*"],
          conditions: { ownerId: "user-1" },
        },
      ],
    },
  );

  assert.equal(ability.can("update", { __type: "documents", locked: false }), true);
  assert.equal(ability.can("update", { __type: "documents", locked: true }), false);
  assert.equal(
    ability.can("update", { __type: "profiles", ownerId: "user-1" }, "address.city"),
    true,
  );
  assert.equal(ability.can("update", { __type: "profiles", ownerId: "user-1" }, "email"), false);
});

test("maps Authyon roles and OAuth scopes and updates abilities dynamically", () => {
  const ability = createServerAbility(
    { scope: "audit:read", roles: ["support"] },
    {
      roleRules: {
        support: [{ action: "read", subject: "tickets" }],
      },
    },
  );
  let updates = 0;
  const unsubscribe = ability.on("updated", () => updates++);

  assert.equal(ability.can("read", "audit"), true);
  assert.equal(ability.can("read", "tickets"), true);
  ability.update([{ action: "manage", subject: "all" }]);
  assert.equal(ability.can("delete", "anything"), true);
  assert.equal(updates, 1);
  unsubscribe();
});

test("provides a CASL-like fluent builder", () => {
  const ability = new AuthyonAbilityBuilder()
    .can("read", "articles")
    .can("update", "articles", { authorId: "user-1" })
    .cannot("delete", "articles", { published: true })
    .build();

  assert.equal(ability.can("read", "articles"), true);
  assert.equal(ability.can("update", { __type: "articles", authorId: "user-1" }), true);
  assert.equal(ability.can("update", { __type: "articles", authorId: "user-2" }), false);
  assert.equal(ability.can("delete", { __type: "articles", published: true }), false);
});
