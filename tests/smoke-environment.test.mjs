import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createSmokeEnvironment } from "../scripts/smoke-environment.mjs";

test("smoke runtime replaces inherited preview registry and log paths", () => {
  const parent = { PATH: "/synthetic/bin", SITES_RUNTIME_ROOT: "/live", WRANGLER_REGISTRY_PATH: "/live/a", MINIFLARE_REGISTRY_PATH: "/live/b", WRANGLER_LOG_PATH: "/live/c", WRANGLER_WRITE_LOGS: "true" };
  const result = createSmokeEnvironment("/disposable/run", parent);
  assert.equal(result.PATH, parent.PATH);
  assert.equal(result.SITES_RUNTIME_ROOT, path.join("/disposable/run", "runtime"));
  for (const name of ["WRANGLER_REGISTRY_PATH", "MINIFLARE_REGISTRY_PATH", "WRANGLER_LOG_PATH"]) {
    assert.ok(result[name].startsWith(result.SITES_RUNTIME_ROOT + path.sep));
    assert.notEqual(result[name], parent[name]);
  }
  assert.equal(result.WRANGLER_WRITE_LOGS, "false");
  assert.equal(result.WRANGLER_SEND_METRICS, "false");
  assert.equal(result.CLOUDFLARE_CF_FETCH_ENABLED, "false");
  assert.equal(parent.SITES_RUNTIME_ROOT, "/live");
});

test("independent smoke runs cannot discover each other's registry", () => {
  const left = createSmokeEnvironment("/disposable/left", {});
  const right = createSmokeEnvironment("/disposable/right", left);
  assert.notEqual(left.WRANGLER_REGISTRY_PATH, right.WRANGLER_REGISTRY_PATH);
  assert.notEqual(left.MINIFLARE_REGISTRY_PATH, right.MINIFLARE_REGISTRY_PATH);
});
