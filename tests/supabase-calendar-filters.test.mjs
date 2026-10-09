import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { calendarFeedUrl, CALENDAR_KIND_VALUES } from "../lib/calendar-filters.ts";

const require = createRequire(import.meta.url);
const groupId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const foreignGroupId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const origin = "https://portal.example.test";
const event = { id: "event-a", groupId, groupName: "Grupo verde", kind: "festival", title: "Festival autorizado", description: null, startsAt: "2026-10-08T16:00:00Z", endsAt: null, source: "evento" };

function harness() {
  const state = {
    actor: { id: "calendar-actor", roles: ["tutor"], supabaseAuth: { userId: "calendar-actor", accessToken: "calendar-user-jwt" } },
    env: { SCHOOL_DATA_PROVIDER: "supabase", SUPABASE_URL: "https://school.example.test", SUPABASE_PUBLISHABLE_KEY: "test-public" },
    payload: { items: [event], total: 1, limited: false }, status: 200, calls: [], d1Calls: 0,
    events: [], tasks: [], limits: [],
  };
  const tables = { calendarEvents: new Proxy({}, { get: (_target, field) => `events.${String(field)}` }), groups: new Proxy({}, { get: (_target, field) => `groups.${String(field)}` }), tasks: new Proxy({}, { get: (_target, field) => `tasks.${String(field)}` }) };
  const operators = Object.fromEntries(["and", "asc", "eq", "gte", "inArray", "isNull", "lt", "or"].map(name => [name, (...values) => ({ name, values })]));
  function field(row, name) { const key = name.split(".")[1]; return key === "name" ? row.groupName : row[key]; }
  function matches(row, condition) {
    if (!condition) return true;
    const { name, values } = condition;
    if (name === "and") return values.every(item => matches(row, item));
    if (name === "or") return values.some(item => matches(row, item));
    const actual = field(row, values[0]); const wanted = values[1];
    if (name === "eq") return actual === wanted;
    if (name === "isNull") return actual === null;
    if (name === "inArray") return wanted.includes(actual);
    if (name === "gte") return actual >= wanted;
    if (name === "lt") return actual < wanted;
    throw Error(`Unexpected operator ${name}`);
  }
  const dependencies = {
    "@/lib/runtime/env": { env: state.env }, "@/db/schema": { ...tables, auditLog: {} },
    "drizzle-orm": operators, "zod": require("zod"),
    "@/db": { getDb() {
      state.d1Calls++; if (state.env.SCHOOL_DATA_PROVIDER === "supabase") throw Error("D1 unavailable on Vercel");
      return { select(columns) {
        let rows = []; let condition;
        const query = {
          from: table => { rows = table === tables.calendarEvents ? state.events : state.tasks; return query; },
          leftJoin: () => query, innerJoin: () => query,
          where: value => { condition = value; return query; }, orderBy: () => query,
          limit: async limit => { state.limits.push(limit); return rows.filter(row => matches(row, condition)).slice(0, limit).map(row => Object.fromEntries(Object.entries(columns).map(([key, value]) => [key, field(row, value)]))); },
        }; return query;
      } };
    } },
    "@/lib/access": { actorFromRequest: async () => state.actor, hasRole: (actor, ...roles) => roles.some(role => actor.roles.includes(role)), accessibleGroupIds: async () => [groupId], errorResponse: (status, message) => Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } }) },
    "@/lib/family-notifications": {},
  };
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const sandboxModule = { exports: {} }; modules.set(file, sandboxModule);
    const source = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const fetcher = async (input, options) => {
      const url = new URL(input); state.calls.push({ url, options });
      assert.equal(options.headers.Authorization, "Bearer calendar-user-jwt"); assert.equal(options.headers.apikey, "test-public");
      assert.equal(url.pathname, "/rest/v1/rpc/school_calendar_feed_filtered");
      return Response.json(state.status === 200 ? state.payload : { error: "upstream-private" }, { status: state.status });
    };
    const requireMock = name => {
      if (dependencies[name]) return dependencies[name];
      const files = { "./local-http-test-policy.ts": "lib/supabase/local-http-test-policy.ts", "@/lib/supabase/auth-route-utils": "lib/supabase/auth-route-utils.ts", "@/lib/supabase/database": "lib/supabase/database.ts", "@/lib/calendar-feed": "lib/calendar-feed.ts", "@/lib/calendar-filters": "lib/calendar-filters.ts", "@/lib/datetime": "lib/datetime.ts" };
      if (!files[name]) throw Error(`Unexpected import ${name}`); return load(files[name]);
    };
    vm.runInContext(source, vm.createContext({ module: sandboxModule, exports: sandboxModule.exports, require: requireMock, fetch: fetcher, URL, URLSearchParams, Response, Request, Headers, TextEncoder }), { filename: file });
    return sandboxModule.exports;
  }
  return { state, GET: load("app/api/calendar/route.ts").GET, calendarFeed: load("lib/calendar-feed.ts").calendarFeed };
}
function request(filters = {}) { return new Request(`${origin}/api/calendar?${new URLSearchParams({ from: "2026-10-01", to: "2026-10-08", ...filters })}`); }

