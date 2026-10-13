import assert from "node:assert/strict";
import test from "node:test";
import { createSupabaseDatabaseClient } from "../lib/supabase/database.ts";
import { inviteSchoolAccount, SchoolAccountAdministrationError } from "../lib/supabase/account-administration.ts";

const actorId = "a1000000-0000-4000-8000-000000000001";
const targetId = "a1000000-0000-4000-8000-000000000002";
const actor = { id: actorId, roles: ["direccion"], supabaseAuth: { userId: actorId, accessToken: "synthetic-direction-jwt" } };
const input = { name: "Maestra ficticia", email: "Teacher@Example.invalid", role: "docente" };
const invited = { id: targetId, email: "teacher@example.invalid", invited_at: "2026-10-12T12:00:00Z", app_metadata: { provider: "email" } };
const hash = "a".repeat(56);
const config = { url: "https://school-project.supabase.co", publishableKey: "sb_publishable_synthetic" };
function auth(events, overrides = {}) {
  return { admin: {
    listUsers: async () => { events.push({ type: "list" }); return []; },
    generateInviteLink: async body => { events.push({ type: "generate", body }); return { user: invited, tokenHash: hash }; },
    inviteUserByEmail: async () => { throw Error("The internal flow must not send mail"); },
    updateUser: async (id, body) => { events.push({ type: "stamp", id, body }); return { ...invited, id, app_metadata: body.app_metadata }; },
    ...overrides,
  } };
}
function database(events, override) {
  return createSupabaseDatabaseClient(config, async (url, init) => {
    const call = { type: "rpc", path: new URL(url).pathname, body: JSON.parse(init.body), headers: init.headers };
    events.push(call);
    return override ? override(call) : Response.json({ id: targetId, role: "docente", active: true });
  });
}
function invite(a, db, selectedActor = actor, selectedInput = input) {
  return inviteSchoolAccount(a, db, selectedActor, selectedInput, undefined, { delivery: "internal" });
}
const code = expected => error => error instanceof SchoolAccountAdministrationError && error.code === expected;

test("internal creation confirms identity, protected receipt and user-JWT provision before returning its private activation receipt", async () => {
  const events = [];
  const result = await invite(auth(events), database(events));
  assert.deepEqual(events.map(event => event.type), ["list", "generate", "stamp", "rpc"]);
  assert.deepEqual(events[1].body, { email: "teacher@example.invalid", user_metadata: { name: input.name } });
  const receipt = events[2].body.app_metadata.school_invitation_receipt;
  assert.equal(receipt.inviter_id, actorId);
  assert.equal(receipt.email, invited.email);
  assert.equal(receipt.delivery, "internal");
  assert.equal(receipt.role, "docente");
  assert.match(receipt.nonce, /^[0-9a-f-]{36}$/);
  assert.equal(events[2].body.app_metadata.provider, "email");
  assert.equal(events[2].body.app_metadata.roles, undefined);
  assert.equal(events[3].path, "/rest/v1/rpc/school_provision_invited_account");
  assert.equal(events[3].headers.Authorization, "Bearer synthetic-direction-jwt");
  assert.equal(events[3].body.p_invitation_nonce, receipt.nonce);
  assert.deepEqual(result, { id: targetId, invited: false, activationIdentity: { id: targetId, email: invited.email, role: "docente", nonce: receipt.nonce, tokenHash: hash } });
  assert.equal(JSON.stringify(events).includes(hash), false, "The token credential is not metadata or an RPC argument");
});

test("internal flow rejects existing emails without regenerating credentials or assigning privileges", async () => {
  const events = [];
  await assert.rejects(invite(auth(events, { listUsers: async () => [{ id: targetId, email: " Teacher@Example.invalid " }] }), database(events)), code("already_exists"));
  assert.equal(events.length, 0);
});

