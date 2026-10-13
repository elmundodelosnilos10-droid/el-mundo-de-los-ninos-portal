import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { webcrypto } from "node:crypto";
import { reissueInternalActivation, InternalActivationReissueError } from "../lib/supabase/internal-activation-reissue.ts";
import { readInternalActivationCode } from "../lib/supabase/internal-activation.ts";

const actorId = "a1000000-0000-4000-8000-000000000001", targetId = "a1000000-0000-4000-8000-000000000002", oldNonce = "a9000000-0000-4000-8000-000000000002";
const secret = "synthetic-private-reissue-key-20261012-abcdefghijklmnopqrstuvwxyz";
const email = "pending-teacher@example.invalid", hash = "a".repeat(56);
const actor = { id: actorId, roles: ["direccion"], supabaseAuth: { userId: actorId, accessToken: "synthetic-leader-jwt" } };
function fixture(overrides = {}) {
  const state = { events: [], ...overrides };
  const db = { rpc: async (jwt, name, fields) => {
    state.events.push({ operation: name, jwt, fields });
    if (name === "school_begin_internal_activation_reissue") {
      if (state.beginError) throw state.beginError;
      state.nonce = fields.p_replacement_nonce;
      return { data: state.beginData ?? [{ reserved: true, id: targetId, name: "Docente pendiente", email, role: "docente", nonce: state.nonce, previousNonce: oldNonce, inviterId: actorId, ...state.reservationChanges }] };
    }
    if (state.finishError) throw state.finishError;
    return { data: state.finishData ?? [{ finished: true, id: targetId, email, role: "docente", nonce: state.nonce }] };
  } };
  const original = () => ({ id: targetId, email, invited_at: "2026-10-12T12:00:00Z", email_confirmed_at: null, last_sign_in_at: null, app_metadata: { provider: "email", unrelated: "preserved", school_invitation_receipt: { email, nonce: oldNonce, role: "docente", inviter_id: actorId, delivery: "internal" } } });
  const auth = { admin: {
    generateInviteLink: async body => { state.events.push({ operation: "generate", body }); if (state.generateError) throw state.generateError; return { user: state.generatedUser ?? original(), tokenHash: state.hash ?? hash }; },
    updateUser: async (id, body) => { state.events.push({ operation: "stamp", id, body }); if (state.stampError) throw state.stampError; return state.stampedUser ?? { ...original(), app_metadata: body.app_metadata }; },
  } };
  return { state, run: (selectedActor = actor, target = targetId, selectedSecret = secret) => (state.implementation ?? reissueInternalActivation)(() => { state.events.push({ operation: "authFactory" }); return auth; }, db, selectedActor, target, selectedSecret) };
}
const fails = expected => error => error instanceof InternalActivationReissueError && error.code === expected;

test("pending reissue reserves before Auth, preserves UUID/roles and returns only a code after the confirmed finalization", async () => {
  const f = fixture();
  const result = await f.run();
  assert.deepEqual(f.state.events.map(item => item.operation), ["school_begin_internal_activation_reissue", "authFactory", "generate", "stamp", "school_finish_internal_activation_reissue"]);
  assert.deepEqual(f.state.events[2].body, { email });
  const stamp = f.state.events[3];
  assert.equal(stamp.id, targetId);
  assert.deepEqual(Object.keys(stamp.body), ["app_metadata"]);
  assert.equal(stamp.body.app_metadata.provider, "email");
  assert.equal(stamp.body.app_metadata.unrelated, "preserved");
  assert.equal(stamp.body.app_metadata.school_invitation_receipt.nonce, f.state.nonce);
  assert.equal(stamp.body.app_metadata.school_invitation_receipt.inviter_id, actorId);
  assert.equal(JSON.stringify(result).includes(hash), false);
  assert.equal(JSON.stringify(result).includes("synthetic-leader-jwt"), false);
  const decoded = await readInternalActivationCode(result.activation.code, email, secret);
  assert.equal(decoded.id, targetId); assert.equal(decoded.nonce, f.state.nonce); assert.equal(decoded.tokenHash, hash);
  assert.equal(result.activation.activationPath, "/activar-cuenta");
  assert.ok(f.state.events.filter(item => item.jwt).every(item => item.jwt === "synthetic-leader-jwt"));
});

