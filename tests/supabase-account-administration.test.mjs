import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createSupabaseDatabaseClient } from "../lib/supabase/database.ts";
import { inviteSchoolAccount, updateSchoolAccount, SchoolAccountAdministrationError } from "../lib/supabase/account-administration.ts";

const actorId = "a1000000-0000-4000-8000-000000000001";
const targetId = "a1000000-0000-4000-8000-000000000002";
const actor = { id: actorId, name: "Dirección", email: "school@example.invalid", roles: ["direccion"], supabaseAuth: { userId: actorId, accessToken: "synthetic-direction-jwt" } };
const input = { name: "Maestra Uno", email: "Teacher@Example.invalid", role: "docente" };
const config = { url: "https://school-project.supabase.co", publishableKey: "sb_publishable_test-key" };

function fakeAuth(events, overrides = {}) {
  return { admin: {
    listUsers: async () => { events.push("list"); return []; },
    inviteUserByEmail: async body => {
      events.push({ invite: body });
      return { id: targetId, email: body.email, invited_at: "2026-10-08T20:00:00Z", app_metadata: { provider: "email" } };
    },
    updateUser: async (id, body) => { events.push({ stamp: body }); return { id, email: "teacher@example.invalid", app_metadata: body.app_metadata }; },
    ...overrides,
  } };
}

function clientWith(fetcher) { return createSupabaseDatabaseClient(config, fetcher); }

async function expectCode(operation, code) {
  await assert.rejects(operation, error => error instanceof SchoolAccountAdministrationError && error.code === code);
}

test("new account uses fresh Auth UUID before provisioning privileges with the actor JWT", async () => {
  const events = [];
  const client = clientWith(async (url, init) => {
    events.push({ rpc: new URL(url).pathname, body: JSON.parse(init.body), headers: init.headers });
    return Response.json({ id: targetId, role: "docente", active: true });
  });
  const result = await inviteSchoolAccount(fakeAuth(events), client, actor, input, "https://school.example.invalid");
  assert.deepEqual(result, { id: targetId, invited: true });
  assert.equal(events[0], "list");
  assert.deepEqual(events[1].invite, { email: "teacher@example.invalid", redirectTo: "https://school.example.invalid/restablecer", user_metadata: { name: input.name } });
  assert.equal(events[2].stamp.app_metadata.provider, "email");
  assert.equal(events[2].stamp.app_metadata.school_invitation_receipt.inviter_id, actorId);
  assert.equal(events[2].stamp.app_metadata.school_invitation_receipt.email, "teacher@example.invalid");
  assert.equal(events[2].stamp.app_metadata.roles, undefined);
  assert.equal(events[3].rpc, "/rest/v1/rpc/school_provision_invited_account");
  assert.equal(events[3].headers.Authorization, "Bearer synthetic-direction-jwt");
  assert.equal(events[3].body.p_auth_user_id, targetId);
  assert.equal(events[3].body.p_invitation_nonce, events[2].stamp.app_metadata.school_invitation_receipt.nonce);
});

test("existing Auth email is never invited again or automatically granted school access", async () => {
  const events = [];
  const auth = fakeAuth(events, { listUsers: async () => [{ id: targetId, email: "teacher@example.invalid" }] });
  let writes = 0;
  await expectCode(inviteSchoolAccount(auth, clientWith(async () => { writes++; return Response.json({}); }), actor, input, "https://school.example.invalid"), "already_exists");
  assert.equal(events.length, 0);
  assert.equal(writes, 0);
});

test("school invitations reject an invalid APP_ORIGIN before sending and preserve the canonical reset path on Vercel", async () => {
  for (const appOrigin of [undefined, "http://school.example.invalid", "https://user:secret@school.example.invalid", "https://school.example.invalid/ingresar", "https://school.example.invalid?query=1", "https://school.example.invalid#fragment"]) {
    const events = [];
    let rpcCalls = 0;
    await expectCode(inviteSchoolAccount(fakeAuth(events), clientWith(async () => { rpcCalls++; return Response.json({}); }), actor, input, appOrigin), "unavailable");
    assert.equal(events.length, 0);
    assert.equal(rpcCalls, 0);
  }
  const events = [];
  await inviteSchoolAccount(fakeAuth(events), clientWith(async () => Response.json({ id: targetId, role: "docente", active: true })), actor, input, "https://school-presentation.vercel.app");
  assert.equal(events[1].invite.redirectTo, "https://school-presentation.vercel.app/restablecer");
});

test("an ambiguous Auth invitation never reconciles by email and never calls a role RPC", async () => {
  const events = [];
  let rpcCalls = 0;
  const auth = fakeAuth(events, { inviteUserByEmail: async () => { events.push("invite-uncertain"); throw Error("private network cause"); } });
  await expectCode(inviteSchoolAccount(auth, clientWith(async () => { rpcCalls++; return Response.json({}); }), actor, input, "https://school.example.invalid"), "invitation_uncertain");
  assert.deepEqual(events, ["list", "invite-uncertain"]);
  assert.equal(rpcCalls, 0);
});

