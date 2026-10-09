import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { unzipSync, strFromU8 } from "fflate";

const require = createRequire(import.meta.url);
const studentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const groupId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const origin = "https://portal.example.test";
const sampleRecord = { date: "2026-10-08", groupName: "Grupo verde", givenName: "Ana", familyName: "Escolar", status: "presente", note: null };
const sampleHistory = { student: { id: studentId, name: "Ana Escolar" }, period: { from: "2026-10-01", to: "2026-10-08" }, counts: { presente: 1, retardo: 0, ausente: 0, justificada: 0 }, total: 1, attendancePercent: 100, records: [sampleRecord] };

function harness() {
  const state = {
    actor: { id: "synthetic-school-actor", roles: ["direccion"], supabaseAuth: { userId: "synthetic-school-actor", accessToken: "attendance-user-jwt" } },
    env: { SCHOOL_DATA_PROVIDER: "supabase", SUPABASE_URL: "https://school.example.test", SUPABASE_PUBLISHABLE_KEY: "test-public" },
    report: { items: [sampleRecord], groupName: "Grupo verde" }, history: sampleHistory,
    calls: [], status: 200, d1Calls: 0, d1Audit: [],
  };
  const schema = Object.fromEntries(["attendance", "auditLog", "groups", "students", "guardians", "studentGuardians"].map(table => [table, new Proxy({}, { get: (_target, field) => `${table}.${String(field)}` })]));
  function d1() {
    state.d1Calls++;
    if (state.env.SCHOOL_DATA_PROVIDER === "supabase") throw Error("D1 unavailable on Vercel");
    return {
      select(columns) {
        const data = "name" in columns ? [{ name: "Grupo verde" }] : "id" in columns ? [{ id: studentId }] : [{ ...sampleRecord, studentId }];
        const query = { from: () => query, innerJoin: () => query, where: () => query, orderBy: () => query, limit: async () => data, then: (resolve, reject) => Promise.resolve(data).then(resolve, reject) };
        return query;
      },
      insert: () => ({ values: async row => { state.d1Audit.push(row); } }),
    };
  }
  const dependencies = {
    "@/lib/runtime/env": { env: state.env }, "@/db": { getDb: d1 }, "@/db/schema": schema,
    "drizzle-orm": Object.fromEntries(["and", "asc", "eq", "gte", "inArray", "lte"].map(name => [name, (...values) => ({ name, values })])),
    "zod": require("zod"), "fflate": require("fflate"),
    "@/lib/access": {
      actorFromRequest: async () => state.actor,
      hasRole: (actor, ...roles) => roles.some(role => actor.roles.includes(role)),
      mayTeachGroup: async () => true,
      errorResponse: (status, message) => Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } }),
    },
  };
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const sandboxModule = { exports: {} }; modules.set(file, sandboxModule);
    const source = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const fetcher = async (input, options) => {
      const url = new URL(input); state.calls.push({ url, options });
      assert.equal(options.headers.Authorization, "Bearer attendance-user-jwt");
      assert.equal(options.headers.apikey, "test-public");
      if (state.status !== 200) return Response.json({ error: "upstream-private-details" }, { status: state.status });
      if (url.pathname === "/rest/v1/rpc/school_attendance_report") return Response.json(state.report);
      if (url.pathname === "/rest/v1/rpc/school_attendance_history") return Response.json(state.history);
      throw Error(`Unexpected HTTP ${url.pathname}`);
    };
    const requireMock = name => {
      if (dependencies[name]) return dependencies[name];
      const files = { "./local-http-test-policy.ts": "lib/supabase/local-http-test-policy.ts", "@/lib/supabase/auth-route-utils": "lib/supabase/auth-route-utils.ts", "@/lib/supabase/database": "lib/supabase/database.ts", "@/lib/attendance-export": "lib/attendance-export.ts" };
      if (!files[name]) throw Error(`Unexpected import ${name}`);
      return load(files[name]);
    };
    vm.runInContext(source, vm.createContext({ module: sandboxModule, exports: sandboxModule.exports, require: requireMock, fetch: fetcher, URL, Response, Request, Headers, TextEncoder, Uint8Array, crypto: webcrypto }), { filename: file });
    return sandboxModule.exports;
  }
  return { state, POST: load("app/api/attendance/report/route.ts").POST, GET: load("app/api/attendance/history/route.ts").GET };
}

