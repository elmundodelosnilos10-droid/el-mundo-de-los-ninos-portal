import test from 'node:test';
import assert from 'node:assert/strict';
import { permitsIsolatedSupabaseHttp } from '../lib/supabase/local-http-test-policy.ts';
import { createSupabaseAuthClient } from '../lib/supabase/auth.ts';
import { createSupabaseDatabaseClient } from '../lib/supabase/database.ts';

const testEnv = { NODE_ENV: 'test', SCHOOL_LOCAL_SUPABASE_HTTP: 'isolated-test' };
const local = 'http://127.0.0.1:25488';

test('local HTTP requires explicit development/test opt-in and is never allowed on Vercel or production', () => {
  for (const environment of [{}, { NODE_ENV: 'test' }, { SCHOOL_LOCAL_SUPABASE_HTTP: 'isolated-test' }, { ...testEnv, NODE_ENV: 'production' }, { ...testEnv, NODE_ENV: undefined }, { ...testEnv, SCHOOL_LOCAL_SUPABASE_HTTP: 'true' }, { ...testEnv, VERCEL: '1' }, { ...testEnv, VERCEL: '0' }, { ...testEnv, VERCEL: '' }]) assert.equal(permitsIsolatedSupabaseHttp(local, environment), false);
  assert.equal(permitsIsolatedSupabaseHttp(local, testEnv), true);
  assert.equal(permitsIsolatedSupabaseHttp('http://[::1]:25488/', { ...testEnv, NODE_ENV: 'development' }), true);
});

test('HTTP exception rejects DNS, parser shorthands, nonloopback, credentials and all extra URL components', () => {
  for (const value of ['http://localhost:25488', 'http://127.1:25488', 'http://2130706433:25488', 'http://127.0.0.2:25488', 'http://127.0.0.1.example.com:25488', 'http://[::ffff:127.0.0.1]:25488', 'http://user:private@127.0.0.1:25488', 'http://127.0.0.1', 'http://127.0.0.1:0', 'http://127.0.0.1:65536', 'http://127.0.0.1:25488/path', 'http://127.0.0.1:25488?token=private', 'http://127.0.0.1:25488/#x', 'http://127.0.0.1:025488', 'http://127.0.0.1:25488\\@example.com', '\nhttp://127.0.0.1:25488', 'https://127.0.0.1:25488']) assert.equal(permitsIsolatedSupabaseHttp(value, testEnv), false, value);
});

async function withEnv(values, work) {
  const keys = ['NODE_ENV', 'SCHOOL_LOCAL_SUPABASE_HTTP', 'VERCEL'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) { if (values[key] === undefined) delete process.env[key]; else process.env[key] = values[key]; }
  try { await work(); }
  finally { for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } }
}

const session = { access_token: 'synthetic-access-token', refresh_token: 'synthetic-refresh-token', expires_in: 3600, token_type: 'bearer', user: { id: '10000000-0000-4000-8000-000000000001', email: 'synthetic@example.test' } };

test('real Auth and database factories honor local opt-in while retaining JWT/public key and redirect policy', async () => {
  await withEnv(testEnv, async () => {
    const requests = [];
    const auth = createSupabaseAuthClient({ url: local, publishableKey: 'synthetic-public-key' }, async (url, init) => { requests.push({ url: String(url), init }); return Response.json(session); });
    assert.equal((await auth.signIn('synthetic@example.test', 'synthetic-password-only')).user.id, session.user.id);
    const db = createSupabaseDatabaseClient({ url: local, publishableKey: 'synthetic-public-key' }, async (url, init) => { requests.push({ url: String(url), init }); return Response.json({ items: [] }); });
    assert.deepEqual(await db.rpc(session.access_token, 'school_list_tasks', { p_limit: 1, p_offset: 0 }), { data: [{ items: [] }] });
    assert.equal(requests[0].url, `${local}/auth/v1/token?grant_type=password`);
    assert.equal(requests[1].url, `${local}/rest/v1/rpc/school_list_tasks`);
    for (const request of requests) { assert.equal(request.init.headers.apikey, 'synthetic-public-key'); assert.equal(request.init.redirect, 'error'); }
    assert.equal(requests[1].init.headers.Authorization, `Bearer ${session.access_token}`);
  });
});

test('factory HTTP remains fail closed with production, Vercel or missing opt-in even if local URL is supplied', async () => {
  for (const environment of [{ ...testEnv, NODE_ENV: 'production' }, { ...testEnv, VERCEL: '1' }, { NODE_ENV: 'development' }]) {
    await withEnv(environment, async () => {
      let calls = 0; const fetcher = async () => { calls++; return Response.json(session); };
      const auth = createSupabaseAuthClient({ url: local, publishableKey: 'synthetic-public' }, fetcher);
      const db = createSupabaseDatabaseClient({ url: local, publishableKey: 'synthetic-public' }, fetcher);
      await assert.rejects(auth.signIn('synthetic@example.test', 'synthetic-password-only'));
      await assert.rejects(db.rpc('synthetic-user-token', 'school_list_tasks', {}));
      assert.equal(calls, 0);
    });
  }
});

test('HTTPS production clients keep working with opt-in present and Vercel set', async () => {
  await withEnv({ NODE_ENV: 'production', SCHOOL_LOCAL_SUPABASE_HTTP: 'isolated-test', VERCEL: '1' }, async () => {
    const requests = []; const origin = 'https://synthetic.supabase.example';
    const auth = createSupabaseAuthClient({ url: origin, publishableKey: 'synthetic-public' }, async url => { requests.push(String(url)); return Response.json(session); });
    const db = createSupabaseDatabaseClient({ url: origin, publishableKey: 'synthetic-public' }, async url => { requests.push(String(url)); return Response.json([]); });
    await auth.signIn('synthetic@example.test', 'synthetic-password-only'); await db.select('synthetic-user-token', 'students', { columns: ['id'], limit: 1 });
    assert.equal(requests.length, 2); assert.ok(requests.every(url => url.startsWith(origin)));
  });
});
