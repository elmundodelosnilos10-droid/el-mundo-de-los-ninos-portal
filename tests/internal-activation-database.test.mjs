import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(readFileSync(new URL("../lib/supabase/internal-activation-database.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const environment = { SUPABASE_URL: "https://school.example.invalid", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic" };
const session = { id: "a1000000-0000-4000-8000-000000000002", email: "teacher@example.invalid", role: "docente", nonce: "a9000000-0000-4000-8000-000000000002", accessToken: "synthetic-user-jwt", expiresAt: Date.now() + 600_000 };
function harness(reply) {
  const events = []; const fixtureModule = { exports: {} };
  vm.runInNewContext(source, { module: fixtureModule, exports: fixtureModule.exports, require: name => {
    assert.equal(name, "./database");
    return { createSchoolDatabaseClient: config => {
      assert.equal(config, environment);
      return { rpc: async (jwt, name, args) => { events.push({ jwt, name, args: JSON.parse(JSON.stringify(args)) }); if (reply instanceof Error) throw reply; return { data: reply }; } };
    } };
  } });
  return { ...fixtureModule.exports, events };
}

test("activation claim sends only the own-user JWT and nonce to the atomic RPC", async () => {
  const h = harness([{ claimed: true }]);
  assert.equal(await h.claimInternalActivation(environment, session), true);
  assert.deepEqual(h.events, [{ jwt: session.accessToken, name: "school_claim_internal_activation", args: { p_invitation_nonce: session.nonce } }]);
});
test("an already consumed claim is a valid denial, never a password permission", async () => {
  assert.equal(await harness([{ claimed: false }]).claimInternalActivation(environment, session), false);
});
test("missing, malformed, plural or expanded claim receipts fail closed", async () => {
  for (const data of [[], [{}], [{ claimed: "true" }], [{ claimed: true, id: session.id }], [{ claimed: true }, { claimed: true }]]) await assert.rejects(harness(data).claimInternalActivation(environment, session));
});
test("uncertain database errors cannot be interpreted as a successful claim", async () => {
  await assert.rejects(harness(new Error("synthetic uncertainty")).claimInternalActivation(environment, session));
});
test("readiness uses the administrator JWT before any identity provisioning", async () => {
  const h = harness([{ ready: true, version: 32 }]);
  assert.equal(await h.isInternalActivationDatabaseReady(environment, "synthetic-administrator-jwt"), true);
  assert.deepEqual(h.events, [{ jwt: "synthetic-administrator-jwt", name: "school_internal_activation_ready", args: {} }]);
});
test("readiness requires the exact migration version and response shape", async () => {
  for (const data of [[], [{}], [{ ready: true }], [{ ready: true, version: 31 }], [{ ready: "true", version: 32 }], [{ ready: false, version: 32 }], [{ ready: true, version: 32, extra: true }], [{ ready: true, version: 32 }, { ready: true, version: 32 }]]) assert.equal(await harness(data).isInternalActivationDatabaseReady(environment, "synthetic-administrator-jwt"), false);
});
test("a missing readiness RPC fails closed", async () => {
  await assert.rejects(harness(new Error("synthetic unapplied migration")).isInternalActivationDatabaseReady(environment, "synthetic-administrator-jwt"));
});