test("internal generation cannot stamp an existing UUID, self, mismatched email or non-invited identity", async () => {
  for (const wrong of [
    { before: [{ id: targetId, email: "different@example.invalid" }], user: invited },
    { before: [], user: { ...invited, id: actorId } },
    { before: [], user: { ...invited, email: "different@example.invalid" } },
    { before: [], user: { ...invited, invited_at: null } },
    { before: [], user: { ...invited, invited_at: "invalid" } },
  ]) {
    const events = [];
    await assert.rejects(invite(auth(events, { listUsers: async () => wrong.before, generateInviteLink: async () => ({ user: wrong.user, tokenHash: hash }) }), database(events)), code("invitation_uncertain"));
    assert.equal(events.length, 0);
  }
});

test("ambiguous or malformed internal generation never stamps metadata or calls a role RPC", async () => {
  for (const generateInviteLink of [async () => { throw Error("private-upstream-detail"); }, async () => ({ user: invited, tokenHash: "invalid" }), async () => ({ user: invited })]) {
    const events = [];
    await assert.rejects(invite(auth(events, { generateInviteLink }), database(events)), code("invitation_uncertain"));
    assert.deepEqual(events.map(event => event.type), ["list"]);
  }
});

test("internal metadata stamping confirms nonce, role, delivery and identity before school provision", async () => {
  for (const field of ["nonce", "inviter_id", "email", "role", "delivery"]) {
    const events = [];
    const updateUser = async (_id, body) => ({ ...invited, app_metadata: { ...body.app_metadata, school_invitation_receipt: { ...body.app_metadata.school_invitation_receipt, [field]: "wrong" } } });
    await assert.rejects(invite(auth(events, { updateUser }), database(events)), code("invitation_uncertain"));
    assert.deepEqual(events.map(event => event.type), ["list", "generate"]);
  }
});

test("a failed or mismatched provision quarantines the exact internal attempt and never returns its activation credential", async () => {
  for (const response of [new Response("private", { status: 503 }), Response.json({ id: actorId, role: "docente", active: true }), Response.json({ id: targetId, role: "tutor", active: true }), Response.json({ id: targetId, role: "docente", active: false })]) {
    const events = [];
    const db = database(events, call => call.path.endsWith("school_provision_invited_account") ? response : Response.json({ quarantined: true }));
    await assert.rejects(invite(auth(events), db), code("provisioning_blocked"));
    const calls = events.filter(event => event.type === "rpc");
    assert.equal(calls.length, 2);
    assert.equal(calls[1].path, "/rest/v1/rpc/school_quarantine_invited_account");
    assert.deepEqual(calls[1].body, { p_auth_user_id: targetId, p_invitation_nonce: calls[0].body.p_invitation_nonce });
    assert.equal(JSON.stringify(events).includes(hash), false);
  }
});

test("unconfirmed internal quarantine reports uncertainty without leaking upstream causes or token", async () => {
  const events = [];
  await assert.rejects(invite(auth(events), database(events, () => new Response("synthetic-private-upstream", { status: 503 }))), error => code("provisioning_uncertain")(error) && !error.message.includes(hash) && !error.message.includes("synthetic-private"));
});

test("unsupported delivery and protected or unprivileged roles are rejected before generating an invitation", async () => {
  const events = [];
  const a = auth(events), db = database(events);
  await assert.rejects(inviteSchoolAccount(a, db, actor, input, undefined, { delivery: "recovery" }), code("unavailable"));
  await assert.rejects(invite(a, db, actor, { ...input, role: "superadmin" }), code("forbidden"));
  await assert.rejects(invite(a, db, actor, { ...input, role: "direccion" }), code("forbidden"));
  await assert.rejects(invite(a, db, { ...actor, roles: ["tutor"] }), code("forbidden"));
  await assert.rejects(invite(a, db, { ...actor, supabaseAuth: { ...actor.supabaseAuth, userId: targetId } }), code("forbidden"));
  assert.equal(events.length, 0);
});

test("confirmed internal activation receipt is withheld while the provision response is pending", async () => {
  const events = [];
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const operation = invite(auth(events), database(events, () => pending));
  let settled = false;
  operation.then(() => { settled = true; });
  await new Promise(done => setImmediate(done));
  assert.equal(settled, false);
  assert.equal(events.at(-1).type, "rpc");
  resolve(Response.json({ id: targetId, role: "docente", active: true }));
  assert.equal((await operation).activationIdentity.tokenHash, hash);
});