test("ineligible existing accounts never construct Auth clients or regenerate credentials", async () => {
  const f = fixture({ beginData: [{ reserved: false }] });
  await assert.rejects(f.run(), fails("not_pending"));
  assert.deepEqual(f.state.events.map(item => item.operation), ["school_begin_internal_activation_reissue"]);
});

test("unknown reservation replies and database failures do not call Auth or attempt rollback", async () => {
  for (const state of [{ beginError: Error("synthetic-private-error") }, { beginData: [] }, { beginData: [{ reserved: true }] }, { beginData: [{ reserved: false, unexpected: true }] }]) {
    const f = fixture(state); await assert.rejects(f.run(), fails("reissue_uncertain"));
    assert.equal(f.state.events.length, 1);
  }
});

test("malformed, protected or mismatched reservation identities fail before credential generation", async () => {
  for (const reservationChanges of [{ id: actorId }, { nonce: oldNonce }, { previousNonce: "wrong" }, { inviterId: "wrong" }, { inviterId: targetId }, { role: "superadmin" }, { role: "direccion" }, { email: "Other@Example.invalid" }, { email: "wrong" }, { name: "x" }]) {
    const f = fixture({ reservationChanges }); await assert.rejects(f.run(), fails("reissue_uncertain"));
    assert.equal(f.state.events.length, 1);
  }
});

test("unprivileged actors, self, mismatched actor identity and provider keys fail before SQL", async () => {
  for (const selectedActor of [{ ...actor, roles: ["tutor"] }, { ...actor, supabaseAuth: null }, { ...actor, supabaseAuth: { ...actor.supabaseAuth, userId: targetId } }]) {
    const f = fixture(); await assert.rejects(f.run(selectedActor), fails("forbidden")); assert.equal(f.state.events.length, 0);
  }
  for (const target of [actorId, "invalid"]) { const f = fixture(); await assert.rejects(f.run(actor, target), fails("forbidden")); assert.equal(f.state.events.length, 0); }
  const f = fixture(); await assert.rejects(f.run(actor, targetId, "sb_secret_synthetic-not-an-activation-key"), fails("unavailable")); assert.equal(f.state.events.length, 0);
});

test("unexpected UUID or email returned by generation cannot modify any account", async () => {
  for (const user of [{ id: actorId, email }, { id: targetId, email: "other@example.invalid" }]) {
    const f = fixture({ generatedUser: user }); await assert.rejects(f.run(), fails("reissue_uncertain"));
    assert.equal(f.state.events.some(item => item.operation === "stamp"), false);
    assert.equal(f.state.events.some(item => item.operation === "school_finish_internal_activation_reissue"), false);
  }
});

test("confirmed, previously signed in, completed or changed receipts cannot be stamped or finalized", async () => {
  const base = { id: targetId, email, invited_at: "2026-10-12T12:00:00Z", app_metadata: { school_invitation_receipt: { email, nonce: oldNonce, role: "docente", inviter_id: actorId, delivery: "internal" } } };
  for (const user of [{ ...base, email_confirmed_at: "2026-10-12T12:01:00Z" }, { ...base, last_sign_in_at: "2026-10-12T12:01:00Z" }, { ...base, invited_at: "invalid" }, { ...base, app_metadata: { ...base.app_metadata, school_activation_completed_nonce: oldNonce } }, { ...base, app_metadata: { school_invitation_receipt: { ...base.app_metadata.school_invitation_receipt, delivery: "email" } } }, { ...base, app_metadata: { school_invitation_receipt: { ...base.app_metadata.school_invitation_receipt, nonce: targetId } } }]) {
    const f = fixture({ generatedUser: user }); await assert.rejects(f.run(), fails("reissue_uncertain")); assert.equal(f.state.events.some(item => item.operation === "stamp"), false);
  }
});