test("calendar query helper preserves dates and sends group/type filters to the server", () => {
  assert.equal(calendarFeedUrl("2026-10-01", "2026-10-08"), "/api/calendar?from=2026-10-01&to=2026-10-08");
  const params = new URL(calendarFeedUrl("2026-10-01", "2026-10-08", { groupId, kind: "clase" }), origin).searchParams;
  assert.equal(params.get("groupId"), groupId); assert.equal(params.get("kind"), "clase");
  assert.equal(CALENDAR_KIND_VALUES.length, 7);
});

test("calendar GET passes filters before the Supabase limit, preserves CDMX boundaries and exact limited/total", async () => {
  const runtime = harness(); runtime.state.payload = { items: Array(500).fill(event), total: 504, limited: true };
  const response = await runtime.GET(request({ groupId, kind: "festival" }));
  assert.equal(response.status, 200); const result = await response.json();
  assert.equal(result.limited, true); assert.equal(result.total, 504); assert.equal(result.items.length, 500); assert.equal(result.timeZone, "America/Mexico_City");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(JSON.parse(runtime.state.calls[0].options.body), { p_from: "2026-10-01T06:00:00.000Z", p_to_exclusive: "2026-10-09T06:00:00.000Z", p_limit: 500, p_group_id: groupId, p_general_only: false, p_kind: "festival" });
  assert.equal(runtime.state.d1Calls, 0);
});

test("calendar general and all-groups filters have distinct RPC scopes and foreign groups remain empty", async () => {
  for (const [params, expected] of [[{ groupId: "general" }, { p_group_id: null, p_general_only: true }], [{}, { p_group_id: null, p_general_only: false }], [{ groupId: foreignGroupId }, { p_group_id: foreignGroupId, p_general_only: false }]]) {
    const runtime = harness(); runtime.state.payload = { items: [], total: 0, limited: false };
    assert.equal((await runtime.GET(request(params))).status, 200);
    const args = JSON.parse(runtime.state.calls[0].options.body);
    assert.equal(args.p_group_id, expected.p_group_id); assert.equal(args.p_general_only, expected.p_general_only);
    assert.equal(runtime.state.d1Calls, 0);
  }
});

test("calendar rejects invalid filters, dates and missing session/JWT before database access", async () => {
  for (const filters of [{ groupId: "invalid" }, { kind: "invalid" }, { from: "2026-10-09", to: "2026-10-08" }, { from: "2026-01-01", to: "2026-12-31" }, { to: "2026-99-99" }]) {
    const runtime = harness(); assert.equal((await runtime.GET(request(filters))).status, 400); assert.equal(runtime.state.calls.length, 0); assert.equal(runtime.state.d1Calls, 0);
  }
  const anonymous = harness(); anonymous.state.actor = null; assert.equal((await anonymous.GET(request())).status, 401);
  const noJwt = harness(); noJwt.state.actor.supabaseAuth = null; assert.equal((await noJwt.GET(request())).status, 503); assert.equal(noJwt.state.calls.length, 0);
});

