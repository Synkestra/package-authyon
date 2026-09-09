import assert from "node:assert/strict";
import test from "node:test";

import {
  AuthyonSessionController,
  createClient,
  createMemoryStorage,
} from "../packages/auth/dist/index.js";

function fakeClient() {
  let session = {
    accessToken: "access",
    refreshToken: "refresh",
    expiresIn: 60,
    expiresAt: Date.now() + 60_000,
    user: { id: "user-1", email: "user@example.com", permissions: ["reports:read"] },
  };
  const listeners = new Set();
  let validations = 0;
  let refreshes = 0;
  return {
    get validations() {
      return validations;
    },
    get refreshes() {
      return refreshes;
    },
    getSession: () => session,
    onAuthStateChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async validateSession() {
      validations++;
      listeners.forEach((listener) => listener({ type: "session_validated", session }));
      return session;
    },
    async refresh() {
      refreshes++;
      session = { ...session, accessToken: `access-${refreshes}`, expiresAt: Date.now() + 60_000 };
      listeners.forEach((listener) => listener({ type: "refreshed", session }));
      return session;
    },
  };
}

test("server snapshot stays validating until browser storage is checked", () => {
  const controller = new AuthyonSessionController(fakeClient());

  assert.equal(controller.getServerSnapshot().status, "validating");
});

test("session controller validates with me before authenticating", async () => {
  const client = fakeClient();
  const controller = new AuthyonSessionController(client);
  const stop = controller.start();
  await controller.validate();

  assert.equal(controller.getSnapshot().status, "authenticated");
  assert.equal(controller.getSnapshot().user.id, "user-1");
  assert.ok(client.validations >= 1);
  stop();
});

test("session controller refreshes and validates the session again", async () => {
  const client = fakeClient();
  const controller = new AuthyonSessionController(client);
  const stop = controller.start();
  await controller.validate();
  await controller.refreshNow();

  assert.equal(client.refreshes, 1);
  assert.ok(client.validations >= 2);
  assert.equal(controller.getSnapshot().status, "authenticated");
  stop();
});

test("validateSession confirms and hydrates the user through auth me", async () => {
  const storage = createMemoryStorage();
  storage.set({
    accessToken: "access",
    refreshToken: "refresh",
    expiresIn: 60,
    expiresAt: Date.now() + 60_000,
  });
  const client = createClient({
    envKey: "pk_test",
    storage,
    httpAdapter: {
      async request(request) {
        assert.match(request.url, /\/auth\/me$/);
        assert.equal(request.headers.authorization, "Bearer access");
        return new globalThis.Response(
          JSON.stringify({ id: "user-1", email: "fresh@example.com", permissions: [] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    },
  });

  const session = await client.validateSession();
  assert.equal(session.user.email, "fresh@example.com");
  assert.equal(storage.get().user.id, "user-1");
});
