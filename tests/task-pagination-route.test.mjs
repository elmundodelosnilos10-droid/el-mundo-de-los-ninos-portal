import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import * as schema from '../db/schema.ts';

// Actual route/database client + synthetic HTTP transport; real SQLite/Drizzle for the legacy branch.
// These tests do not establish delivery or RLS behavior of a live Supabase provider.
const require = createRequire(import.meta.url);
const origin = 'https://portal.example.test';
const jwt = 'synthetic-task-jwt';
const groupId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const foreignGroup = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const id = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const item = n => ({ id: id(n), groupId, title: 'Tarea sintética ' + n, files: [], studentStatuses: [] });
function harness() {
  const state = {
    env: { SCHOOL_DATA_PROVIDER: 'supabase', SUPABASE_URL: 'https://synthetic-school.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'synthetic-public-key' },
    actor: { id: 'synthetic-actor', roles: ['docente'], supabaseAuth: { userId: 'synthetic-actor', accessToken: jwt } },
    calls: [], d1Calls: 0, accessCalls: 0, queries: [], groups: [groupId],
    status: 200, payload: { items: Array.from({ length: 25 }, (_, n) => item(n + 1)), total: 60 },
    actorFailure: false, accessFailure: false,
  };
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    create table groups(id text primary key,name text,stage text);
    create table tasks(id text primary key,group_id text,title text,instructions text,due_at integer,created_by text,created_at integer,archived_at integer);
    create table task_files(task_id text,file_id text);
    create table files(id text primary key,original_name text,deleted_at integer);
    create table students(id text primary key,active integer);
    create table guardians(id text primary key,user_id text,active integer);
    create table student_guardians(student_id text,guardian_id text,active integer);
    create table enrollments(id text primary key,student_id text,group_id text,ended_at integer);
    create table submissions(id text primary key,task_id text,student_id text,status text);
  `);
  const d1 = drizzle(async (sql, params, method) => {
    state.queries.push({ sql, params, method });
    const statement = sqlite.prepare(sql);
    return { rows: method === 'get' ? Object.values(statement.get(...params) ?? {}) : statement.all(...params).map(row => Object.values(row)) };
  });
  const dependencies = {
    '@/lib/runtime/env': { env: state.env },
    '@/db': { getDb() { state.d1Calls++; if (state.env.SCHOOL_DATA_PROVIDER === 'supabase') throw Error('D1 forbidden'); return d1; } },
    '@/db/schema': schema, 'drizzle-orm': require('drizzle-orm'), zod: require('zod'),
    '@/lib/family-notifications': { notifyGroupFamilies: async () => { throw Error('GET must not notify'); } },
    '@/lib/access': {
      actorFromRequest: async () => { if (state.actorFailure) throw Error('private session detail'); return state.actor; },
      accessibleGroupIds: async () => { state.accessCalls++; if (state.env.SCHOOL_DATA_PROVIDER === 'supabase') throw Error('D1 access forbidden'); if (state.accessFailure) throw Error('private lookup detail'); return state.groups; },
      hasRole: (actor, ...roles) => roles.some(role => actor.roles.includes(role)), mayTeachGroup: async () => true,
      errorResponse: (status, error) => Response.json({ error }, { status }),
    },
  };
  const cache = new Map();
  const files = { '@/lib/supabase/database': 'lib/supabase/database.ts', './local-http-test-policy.ts': 'lib/supabase/local-http-test-policy.ts', '@/lib/supabase/auth-route-utils': 'lib/supabase/auth-route-utils.ts' };
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const sandboxModule = { exports: {} }; cache.set(file, sandboxModule);
    const source = ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const fetcher = async (input, options) => {
      const url = new URL(input); state.calls.push({ url, options });
      assert.equal(options.headers.Authorization, 'Bearer ' + jwt);
      assert.equal(options.headers.apikey, 'synthetic-public-key');
      return Response.json(state.status === 200 ? state.payload : { code: '42501', message: 'private provider detail' }, { status: state.status });
    };
    vm.runInContext(source, vm.createContext({ module: sandboxModule, exports: sandboxModule.exports, URL, URLSearchParams, Request, Response, Headers, TextEncoder, Date, crypto: webcrypto, fetch: fetcher,
      require: name => { if (dependencies[name]) return dependencies[name]; if (files[name]) return load(files[name]); throw Error('Unexpected import ' + name); } }), { filename: file });
    return sandboxModule.exports;
  }
  return { state, sqlite, ...load('app/api/tasks/route.ts'), close: () => sqlite.close() };
}
const get = query => new Request(origin + '/api/tasks' + (query ?? ''));
async function read(h, query) {
  const response = await h.GET(get(query));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return { response, body: await response.json() };
}
function seed(h) {
  h.sqlite.prepare('insert into groups values(?,?,?)').run(groupId, 'Grupo sintético', 'preescolar');
  h.sqlite.prepare('insert into groups values(?,?,?)').run(foreignGroup, 'Ajeno', 'maternal');
  const insert = h.sqlite.prepare('insert into tasks values(?,?,?,?,?,?,?,?)');
  for (let n = 60; n >= 1; n--) insert.run(id(n), groupId, 'Tarea ' + n, 'Texto completo\nSegunda línea', 1791550800, 'synthetic-actor', 1791550000, null);
  insert.run(id(61), foreignGroup, 'Ajena', 'No visible', 1791550800, 'synthetic-actor', 1791550000, null);
  insert.run(id(62), groupId, 'Archivada', 'No visible', 1791550800, 'synthetic-actor', 1791550000, 1791550001);
}

test('GET default returns25/count/page/hasMore with current user JWT and no legacy access', async () => {
  const h = harness(); try {
    const { response, body } = await read(h);
    assert.equal(response.status, 200); assert.equal(body.items.length, 25);
    assert.deepEqual({ total: body.total, page: body.page, pageSize: body.pageSize, hasMore: body.hasMore }, { total: 60, page: 1, pageSize: 25, hasMore: true });
    assert.equal(h.state.calls[0].url.pathname, '/rest/v1/rpc/school_list_tasks');
    assert.deepEqual(JSON.parse(h.state.calls[0].options.body), { p_limit: 25, p_offset: 0 });
    assert.equal(h.state.d1Calls, 0); assert.equal(h.state.accessCalls, 0);
  } finally { h.close(); }
});
test('GET page2,lastpage,beyondlast and authorizedempty return requested pagination', async () => {
  for (const [page, length, total, hasMore] of [[2, 25, 60, true], [3, 10, 60, false], [4, 0, 60, false], [2, 0, 0, false]]) {
    const h = harness(); try {
      h.state.payload = { items: Array.from({ length }, (_, n) => item(n + 1)), total };
      const { response, body } = await read(h, '?page=' + page);
      assert.equal(response.status, 200); assert.equal(body.page, page); assert.equal(body.pageSize, 25);
      assert.equal(body.total, total); assert.equal(body.items.length, length); assert.equal(body.hasMore, hasMore);
      assert.deepEqual(JSON.parse(h.state.calls[0].options.body), { p_limit: 25, p_offset: (page - 1) * 25 });
      assert.equal(h.state.d1Calls, 0);
    } finally { h.close(); }
  }
});
test('GET accepts pageSize100 and RPC offset boundary100000', async () => {
  const h = harness(); try {
    h.state.payload = { items: [], total: 0 };
    const { response, body } = await read(h, '?page=1001&pageSize=100');
    assert.equal(response.status, 200); assert.equal(body.pageSize, 100);
    assert.deepEqual(JSON.parse(h.state.calls[0].options.body), { p_limit: 100, p_offset: 100000 });
  } finally { h.close(); }
});
test('GET malformed/duplicate/nonpositive/unsafe/unsupported pagination fails400 before RPC or D1', async () => {
  const invalid = ['?page=', '?page=0', '?page=-1', '?page=1.5', '?page=1e2', '?page=NaN', '?page=Infinity', '?page=9007199254740992', '?page=9007199254740991&pageSize=100', '?page=4002', '?page=1002&pageSize=100', '?page=1&page=2', '?pageSize=', '?pageSize=0', '?pageSize=-1', '?pageSize=101', '?pageSize=2.5', '?pageSize=25&pageSize=25', '?page=%201'];
  for (const provider of ['supabase', 'd1']) for (const query of invalid) {
    const h = harness(); try {
      h.state.env.SCHOOL_DATA_PROVIDER = provider;
      const { response } = await read(h, query);
      assert.equal(response.status, 400, provider + query); assert.equal(h.state.calls.length, 0);
      assert.equal(h.state.d1Calls, 0); assert.equal(h.state.accessCalls, 0);
    } finally { h.close(); }
  }
});
test('GET anonymous and disallowed roles deny without queries; permitted roles use JWT RPC', async () => {
  for (const role of [null, 'alumno', 'tutor', 'docente', 'direccion', 'superadmin']) {
    const h = harness(); try {
      if (role === null) h.state.actor = null; else h.state.actor.roles = [role];
      const { response } = await read(h);
      assert.equal(response.status, role === null ? 401 : role === 'alumno' ? 403 : 200);
      assert.equal(h.state.calls.length, role === null || role === 'alumno' ? 0 : 1);
      assert.equal(h.state.d1Calls, 0);
    } finally { h.close(); }
  }
});
test('GET rejects missing or foreign verified JWT identity without falling back to D1', async () => {
  for (const auth of [null, { userId: 'foreign-user', accessToken: jwt }]) {
    const h = harness(); try {
      h.state.actor.supabaseAuth = auth;
      const { response } = await read(h); assert.equal(response.status, 503);
      assert.equal(h.state.calls.length, 0); assert.equal(h.state.d1Calls, 0);
    } finally { h.close(); }
  }
});
test('GET invalid provider receipts fail closed without leaking body or credentials', async () => {
  for (const payload of [null, {}, { items: {}, total: 0 }, { items: [], total: -1 }, { items: [], total: 1.5 }, { items: [], total: '5' }, { items: [], total: 9007199254740992 }, { items: Array.from({ length: 26 }, (_, n) => item(n)), total: 30 }]) {
    const h = harness(); try {
      h.state.payload = payload; const { response, body } = await read(h);
      assert.equal(response.status, 503); assert.equal(h.state.calls.length, 1); assert.equal(h.state.d1Calls, 0);
      assert.doesNotMatch(JSON.stringify(body), /private provider|synthetic-task-jwt|synthetic-public-key/);
    } finally { h.close(); }
  }
});
test('GET upstream authorization/revocation/errors preserve safe statuses and no-store', async () => {
  for (const [status, expected] of [[401, 401], [403, 403], [404, 404], [400, 503], [500, 503], [503, 503]]) {
    const h = harness(); try {
      h.state.status = status; const { response, body } = await read(h);
      assert.equal(response.status, expected); assert.equal(h.state.calls.length, 1); assert.equal(h.state.d1Calls, 0);
      assert.doesNotMatch(JSON.stringify(body), /private provider|synthetic-task-jwt|synthetic-public-key/);
    } finally { h.close(); }
  }
});
test('legacy GET uses real SQLite count,limit,offset and stable tie id without omissions', async () => {
  const h = harness(); try {
    h.state.env.SCHOOL_DATA_PROVIDER = 'd1'; seed(h); const seen = [];
    for (let page = 1; page <= 4; page++) {
      const { response, body } = await read(h, '?page=' + page);
      assert.equal(response.status, 200); assert.equal(body.total, 60); assert.equal(body.page, page); assert.equal(body.pageSize, 25);
      assert.equal(body.hasMore, page < 3); seen.push(...body.items.map(row => row.id));
      if (body.items.length) assert.equal(body.items[0].instructions, 'Texto completo\nSegunda línea');
    }
    assert.deepEqual(seen, Array.from({ length: 60 }, (_, n) => id(n + 1))); assert.equal(h.state.calls.length, 0);
    const pages = h.state.queries.filter(q => q.sql.includes('from "tasks"') && !q.sql.includes('count('));
    assert.equal(pages.length, 4); assert.match(pages[1].sql, /order by.*due_at.*asc.*id.*asc.*limit.*offset/i);
    assert.deepEqual(pages[1].params.slice(-2), [25, 25]);
    assert.equal(h.state.queries.filter(q => q.sql.includes('count(')).length, 4);
  } finally { h.close(); }
});
test('legacy family retains attachments and child delivery states for only current page', async () => {
  const h = harness(); try {
    h.state.env.SCHOOL_DATA_PROVIDER = 'd1'; h.state.actor.roles = ['tutor']; seed(h);
    h.sqlite.prepare('insert into students values(?,?)').run(id(100), 1);
    h.sqlite.prepare('insert into guardians values(?,?,?)').run(id(101), 'synthetic-actor', 1);
    h.sqlite.prepare('insert into student_guardians values(?,?,?)').run(id(100), id(101), 1);
    h.sqlite.prepare('insert into enrollments values(?,?,?,?)').run(id(102), id(100), groupId, null);
    h.sqlite.prepare('insert into submissions values(?,?,?,?)').run(id(103), id(26), id(100), 'revisada');
    h.sqlite.prepare('insert into files values(?,?,?)').run(id(104), 'Guía sintética.pdf', null);
    h.sqlite.prepare('insert into files values(?,?,?)').run(id(105), 'Borrada.pdf', 1);
    h.sqlite.prepare('insert into task_files values(?,?)').run(id(26), id(104));
    h.sqlite.prepare('insert into task_files values(?,?)').run(id(26), id(105));
    const { response, body } = await read(h, '?page=2'); assert.equal(response.status, 200);
    assert.equal(body.items[0].id, id(26)); assert.deepEqual(body.items[0].files, [{ id: id(104), name: 'Guía sintética.pdf', url: '/api/files/' + id(104) }]);
    assert.deepEqual(body.items[0].studentStatuses, [{ studentId: id(100), status: 'revisada' }]);
    assert.equal(body.items[1].studentStatuses[0].status, Date.now() > 1791550800 * 1000 ? 'vencida' : 'pendiente');
    const attachmentQuery = h.state.queries.find(q => q.sql.includes('from "task_files"'));
    assert.ok(attachmentQuery.params.includes(id(26))); assert.equal(attachmentQuery.params.includes(id(1)), false);
  } finally { h.close(); }
});
test('legacy no authorized groups returns empty metadata without DB initialization', async () => {
  const h = harness(); try {
    h.state.env.SCHOOL_DATA_PROVIDER = 'd1'; h.state.groups = [];
    const { response, body } = await read(h, '?page=3&pageSize=10'); assert.equal(response.status, 200);
    assert.deepEqual(body, { items: [], total: 0, page: 3, pageSize: 10, hasMore: false }); assert.equal(h.state.d1Calls, 0);
  } finally { h.close(); }
});
test('session,legacy permission and legacy SQL errors return sanitized503 and no-store', async () => {
  for (const failure of ['session', 'access', 'sql']) {
    const h = harness(); try {
      if (failure === 'session') h.state.actorFailure = true;
      else { h.state.env.SCHOOL_DATA_PROVIDER = 'd1'; if (failure === 'access') h.state.accessFailure = true; else h.sqlite.exec('drop table tasks'); }
      const { response, body } = await read(h); assert.equal(response.status, 503);
      assert.doesNotMatch(JSON.stringify(body), /private|no such table|select /i); assert.equal(h.state.calls.length, 0);
    } finally { h.close(); }
  }
});
test('POST retains CSRF/role checks and one confirmed201 task receipt without D1', async () => {
  const h = harness(); try {
    h.state.payload = { id: id(500) };
    const request = requestOrigin => new Request(origin + '/api/tasks', { method: 'POST', headers: { origin: requestOrigin, 'content-type': 'application/json' }, body: JSON.stringify({ groupId, title: 'Tarea nueva', instructions: 'Actividad sintética' }) });
    assert.equal((await h.POST(request('https://foreign.example.test'))).status, 403); assert.equal(h.state.calls.length, 0);
    const response = await h.POST(request(origin)); assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { id: id(500) }); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(h.state.calls[0].url.pathname, '/rest/v1/rpc/school_create_task'); assert.equal(h.state.calls.length, 1); assert.equal(h.state.d1Calls, 0);
    h.state.actor.roles = ['tutor']; assert.equal((await h.POST(request(origin))).status, 403); assert.equal(h.state.calls.length, 1);
  } finally { h.close(); }
});