test("calendar rejects inconsistent counts/limits and sanitizes database failures", async () => {
  for (const payload of [{ items: [], total: -1, limited: false }, { items: [event], total: 0, limited: false }, { items: [], total: 2, limited: false }, { items: Array(501).fill(event), total: 501, limited: false }]) {
    const runtime = harness(); runtime.state.payload = payload; assert.equal((await runtime.GET(request())).status, 503);
  }
  const runtime = harness(); runtime.state.status = 502; const response = await runtime.GET(request());
  assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /upstream-private|calendar-user-jwt|test-public/); assert.equal(runtime.state.d1Calls, 0);
});

test("legacy calendar filters intersect authorized groups and include tasks only for deliveries", async () => {
  const runtime = harness(); runtime.state.env.SCHOOL_DATA_PROVIDER = "d1";
  runtime.state.events = [
    { ...event, startsAt: new Date(event.startsAt), active: true },
    { ...event, id: "event-b", groupId: foreignGroupId, startsAt: new Date(event.startsAt), active: true },
  ];
  runtime.state.tasks = [{ id: "task-a", groupId, groupName: "Grupo verde", title: "Entrega", dueAt: new Date(event.startsAt), active: true, archivedAt: null }];
  const filtered = await runtime.calendarFeed(runtime.state.actor, { from: "2026-10-01", to: "2026-10-08" }, { groupId, kind: "festival" });
  assert.equal(filtered.items.length, 1); assert.equal(filtered.items[0].id, event.id);
  const deliveries = await runtime.calendarFeed(runtime.state.actor, { from: "2026-10-01", to: "2026-10-08" }, { groupId, kind: "entrega" });
  assert.equal(deliveries.items.length, 1); assert.equal(deliveries.items[0].source, "tarea");
  const foreign = await runtime.calendarFeed(runtime.state.actor, { from: "2026-10-01", to: "2026-10-08" }, { groupId: foreignGroupId });
  assert.equal(foreign.items.length, 0); assert.equal(runtime.state.calls.length, 0);
});

test("legacy calendar uses lookahead then a combined limit, without falsely reporting exactly 500 as truncated", async () => {
  const runtime = harness(); runtime.state.env.SCHOOL_DATA_PROVIDER = "d1";
  runtime.state.events = Array.from({ length: 500 }, (_, index) => ({ ...event, id: `event-${index}`, startsAt: new Date(event.startsAt), active: true }));
  let result = await runtime.calendarFeed(runtime.state.actor, { from: "2026-10-01", to: "2026-10-08" });
  assert.equal(result.items.length, 500); assert.equal(result.limited, false);
  runtime.state.events.push({ ...event, id: "event-501", startsAt: new Date(event.startsAt), active: true });
  result = await runtime.calendarFeed(runtime.state.actor, { from: "2026-10-01", to: "2026-10-08" });
  assert.equal(result.items.length, 500); assert.equal(result.limited, true); assert.ok(runtime.state.limits.every(limit => limit === 501));
});