function report(body = {}, requestOrigin = origin) {
  return new Request(`${origin}/api/attendance/report`, { method: "POST", headers: { origin: requestOrigin, "content-type": "application/json" }, body: JSON.stringify({ groupId, from: "2026-10-01", to: "2026-10-08", format: "csv", ...body }) });
}
function history(params = {}) {
  return new Request(`${origin}/api/attendance/history?${new URLSearchParams({ studentId, groupId, from: "2026-10-01", to: "2026-10-08", ...params })}`);
}

test("attendance CSV exports Supabase RPC data with the verified user JWT and no D1", async () => {
  const runtime = harness();
  runtime.state.report.items = [{ ...sampleRecord, givenName: '=HYPERLINK("https://example.test")', note: 'Observación "completa"' }];
  const response = await runtime.POST(report());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-disposition"), /attachment; filename="asistencia-2026-10-01-2026-10-08.csv"/);
  const csv = await response.text();
  assert.match(csv, /Grupo verde/);
  assert.match(csv, /"'=HYPERLINK\(""https:\/\/example.test""\) Escolar"/);
  assert.match(csv, /Observación ""completa""/);
  assert.equal(runtime.state.calls[0].url.pathname, "/rest/v1/rpc/school_attendance_report");
  assert.deepEqual(JSON.parse(runtime.state.calls[0].options.body), { p_group_id: groupId, p_from: "2026-10-01", p_to: "2026-10-08", p_format: "csv" });
  assert.equal(runtime.state.d1Calls, 0);
  assert.deepEqual(runtime.state.d1Audit, []);
});

test("XLSX and PDF are real downloadable files sourced from Supabase without D1", async () => {
  for (const format of ["xlsx", "pdf"]) {
    const runtime = harness(); const response = await runtime.POST(report({ format }));
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(runtime.state.calls[0].options.body).p_format, format);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (format === "xlsx") {
      const archive = unzipSync(bytes); const sheet = strFromU8(archive["xl/worksheets/sheet1.xml"]);
      assert.match(sheet, /Ana Escolar/); assert.match(sheet, /Grupo verde/); assert.match(sheet, /t="inlineStr"/);
      assert.equal(response.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    } else {
      assert.match(new TextDecoder().decode(bytes), /^%PDF-1\.4/);
      assert.equal(response.headers.get("content-type"), "application/pdf");
    }
    assert.equal(runtime.state.d1Calls, 0);
  }
});

test("schoolwide export requires leadership and passes null group only for leadership", async () => {
  const leader = harness(); assert.equal((await leader.POST(report({ groupId: "todos" }))).status, 200);
  assert.equal(JSON.parse(leader.state.calls[0].options.body).p_group_id, null);
  const teacher = harness(); teacher.state.actor.roles = ["docente"];
  assert.equal((await teacher.POST(report({ groupId: "todos" }))).status, 403);
  assert.equal(teacher.state.calls.length, 0); assert.equal(teacher.state.d1Calls, 0);
});

test("report rejects cross-origin, no session, family role, invalid range and missing JWT before HTTP or D1", async () => {
  const crossed = harness(); assert.equal((await crossed.POST(report({}, "https://other.example.test"))).status, 403);
  const anonymous = harness(); anonymous.state.actor = null; assert.equal((await anonymous.POST(report())).status, 401);
  const family = harness(); family.state.actor.roles = ["tutor"]; assert.equal((await family.POST(report())).status, 403);
  const noToken = harness(); noToken.state.actor.supabaseAuth = null; assert.equal((await noToken.POST(report())).status, 503);
  for (const body of [{ groupId: "invalid" }, { from: "2026-10-10", to: "2026-10-01" }, { from: "2024-01-01", to: "2026-01-01" }, { format: "html" }]) {
    const runtime = harness(); assert.equal((await runtime.POST(report(body))).status, 400); assert.equal(runtime.state.calls.length, 0); assert.equal(runtime.state.d1Calls, 0);
  }
  for (const runtime of [crossed, anonymous, family, noToken]) { assert.equal(runtime.state.calls.length, 0); assert.equal(runtime.state.d1Calls, 0); }
});

