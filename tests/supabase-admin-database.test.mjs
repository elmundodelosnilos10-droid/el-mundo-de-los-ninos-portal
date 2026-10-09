import assert from "node:assert/strict";
import { test } from "node:test";
import { createSchoolAdminDatabaseClient, SupabaseAdminDatabaseError } from "../lib/supabase/admin-database.ts";

const authUserId = "65e4785a-94f4-4f67-98a7-8d8aee1e42f1";
const environment = {
  SUPABASE_URL: "https://school-project.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_synthetic-secret-key",
};

test("syncs trusted school roles idempotently, then activates the matching profile", async () => {
  const calls = [];
  const client = createSchoolAdminDatabaseClient(environment, async (url, init) => {
    calls.push({ url: String(url), init });
    if (init.method === "PATCH") {
      const body = JSON.parse(init.body);
      return Response.json([{ id: authUserId, active: body.active, ...(body.name ? { name: body.name } : {}) }]);
    }
    return new Response(null, { status: init.method === "POST" ? 201 : 204 });
  });

  await client.syncAccountAccess(authUserId, ["superadmin"], "Dirección escolar");

  assert.equal(calls.length, 4);
  assert.equal(calls[0].url, `${environment.SUPABASE_URL}/rest/v1/profiles?id=eq.${authUserId}&select=id%2Cactive`);
  assert.deepEqual(JSON.parse(calls[0].init.body), { active: false });
  assert.equal(calls[1].url, `${environment.SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${authUserId}`);
  assert.equal(calls[1].init.method, "DELETE");
  assert.equal(calls[2].url, `${environment.SUPABASE_URL}/rest/v1/user_roles?on_conflict=user_id%2Crole`);
  assert.equal(calls[2].init.method, "POST");
  assert.equal(calls[2].init.headers.get("apikey"), environment.SUPABASE_SECRET_KEY);
  assert.equal(calls[2].init.headers.get("Authorization"), null);
  assert.equal(calls[2].init.headers.get("Prefer"), "resolution=merge-duplicates,return=minimal");
  assert.deepEqual(JSON.parse(calls[2].init.body), [{ user_id: authUserId, role: "superadmin" }]);
  assert.equal(calls[3].url, `${environment.SUPABASE_URL}/rest/v1/profiles?id=eq.${authUserId}&select=id%2Cactive%2Cname`);
  assert.deepEqual(JSON.parse(calls[3].init.body), { active: true, name: "Dirección escolar" });
});

test("keeps Supabase blocked through role sync and activates only in a later call", async () => {
  const calls = [];
  const client = createSchoolAdminDatabaseClient(environment, async (url, init) => {
    calls.push({ url: String(url), init });
    if (init.method === "PATCH") {
      const body = JSON.parse(init.body);
      return Response.json([{ id: authUserId, active: body.active, ...(body.name ? { name: body.name } : {}) }]);
    }
    return new Response(null, { status: init.method === "POST" ? 201 : 204 });
  });

  await client.syncAccountAccess(authUserId, ["docente"], "Maestra", false);
  // The application commits its D1 status batch between these two calls.
  await client.setProfileActive(authUserId, true, "Maestra");

  assert.equal(calls.length, 5);
  assert.deepEqual(JSON.parse(calls[0].init.body), { active: false });
  assert.equal(calls[0].init.method, "PATCH");
  assert.equal(calls[1].init.method, "DELETE");
  assert.equal(calls[2].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[2].init.body), [{ user_id: authUserId, role: "docente" }]);
  assert.deepEqual(JSON.parse(calls[3].init.body), { active: false, name: "Maestra" });
  assert.deepEqual(JSON.parse(calls[4].init.body), { active: true, name: "Maestra" });
});

test("uses legacy service-role bearer only for legacy JWT keys", async () => {
  let captured;
  const client = createSchoolAdminDatabaseClient({
    ...environment,
    SUPABASE_SECRET_KEY: "legacy-service-role-key",
  }, async (url, init) => {
    captured = init;
    if (init.method === "PATCH") {
      const body = JSON.parse(init.body);
      return Response.json([{ id: authUserId, active: body.active, ...(body.name ? { name: body.name } : {}) }]);
    }
    return new Response(null, { status: init.method === "POST" ? 201 : 204 });
  });

  await client.syncAccountAccess(authUserId, ["docente", "tutor"]);
  assert.equal(captured.headers.get("Authorization"), "Bearer legacy-service-role-key");
});

test("rejects malformed identity, empty roles, unknown roles, and duplicate roles before network calls", async () => {
  let calls = 0;
  const client = createSchoolAdminDatabaseClient(environment, async () => { calls++; return new Response(null, { status: 201 }); });

  for (const [id, roles, activeAfterSync] of [
    ["not-a-uuid", ["superadmin"]],
    [authUserId, []],
    [authUserId, ["family"]],
    [authUserId, ["tutor", "tutor"]],
    [authUserId, ["docente"], "active"],
  ]) {
    await assert.rejects(
      client.syncAccountAccess(id, roles, undefined, activeAfterSync),
      error => error instanceof SupabaseAdminDatabaseError && error.code === "invalid_input",
    );
  }
  assert.equal(calls, 0);
});

test("fails closed when a profile is missing or could not be activated", async () => {
  const client = createSchoolAdminDatabaseClient(environment, async (_url, init) =>
    init.method === "PATCH" ? Response.json([]) : new Response(null, { status: 204 }));

  await assert.rejects(client.syncAccountAccess(authUserId, ["direccion"]), error => error instanceof SupabaseAdminDatabaseError && error.code === "rejected");
});

test("can disable one known profile without changing its role rows", async () => {
  let captured;
  const client = createSchoolAdminDatabaseClient(environment, async (url, init) => {
    captured = { url: String(url), init };
    return Response.json([{ id: authUserId, active: false }]);
  });
  await client.setProfileActive(authUserId, false);
  assert.equal(captured.url, `${environment.SUPABASE_URL}/rest/v1/profiles?id=eq.${authUserId}&select=id%2Cactive`);
  assert.deepEqual(JSON.parse(captured.init.body), { active: false });
});

test("does not expose upstream errors or missing credentials", async () => {
  const failing = createSchoolAdminDatabaseClient(environment, async () => { throw new Error(environment.SUPABASE_SECRET_KEY); });
  await assert.rejects(failing.syncAccountAccess(authUserId, ["docente"]), error => {
    assert.ok(error instanceof SupabaseAdminDatabaseError);
    assert.equal(error.code, "unavailable");
    assert.equal(error.message.includes(environment.SUPABASE_SECRET_KEY), false);
    return true;
  });

  const unconfigured = createSchoolAdminDatabaseClient({ SUPABASE_URL: environment.SUPABASE_URL }, async () => { throw new Error("must not call"); });
  await assert.rejects(unconfigured.syncAccountAccess(authUserId, ["docente"]), error => error instanceof SupabaseAdminDatabaseError && error.code === "not_configured");
});
