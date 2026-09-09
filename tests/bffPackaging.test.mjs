import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("BFF is available through its ESM public package export", async () => {
  const bff = await import("@authyon/server/bff");
  assert.equal(typeof bff.createBffSession, "function");
  assert.equal(typeof bff.createRedisBffSessionStore, "function");
});

test("BFF is available through its CommonJS public package export on Node 24", () => {
  const require = createRequire(import.meta.url);
  const bff = require("@authyon/server/bff");
  assert.equal(typeof bff.createBffSession, "function");
});

test("the BFF export refuses the browser condition", () => {
  const result = spawnSync(
    globalThis.process.execPath,
    ["--conditions=browser", "--input-type=module", "--eval", 'import "@authyon/server/bff";'],
    { encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /browser/i);
});
