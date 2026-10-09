import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalHttp, ISOLATED_ACK, localConfig, localCredentials, loopbackOrigin, requireEmptyLocalStack } from '../scripts/supabase-school-http-local-support.mjs';
import { runSchoolHttpLocal } from '../scripts/run-supabase-school-http-local.mjs';

const config = { appOrigin: 'http://127.0.0.1:5199', supabaseOrigin: 'http://127.0.0.1:54321' };
const reply = (body, status = 200, headers) => new Response(body === null ? null : JSON.stringify(body), { status, headers });
const validEnv = { LOCAL_SCHOOL_HTTP_ISOLATED: ISOLATED_ACK, LOCAL_SCHOOL_HTTP_APP_URL: config.appOrigin, LOCAL_SCHOOL_HTTP_SUPABASE_URL: config.supabaseOrigin, LOCAL_SCHOOL_HTTP_CREDENTIALS_FILE: '/tmp/school-http-local-credentials.json', LOCAL_SCHOOL_HTTP_EVIDENCE_FILE: '/tmp/evidence.json' };

test('only literal loopback origins with explicit ports are accepted', () => {
  for (const value of ['http://localhost:54321', 'https://127.0.0.1:54321', 'http://127.0.0.1', 'http://127.0.0.2:54321', 'http://2130706433:54321', 'http://127.1:54321', 'http://127.0.0.1.example.org:54321', 'http://user:password@127.0.0.1:54321', 'http://127.0.0.1:54321/path', 'http://127.0.0.1:54321/?secret=1', 'http://127.0.0.1:54321/#x', 'http://127.0.0.1:65536', 'http://[::ffff:127.0.0.1]:54321']) assert.throws(() => loopbackOrigin(value, 'Test'));
  assert.equal(loopbackOrigin('http://[::1]:54321/', 'Test'), 'http://[::1]:54321');
  assert.equal(loopbackOrigin(config.appOrigin, 'Test'), config.appOrigin);
});

test('configuration has no defaults, ignores production env names and requires isolated acknowledgement', () => {
  assert.throws(() => localConfig({ APP_ORIGIN: config.appOrigin, SUPABASE_URL: config.supabaseOrigin }));
  assert.throws(() => localConfig({ ...validEnv, LOCAL_SCHOOL_HTTP_ISOLATED: undefined }));
  assert.throws(() => localConfig({ ...validEnv, LOCAL_SCHOOL_HTTP_SUPABASE_URL: config.appOrigin }));
  for (const path of ['/tmp/.env', '/tmp/.dev.vars', 'school-http-local-credentials.json']) assert.throws(() => localConfig({ ...validEnv, LOCAL_SCHOOL_HTTP_CREDENTIALS_FILE: path }));
  assert.deepEqual(localConfig(validEnv), { ...config, credentialsFile: validEnv.LOCAL_SCHOOL_HTTP_CREDENTIALS_FILE, evidenceFile: validEnv.LOCAL_SCHOOL_HTTP_EVIDENCE_FILE });
});