function renderCalendar({ limited = false, kind = "", group = "", view = "mes", error } = {}) {
  const anchor = new Date("2026-10-08T12:00:00Z");
  const from = view === "mes" ? "2026-09-28" : view === "semana" ? "2026-10-05" : "2026-10-08";
  const to = view === "mes" ? "2026-11-08" : view === "semana" ? "2026-10-11" : "2026-11-06";
  const state = [{ range: calendarFeedUrl(from, to, { groupId: group || undefined, kind: kind || undefined }), items: [event], limited, error }, view, group, kind, anchor, "", "", false, false];
  let index = 0; const sandboxModule = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(new URL("../app/calendario/calendar-view.tsx", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const dependencies = { react: { useState: () => [state[index++], () => {}], useEffect() {}, useRef: value => ({ current: value }) }, "react/jsx-runtime": require("react/jsx-runtime"), "@/lib/calendar-filters": requireCalendarModule("lib/calendar-filters.ts"), "@/lib/datetime": requireCalendarModule("lib/datetime.ts") };
  vm.runInContext(source, vm.createContext({ module: sandboxModule, exports: sandboxModule.exports, require: name => dependencies[name], URLSearchParams }), { filename: "calendar-view.tsx" });
  return renderToStaticMarkup(sandboxModule.exports.CalendarView({ groups: [{ id: groupId, name: "Grupo verde" }], canCreate: false, canCreateGeneral: false }));
}
function requireCalendarModule(file) {
  const sandboxModule = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInContext(source, vm.createContext({ module: sandboxModule, exports: sandboxModule.exports, URLSearchParams })); return sandboxModule.exports;
}

test("calendar renders labeled group/kind controls and a visible limit warning in month, week and agenda", () => {
  for (const view of ["mes", "semana", "agenda"]) {
    const html = renderCalendar({ limited: true, view });
    assert.match(html, /id="calendar-group-filter"/); assert.match(html, /id="calendar-kind-filter"/);
    assert.match(html, /Grupo verde/); assert.match(html, /Clases virtuales/);
    assert.match(html, /primeras 500 actividades/); assert.match(html, /Hay más resultados/); assert.match(html, /Semana/);
  }
  assert.doesNotMatch(renderCalendar({ limited: false }), /primeras 500 actividades/);
  assert.match(renderCalendar({ limited: true, kind: "festival", group: groupId }), /Limpiar filtros/);
  assert.doesNotMatch(renderCalendar({ limited: true, error: "Fallo de conexión" }), /primeras 500 actividades/);
});

test("filtered RPC preserves original authorization, filters before count/page and grants only authenticated execution", () => {
  const sql = fs.readFileSync(new URL("../supabase/migrations/20261028000000_school_calendar_filtered_feed.sql", import.meta.url), "utf8");
  assert.match(sql, /security definer set search_path = ''/); assert.match(sql, /school_actor_active\(\)/);
  assert.match(sql, /school_can_access_group\(event.group_id\)/); assert.match(sql, /school_can_access_group\(task.group_id\)/);
  assert.match(sql, /event.group_id is null and public.school_is_leader\(\)/);
  assert.match(sql, /p_group_id is null or group_id = p_group_id/); assert.match(sql, /p_kind is null or kind = p_kind/);
  assert.match(sql, /count\(\*\) from filtered/); assert.match(sql, /from filtered order by starts_at, sort_id limit p_limit/);
  assert.match(sql, /from public, anon, authenticated/); assert.match(sql, /to authenticated/);
  assert.doesNotMatch(sql, /drop function|insert into|update public|p_actor/);
});

test("calendar PostgreSQL fixture explicitly supplies every required public column without a database default", () => {
  const schema = fs.readFileSync(new URL("../supabase/migrations/20261008000000_school_schema.sql", import.meta.url), "utf8");
  const fixture = fs.readFileSync(new URL("../tests/supabase-calendar-filters.integration.sql", import.meta.url), "utf8");
  const required = new Map();
  for (const [, table, body] of schema.matchAll(/create table public\.([a-z_]+)\s*\(([\s\S]*?)\n\);/g)) {
    const fields = [];
    for (const line of body.split("\n")) {
      const column = line.match(/^\s*([a-z_]+)\s+[a-z]/);
      if (column && !["check", "primary", "unique", "constraint", "foreign"].includes(column[1]) && /\bnot null\b|\bprimary key\b/.test(line) && !/\bdefault\b/.test(line)) fields.push(column[1]);
    }
    required.set(table, fields);
  }
  let checked = 0;
  for (const [, table, fields] of fixture.matchAll(/insert into public\.([a-z_]+)\s*\(([^)]+)\)/g)) {
    assert.ok(required.has(table), `Fixture table ${table} must exist in the actual school schema`);
    const supplied = fields.split(",").map(field => field.trim());
    for (const field of required.get(table)) assert.ok(supplied.includes(field), `Fixture must supply ${table}.${field}; PostgreSQL has no default`);
    checked++;
  }
  assert.equal(checked, 12);
});