test("unexpected existing UUID or email returned by Auth is not stamped or provisioned", async () => {
  for (const wrong of [
    { before: [{ id: targetId, email: "different@example.invalid" }], invited: { id: targetId, email: "teacher@example.invalid", invited_at: "2026-10-08T20:00:00Z" } },
    { before: [], invited: { id: targetId, email: "different@example.invalid", invited_at: "2026-10-08T20:00:00Z" } },
  ]) {
    let writes = 0;
    const auth = fakeAuth([], { listUsers: async () => wrong.before, inviteUserByEmail: async () => wrong.invited, updateUser: async () => { writes++; throw Error(); } });
    await expectCode(inviteSchoolAccount(auth, clientWith(async () => { writes++; return Response.json({}); }), actor, input, "https://school.example.invalid"), "invitation_uncertain");
    assert.equal(writes, 0);
  }
});

test("a failed or uncertain privilege RPC quarantines only the same fresh invitation receipt", async () => {
  const calls = [];
  const client = clientWith(async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, body: JSON.parse(init.body) });
    return path.endsWith("school_provision_invited_account") ? new Response("private cause", { status: 503 }) : Response.json({ quarantined: true });
  });
  await expectCode(inviteSchoolAccount(fakeAuth([]), client, actor, input, "https://school.example.invalid"), "provisioning_blocked");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].path, "/rest/v1/rpc/school_quarantine_invited_account");
  assert.deepEqual(calls[1].body, { p_auth_user_id: targetId, p_invitation_nonce: calls[0].body.p_invitation_nonce });
});

test("when quarantine cannot be confirmed the result reports uncertainty", async () => {
  const client = clientWith(async () => new Response("private cause", { status: 503 }));
  await expectCode(inviteSchoolAccount(fakeAuth([]), client, actor, input, "https://school.example.invalid"), "provisioning_uncertain");
});

test("Direction cannot create Direction and inconsistent identities cannot provision or edit", async () => {
  let calls = 0;
  const client = clientWith(async () => { calls++; return Response.json({}); });
  const auth = fakeAuth([], { listUsers: async () => { calls++; return []; } });
  await expectCode(inviteSchoolAccount(auth, client, actor, { ...input, role: "direccion" }, "https://school.example.invalid"), "forbidden");
  await expectCode(updateSchoolAccount(client, actor, actorId, { active: false }), "forbidden");
  await expectCode(updateSchoolAccount(client, actor, targetId, { role: "direccion" }), "forbidden");
  await expectCode(updateSchoolAccount(client, { ...actor, supabaseAuth: { ...actor.supabaseAuth, userId: targetId } }, targetId, { active: false }), "forbidden");
  assert.equal(calls, 0);
});

test("account status or name changes call only the verified JWT account RPC", async () => {
  const requests = [];
  const client = clientWith(async (url, init) => {
    requests.push({ url: String(url), init });
    return Response.json({ id: targetId, updated: true, active: false });
  });
  await updateSchoolAccount(client, actor, targetId, { active: false });
  await updateSchoolAccount(client, actor, targetId, { name: "Nombre escolar editado", email: "TEACHER@example.invalid" });
  assert.ok(requests.every(request => request.url.endsWith("/rest/v1/rpc/school_update_account") && request.init.headers.Authorization === "Bearer synthetic-direction-jwt"));
  assert.deepEqual(JSON.parse(requests[0].init.body), { p_auth_user_id: targetId, p_role: null, p_active: false, p_name: null, p_expected_email: null });
  assert.equal(JSON.parse(requests[1].init.body).p_expected_email, "teacher@example.invalid");
});

test("SQL account controls forbid self/superadmin changes and Auth refresh preserves school name/active", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20261024000000_school_accounts_rpcs.sql", import.meta.url), "utf8");
  assert.match(sql, /p_auth_user_id = v_actor/);
  assert.match(sql, /if 'superadmin' = any\(v_roles\)/);
  assert.match(sql, /raw_app_meta_data -> 'school_invitation_receipt'/);
  assert.match(sql, /v_auth\.invited_at is null/);
  assert.match(sql, /account_already_provisioned/);
  assert.match(sql, /select \* into v_profile.*for update/);
  assert.match(sql, /revoke insert, update, delete on table public\.user_roles from authenticated/);
  const postLockChecks = [...sql.matchAll(/perform pg_advisory_xact_lock\(hashtext\('school:account-administration'\)\);\s*(?:--[^\n]*\n\s*)*if not public\.school_actor_active\(\) or not public\.school_is_leader\(\)/g)];
  assert.equal(postLockChecks.length, 3, "Every account RPC rechecks actor permissions after waiting for the shared lock");
  const authSync = sql.split("create or replace function public.sync_profile_from_auth_user()")[1].split("create function public.school_provision_invited_account")[0];
  const conflict = authSync.split("on conflict (id) do update set")[1].split("return new;")[0];
  assert.doesNotMatch(conflict, /\bname\s*=/);
  assert.doesNotMatch(conflict, /\bactive\s*=/);
});