test('dedicated credentials reader enforces JSON, regular file, exact fields and0600 without leaking values', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'school-http-keys-test-'));
  const path = join(dir, 'school-http-local-credentials.json');
  try {
    await writeFile(path, JSON.stringify({ anonKey: 'local-public', serviceRoleKey: 'local-secret' }), { mode: 0o600 });
    assert.deepEqual(await localCredentials(path), { anonKey: 'local-public', serviceRoleKey: 'local-secret' });
    await chmod(path, 0o644); await assert.rejects(localCredentials(path), /0600/);
    await chmod(path, 0o600); await writeFile(path, '{ secret-invalid-json');
    await assert.rejects(localCredentials(path), cause => !cause.message.includes('secret-invalid-json'));
    await writeFile(path, JSON.stringify({ anonKey: 'local-public', serviceRoleKey: 'local-secret', production: true }));
    await assert.rejects(localCredentials(path), /diferentes/);
    await symlink(path, join(dir, 'link.json')); await assert.rejects(localCredentials(join(dir, 'link.json')), /regular/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('redirects never follow and mutations never automatically retry; evidence omits bodies, headers, query and IDs', async () => {
  const evidence = []; const seen = [];
  const http = new LocalHttp({ ...config, evidence, fetchImpl: async (url, options) => { seen.push({ url, options }); return reply({ password: 'secret-value' }, 307, { Location: 'https://production.example/' }); } });
  await assert.rejects(http.request('app', '/api/students/10000000-0000-4000-8000-000000000001?token=secret-query', { method: 'POST', body: { password: 'secret-password' }, headers: { Authorization: 'Bearer secret-auth' }, jar: new Map([['school_session', 'secret-cookie']]), label: 'Mutation' }), /redirect-rejected/);
  assert.equal(seen.length, 1); assert.equal(seen[0].options.redirect, 'manual');
  assert.equal(evidence[0].mutationOutcome, 'uncertain');
  const serialized = JSON.stringify(evidence);
  for (const privateValue of ['secret-value', 'secret-query', 'secret-password', 'secret-auth', 'secret-cookie', '10000000-0000-4000-8000-000000000001']) assert.ok(!serialized.includes(privateValue));
  await assert.rejects(http.request('app', '//production.example/path'), /Destino/);
  await assert.rejects(http.request('app', 'https://production.example/path'), /Destino/);
  assert.equal(seen.length, 1);
});

test('timeout reports method/path and uncertain mutation without propagating fetch error or retrying', async () => {
  let calls = 0; const evidence = [];
  const http = new LocalHttp({ ...config, timeoutMs: 5, evidence, fetchImpl: async (_url, { signal }) => {
    calls++;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Bearer leaked-secret')), { once: true }));
  } });
  await assert.rejects(http.request('app', '/api/tasks', { method: 'POST', body: { title: 'Synthetic' } }), cause => cause.message.includes('POST /api/tasks') && !cause.message.includes('leaked-secret'));
  assert.equal(calls, 1); assert.equal(evidence[0].mutationOutcome, 'uncertain');
});

test('deadline also covers stalled response-body streaming', async () => {
  const http = new LocalHttp({ ...config, timeoutMs: 5, fetchImpl: async (_url, { signal }) => new Response(new ReadableStream({ start(controller) { signal.addEventListener('abort', () => controller.error(new Error('private-secret')), { once: true }); } }), { status: 200 }) });
  await assert.rejects(http.request('app', '/api/students'), /network-or-timeout/);
});

test('cookie jar updates cookies in memory including deletion; no credentials appear in evidence', async () => {
  const evidence = []; const jar = new Map();
  let call = 0;
  const http = new LocalHttp({ ...config, evidence, fetchImpl: async (_url, options) => {
    call++;
    if (call === 1) return reply({ user: { id: 'synthetic' } }, 200, { 'Set-Cookie': 'school_auth=private-cookie; HttpOnly; Path=/' });
    assert.equal(options.headers.Cookie, 'school_auth=private-cookie');
    return reply({ success: true }, 200, { 'Set-Cookie': 'school_auth=; Max-Age=0; Path=/' });
  } });
  await http.request('app', '/api/auth/sign-in/email', { method: 'POST', jar }); assert.equal(jar.size, 1);
  await http.request('app', '/api/auth/sign-out', { method: 'POST', jar }); assert.equal(jar.size, 0);
  assert.ok(!JSON.stringify(evidence).includes('private-cookie'));
});

test('preflight rejects existing Auth identities before any provisioning', async () => {
  const seen = [];
  const http = new LocalHttp({ ...config, fetchImpl: async (url, options) => { seen.push({ url, method: options.method }); return reply({ users: [{ id: 'existing-person' }] }); } });
  await assert.rejects(requireEmptyLocalStack(http, {}), /contiene identidades/);
  assert.equal(seen.length, 1); assert.ok(seen.every(entry => entry.method === 'GET'));
});

test('preflight rejects a nonempty school table even with empty Auth', async () => {
  const seen = [];
  const http = new LocalHttp({ ...config, fetchImpl: async (url, options) => {
    seen.push(options.method); return reply(url.pathname.includes('/auth/') ? { users: [] } : [{ id: 'existing' }]);
  } });
  await assert.rejects(requireEmptyLocalStack(http, {}), /no está vacío/);
  assert.deepEqual(seen, ['GET', 'GET']);
});

test('runner stops on first uncertain provisioning POST and never exposes a generated password', async () => {
  const evidence = []; const seen = []; const privateValues = [];
  await assert.rejects(runSchoolHttpLocal(config, { anonKey: 'local-public', serviceRoleKey: 'local-secret' }, { evidence, fetchImpl: async (url, options) => {
    seen.push({ path: url.pathname, method: options.method });
    if (options.method === 'POST') { privateValues.push(JSON.parse(options.body).password); throw new Error('service-key local-secret'); }
    return reply(url.pathname.includes('/auth/') ? { users: [] } : []);
  } }), /No se reintentó/);
  assert.equal(seen.filter(row => row.method === 'POST').length, 1);
  assert.ok(!JSON.stringify(evidence).includes('local-secret'));
  assert.ok(!JSON.stringify(evidence).includes(privateValues[0]));
  assert.equal(evidence.at(-1).mutationOutcome, 'uncertain');
});

test('an app session with a different Auth UUID halts before every school write', async () => {
  const seen = []; let counter = 0;
  const uuid = () => `10000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
  await assert.rejects(runSchoolHttpLocal(config, { anonKey: 'local-public', serviceRoleKey: 'local-secret' }, { fetchImpl: async (url, options) => {
    seen.push({ host: url.origin, path: url.pathname, method: options.method });
    if (url.origin === config.supabaseOrigin) {
      if (url.pathname === '/auth/v1/admin/users') return reply(options.method === 'GET' ? { users: [] } : { id: uuid() }, options.method === 'GET' ? 200 : 201);
      return reply([], options.method === 'POST' ? 201 : 200);
    }
    if (url.pathname === '/api/students') return reply({ error: 'not-signed-in' }, 401);
    if (url.pathname === '/api/auth/sign-in/email') return reply({ user: {} }, 200, { 'Set-Cookie': 'school_session=local-private-cookie; HttpOnly; Path=/' });
    if (url.pathname === '/api/auth/get-session') return reply({ user: { id: uuid(), email: 'different@example.test' } });
    assert.fail(`Unexpected route ${url.pathname}`);
  } }), /Identidad local/);
  assert.equal(seen.filter(row => row.host === config.appOrigin && row.method !== 'GET' && !row.path.startsWith('/api/auth/')).length, 0);
});

test('actual loopback HTTP transport sends JSON, Origin and private cookies without logging them', async () => {
  const { createServer } = await import('node:http');
  const server = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk;
    assert.equal(request.headers.origin, `http://127.0.0.1:${server.address().port}`);
    assert.equal(request.headers.cookie, 'local_session=private-cookie');
    assert.deepEqual(JSON.parse(body), { synthetic: true });
    response.writeHead(201, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ created: true }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const evidence = [];
    const http = new LocalHttp({ ...config, appOrigin: `http://127.0.0.1:${server.address().port}`, evidence });
    assert.deepEqual(await http.request('app', '/synthetic', { method: 'POST', body: { synthetic: true }, jar: new Map([['local_session', 'private-cookie']]), statuses: [201] }), { created: true });
    assert.ok(!JSON.stringify(evidence).includes('private-cookie')); assert.equal(evidence[0].status, 201);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