test("report errors are sanitized and incomplete or oversized RPC data does not produce a download", async () => {
  for (const [upstream, expected] of [[400, 400], [403, 403], [404, 404], [502, 503]]) {
    const runtime = harness(); runtime.state.status = upstream; const response = await runtime.POST(report());
    assert.equal(response.status, expected); assert.doesNotMatch(await response.text(), /upstream-private-details|attendance-user-jwt|test-public/); assert.equal(runtime.state.d1Calls, 0);
  }
  for (const payload of [{}, { items: [], groupName: null }, { items: Array(10_001).fill(sampleRecord), groupName: "Grupo verde" }]) {
    const runtime = harness(); runtime.state.report = payload; const response = await runtime.POST(report());
    assert.equal(response.status, Array.isArray(payload.items) && payload.items.length > 10_000 ? 400 : 503);
    assert.equal(response.headers.get("content-disposition"), null); assert.equal(runtime.state.d1Calls, 0);
  }
});

test("staff and family histories call the real Supabase RPC with their respective group scope, no D1", async () => {
  for (const role of ["docente", "tutor"]) {
    const runtime = harness(); runtime.state.actor.roles = [role];
    const response = await runtime.GET(history(role === "tutor" ? { groupId: "" } : {}));
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), sampleHistory);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(JSON.parse(runtime.state.calls[0].options.body), { p_student_id: studentId, p_group_id: role === "tutor" ? null : groupId, p_from: "2026-10-01", p_to: "2026-10-08" });
    assert.equal(runtime.state.calls[0].url.pathname, "/rest/v1/rpc/school_attendance_history"); assert.equal(runtime.state.d1Calls, 0);
  }
});

test("history rejects malformed scope, family-specified group, unsupported student role and missing session/JWT", async () => {
  const staff = harness(); assert.equal((await staff.GET(history({ groupId: "" }))).status, 404);
  const family = harness(); family.state.actor.roles = ["tutor"]; assert.equal((await family.GET(history())).status, 403);
  const student = harness(); student.state.actor.roles = ["alumno"]; assert.equal((await student.GET(history())).status, 403);
  const anonymous = harness(); anonymous.state.actor = null; assert.equal((await anonymous.GET(history())).status, 401);
  const noToken = harness(); noToken.state.actor.supabaseAuth = null; assert.equal((await noToken.GET(history())).status, 503);
  for (const runtime of [staff, family, student, anonymous, noToken]) { assert.equal(runtime.state.calls.length, 0); assert.equal(runtime.state.d1Calls, 0); }
  for (const params of [{ studentId: "invalid" }, { from: "2026-99-99" }, { from: "2024-01-01", to: "2026-01-01" }]) {
    const runtime = harness(); assert.equal((await runtime.GET(history(params))).status, 400); assert.equal(runtime.state.calls.length, 0);
  }
});

test("RLS denials and upstream failures return safe history errors for both staff and families", async () => {
  for (const role of ["docente", "tutor"]) {
    for (const [upstream, expected] of [[400, 400], [403, 403], [404, 404], [502, 503]]) {
      const runtime = harness(); runtime.state.actor.roles = [role]; runtime.state.status = upstream;
      const response = await runtime.GET(history(role === "tutor" ? { groupId: "" } : {}));
      assert.equal(response.status, expected); assert.doesNotMatch(await response.text(), /upstream-private-details|attendance-user-jwt|test-public/); assert.equal(runtime.state.d1Calls, 0);
    }
  }
  const runtime = harness(); runtime.state.history = { records: [] }; assert.equal((await runtime.GET(history())).status, 503);
});

test("D1 fallback still exports with an audit record and computes staff/family histories", async () => {
  const reportRuntime = harness(); reportRuntime.state.env.SCHOOL_DATA_PROVIDER = "d1";
  assert.equal((await reportRuntime.POST(report())).status, 200); assert.equal(reportRuntime.state.calls.length, 0);
  assert.equal(reportRuntime.state.d1Audit.length, 1); assert.equal(reportRuntime.state.d1Audit[0].action, "export_attendance_csv");
  for (const role of ["docente", "tutor"]) {
    const runtime = harness(); runtime.state.env.SCHOOL_DATA_PROVIDER = "d1"; runtime.state.actor.roles = [role];
    const response = await runtime.GET(history(role === "tutor" ? { groupId: "" } : {}));
    assert.equal(response.status, 200); const payload = await response.json();
    assert.equal(payload.attendancePercent, 100); assert.equal(payload.counts.presente, 1); assert.equal(payload.student.id, studentId);
    assert.equal(runtime.state.calls.length, 0); assert.ok(runtime.state.d1Calls > 0);
  }
});