test("generation or stamping uncertainty leaves the reservation blocked without recovery or old-code restoration", async () => {
  for (const state of [{ generateError: Error("private") }, { stampError: Error("private") }, { hash: "invalid" }, { stampedUser: { id: actorId, email } }]) {
    const f = fixture(state); await assert.rejects(f.run(), fails("reissue_uncertain"));
    assert.equal(f.state.events.some(item => item.operation === "school_finish_internal_activation_reissue"), false);
    assert.equal(f.state.events.filter(item => item.operation.includes("begin")).length, 1);
  }
});

test("failed or mismatched finalization cannot return a new code and never reopens or repeats its reservation", async () => {
  for (const state of [{ finishError: Error("private") }, { finishData: [{ finished: false }] }, { finishData: [{ finished: true, id: actorId, email, role: "docente", nonce: oldNonce }] }]) {
    const f = fixture(state); await assert.rejects(f.run(), fails("reissue_uncertain"));
    assert.equal(f.state.events.length, 5);
    assert.equal(f.state.events.filter(item => item.operation === "stamp").length, 1);
  }
});

test("a local sealing failure occurs before finalization and cannot reopen the reserved invitation", async () => {
  const source = ts.transpileModule(readFileSync(new URL("../lib/supabase/internal-activation-reissue.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const sandboxModule = { exports: {} };
  vm.runInNewContext(source, { module: sandboxModule, exports: sandboxModule.exports, crypto: webcrypto, Date, require: name => {
    assert.equal(name, "./internal-activation.ts");
    return { isInternalActivationSecret: () => true, createInternalActivationCode: async () => { throw Error("synthetic-private-cipher-detail"); } };
  } });
  const f = fixture({ implementation: sandboxModule.exports.reissueInternalActivation });
  await assert.rejects(f.run(), error => error.code === "reissue_uncertain" && !error.message.includes("synthetic-private"));
  assert.equal(f.state.events.some(event => event.operation === "school_finish_internal_activation_reissue"), false);
  assert.equal(f.state.events.length, 4);
});

test("SQL reservation/finalization retain durable guards and never change Auth credentials or grant table access", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261102000000_school_internal_activation_reissue.sql", import.meta.url), "utf8");
  assert.equal((sql.match(/create function public\./g) ?? []).length, 2);
  assert.equal((sql.match(/coalesce\(v_auth.encrypted_password, ''\) <> ''/g) ?? []).length, 2);
  assert.equal((sql.match(/v_auth.email_confirmed_at is not null/g) ?? []).length, 2);
  assert.equal((sql.match(/v_auth.last_sign_in_at is not null/g) ?? []).length, 2);
  assert.equal((sql.match(/v_attempt.inviter_id <> v_actor/g) ?? []).length, 2);
  assert.equal((sql.match(/where id = p_auth_user_id for update/g) ?? []).length, 4);
  assert.match(sql, /state = 'reissuing', invitation_nonce = p_replacement_nonce/);
  assert.match(sql, /v_attempt.provisioned_at > v_now/);
  assert.match(sql, /v_attempt.provisioned_at <= v_now - interval '5 minutes'/);
  assert.match(sql, /created_at = v_attempt.provisioned_at/);
  assert.equal((sql.match(/grant execute.*to authenticated/g) ?? []).length, 2);
  assert.doesNotMatch(sql, /update auth\.users|delete from|grant .*on table|grant execute.*to (?:anon|service_role)/);
  const fixtureSource = readFileSync(new URL("./supabase-internal-activation-reissue.integration.sql", import.meta.url), "utf8");
  assert.ok(fixtureSource.trim().endsWith("rollback;"));
});
