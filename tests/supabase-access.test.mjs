import assert from "node:assert/strict";
import test from "node:test";
import { createSupabaseDatabaseClient } from "../lib/supabase/database.ts";
import { createSupabaseSchoolAccess } from "../lib/supabase/access.ts";

const config = { url: "https://school-project.supabase.co", publishableKey: "sb_publishable_test-key" };
const actor = { id: "auth-family-a", roles: ["tutor"], supabaseAuth: { userId: "auth-family-a", accessToken: "synthetic-family-a-jwt" } };

function accessWith(fetcher) {
  return createSupabaseSchoolAccess(createSupabaseDatabaseClient(config, fetcher));
}

test("student check uses the user's JWT and requires an active RLS-visible student", async () => {
  let seen;
  const access = accessWith(async (input, init) => {
    seen = { url: new URL(input), headers: init.headers };
    return Response.json([{ id: "student-a", active: true }]);
  });
  assert.equal(await access.maySeeStudent(actor, "student-a"), true);
  assert.equal(seen.headers.Authorization, "Bearer synthetic-family-a-jwt");
  assert.equal(seen.headers.apikey, config.publishableKey);
  assert.equal(seen.url.pathname, "/rest/v1/students");
  assert.equal(seen.url.searchParams.get("id"), "eq.student-a");
  assert.equal(seen.url.searchParams.get("active"), "eq.true");
});

test("empty RLS results deny foreign students and groups without assuming leadership access", async () => {
  const access = accessWith(async () => Response.json([]));
  assert.equal(await access.maySeeStudent(actor, "student-b"), false);
  assert.equal(await access.maySeeGroup(actor, "group-b"), false);
  assert.equal(await access.maySeeStudent({ ...actor, roles: ["direccion"] }, "missing-student"), false);
  assert.equal(await access.maySeeGroup({ ...actor, roles: ["superadmin"] }, "missing-group"), false);
});

test("inactive students remain readable for leadership but are denied to families", async () => {
  const access = accessWith(async () => Response.json([{ id: "student-a", active: false }]));
  assert.equal(await access.maySeeStudent(actor, "student-a"), false);
  assert.equal(await access.maySeeStudent({ ...actor, roles: ["direccion"] }, "student-a"), true);
});

test("mismatched verified Auth identity and unsupported roles never make network requests", async () => {
  let calls = 0;
  const access = accessWith(async () => { calls++; return Response.json([]); });
  const wrongIdentity = { ...actor, supabaseAuth: { ...actor.supabaseAuth, userId: "another-auth-user" } };
  for (const invalidActor of [wrongIdentity, { ...actor, supabaseAuth: null }]) {
    assert.equal(await access.maySeeStudent(invalidActor, "student-a"), false);
    assert.equal(await access.maySeeGroup(invalidActor, "group-a"), false);
    assert.equal(await access.mayTeachGroup(invalidActor, "group-a"), false);
    assert.deepEqual(await access.accessibleGroupIds(invalidActor), []);
  }
  assert.equal(await access.maySeeGroup({ ...actor, roles: ["alumno"] }, "group-a"), false);
  assert.equal(await access.mayTeachGroup(actor, "group-a"), false);
  assert.equal(calls, 0);
});

test("a teacher must match their own active teacher profile and group assignment", async () => {
  const seen = [];
  const teacherActor = { ...actor, id: "auth-teacher", roles: ["docente"], supabaseAuth: { userId: "auth-teacher", accessToken: "synthetic-teacher-jwt" } };
  const access = accessWith(async (input, init) => {
    const url = new URL(input);
    seen.push({ url, headers: init.headers });
    return url.pathname.endsWith("/teachers")
      ? Response.json([{ id: "teacher-a", user_id: "auth-teacher", active: true }])
      : Response.json([{ teacher_id: "teacher-a", group_id: "group-a" }]);
  });
  assert.equal(await access.mayTeachGroup(teacherActor, "group-a"), true);
  assert.equal(seen[0].url.searchParams.get("user_id"), "eq.auth-teacher");
  assert.equal(seen[0].url.searchParams.get("active"), "eq.true");
  assert.equal(seen[1].url.searchParams.get("teacher_id"), "eq.teacher-a");
  assert.equal(seen[1].url.searchParams.get("group_id"), "eq.group-a");
  assert.ok(seen.every(request => request.headers.Authorization === "Bearer synthetic-teacher-jwt"));
});

test("visibility of another teacher's assignment does not grant teaching access", async () => {
  const teacherActor = { ...actor, roles: ["docente"] };
  const access = accessWith(async input => new URL(input).pathname.endsWith("/teachers")
    ? Response.json([{ id: "own-teacher", user_id: actor.id, active: true }])
    : Response.json([{ teacher_id: "different-teacher", group_id: "group-a" }]));
  assert.equal(await access.mayTeachGroup(teacherActor, "group-a"), false);
});

test("accessible groups paginate complete RLS-visible active results", async () => {
  const offsets = [];
  const access = accessWith(async input => {
    const url = new URL(input);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    offsets.push(offset);
    assert.equal(url.searchParams.get("active"), "eq.true");
    assert.equal(url.searchParams.get("order"), "id.asc");
    return Response.json(Array.from({ length: offset === 0 ? 500 : 1 }, (_, index) => ({ id: `group-${offset + index}`, active: true })),
      { headers: { "content-range": `${offset}-${offset === 0 ? 499 : 500}/501` } });
  });
  const ids = await access.accessibleGroupIds(actor);
  assert.equal(ids.length, 501);
  assert.equal(ids[500], "group-500");
  assert.deepEqual(offsets, [0, 500]);
});

test("upstream failures fail closed and never return a partially loaded authorization list", async () => {
  let calls = 0;
  const access = accessWith(async () => {
    calls++;
    if (calls === 1) return Response.json(Array.from({ length: 500 }, (_, index) => ({ id: `group-${index}`, active: true })));
    return new Response("upstream-secret-must-not-escape", { status: 503 });
  });
  assert.deepEqual(await access.accessibleGroupIds(actor), []);
  const failed = accessWith(async () => { throw new Error("private upstream cause"); });
  assert.equal(await failed.maySeeStudent(actor, "student-a"), false);
  assert.equal(await failed.maySeeGroup(actor, "group-a"), false);
  assert.equal(await failed.mayTeachGroup({ ...actor, roles: ["docente"] }, "group-a"), false);
});
