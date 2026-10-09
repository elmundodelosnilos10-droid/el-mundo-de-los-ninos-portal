import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalHttp } from '../scripts/supabase-school-http-local-support.mjs';
import { exercisePrivateSchoolChat } from '../scripts/supabase-school-chat-http-local-flow.mjs';
import { restoredChatConfig, restoredChatProfilesMatch } from '../scripts/accept-school-chat-restored-local.mjs';

const id = number => `10000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const teacher = { id: id(1), jar: new Map([['session', 'teacher']]) };
const families = ['A', 'B'].map((label, index) => ({ id: id(2 + index), ownStudentId: id(10 + index), jar: new Map([['session', label]]) }));
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });

function fixture({ failSend = false, allowForeignRead = false } = {}) {
  const conversations = [], messages = [], notices = [], checks = [], evidence = [], requests = [];
  let sequence = 20;
  const accounts = { teacher, A: families[0], B: families[1] };
  const http = new LocalHttp({ appOrigin: 'http://127.0.0.1:5199', supabaseOrigin: 'http://127.0.0.1:31562', evidence, fetchImpl: async (url, options) => {
    const role = options.headers.Cookie?.replace('session=', '') ?? 'anonymous', account = accounts[role];
    requests.push({ method: options.method, path: url.pathname, role });
    if (!account) return reply({ error: 'Ingresa' }, 401);
    assert.equal(options.redirect, 'manual'); assert.equal(options.headers.Origin, 'http://127.0.0.1:5199');
    const body = options.body ? JSON.parse(options.body) : null;
    const permitted = row => role === 'teacher' || row.familyId === account.id;
    if (url.pathname === '/api/conversations') {
      if (options.method === 'POST') {
        if (body.studentId !== account.ownStudentId) return reply({ error: 'No disponible' }, 404);
        const conversation = { id: id(sequence++), familyId: account.id }; conversations.push(conversation); return reply({ id: conversation.id }, 201);
      }
      return reply({ items: conversations.filter(permitted).map(row => ({ id: row.id, unreadCount: messages.filter(message => message.conversationId === row.id && message.authorId !== account.id && message.readAt === null).length })) });
    }
    if (url.pathname === '/api/notifications') return reply({ items: notices.filter(row => row.userId === account.id) });
    const match = /^\/api\/conversations\/([^/]+)\/messages(?:\/read)?$/.exec(url.pathname);
    assert.ok(match); const conversation = conversations.find(row => row.id === match[1]);
    if (!conversation || !permitted(conversation) && !(allowForeignRead && options.method === 'GET')) return reply({ error: 'No disponible' }, 404);
    if (url.pathname.endsWith('/read')) {
      const through = messages.find(row => row.order === body.throughOrder); assert.ok(through);
      for (const message of messages) if (message.conversationId === conversation.id && message.authorId !== account.id && message.order <= through.order) message.readAt = '2026-10-09T08:00:01Z';
      return reply({ readAt: '2026-10-09T08:00:01Z' });
    }
    if (options.method === 'POST') {
      if (failSend) throw Error('private message uncertain');
      const message = { id: id(sequence++), conversationId: conversation.id, body: body.body, authorId: account.id, readAt: null };
      message.order = `2026-10-09T08:00:00.${String(sequence).padStart(6, '0')}Z|${message.id}`;
      messages.push(message); notices.push({ kind: 'mensaje', userId: role === 'teacher' ? conversation.familyId : teacher.id });
      return reply({ id: message.id }, 201);
    }
    return reply({ items: messages.filter(row => row.conversationId === conversation.id).map(row => ({ ...row, isMine: row.authorId === account.id })), hasOlder: false, nextCursor: null });
  } });
  const call = (account, route, options = {}) => http.request('app', route, { ...options, jar: account?.jar });
  const check = (label, valid) => { assert.equal(valid, true, label); checks.push(label); };
  return { args: { call, teacher, families, teacherId: id(12), check }, requests, evidence, checks, messages };
}

test('real flow helper executes both directions, persisted receipts, private notices and family denials', async () => {
  const f = fixture(); const result = await exercisePrivateSchoolChat(f.args);
  assert.equal(result.conversations.length, 2); assert.equal(result.messageIds.length, 4);
  assert.equal(f.checks.length, 19); assert.ok(f.messages.every(row => typeof row.readAt === 'string'));
  assert.equal(f.evidence.filter(row => row.status === 404).length, 6);
  for (const value of ['session=', 'Mensaje docente', 'Respuesta familiar', families[0].id, result.conversations[0]]) assert.ok(!JSON.stringify(f.evidence).includes(value));
});

test('helper rejects a foreign HTTP200 and stops instead of declaring an isolation pass', async () => {
  const f = fixture({ allowForeignRead: true });
  await assert.rejects(exercisePrivateSchoolChat(f.args), /HTTP200/);
  assert.equal(f.requests.at(-1).method, 'GET'); assert.equal(f.requests.at(-1).role, 'B');
  assert.equal(f.messages.length, 1);
});

test('uncertain send is never replayed and no subsequent chat request runs', async () => {
  const f = fixture({ failSend: true });
  await assert.rejects(exercisePrivateSchoolChat(f.args), /No se reintentó/);
  assert.equal(f.requests.filter(row => row.path.endsWith('/messages') && row.method === 'POST').length, 1);
  assert.equal(f.evidence.at(-1).mutationOutcome, 'uncertain');
  assert.ok(!JSON.stringify(f.evidence).includes('private message'));
});

test('acceptance configuration requires explicit restored fixture acknowledgement and literal loopback', () => {
  const environment = { LOCAL_SCHOOL_CHAT_ISOLATED: 'restored-disposable-target', LOCAL_SCHOOL_CHAT_APP_URL: 'http://127.0.0.1:5199', LOCAL_SCHOOL_CHAT_RUNTIME_DIRECTORY: '/tmp/isolated', LOCAL_SCHOOL_CHAT_EVIDENCE_FILE: '/tmp/isolated/chat.json' };
  assert.equal(restoredChatConfig(environment).appOrigin, 'http://127.0.0.1:5199');
  for (const patch of [{ LOCAL_SCHOOL_CHAT_ISOLATED: undefined }, { LOCAL_SCHOOL_CHAT_APP_URL: 'https://school.example' }, { LOCAL_SCHOOL_CHAT_APP_URL: 'http://localhost:5199' }, { LOCAL_SCHOOL_CHAT_APP_URL: 'http://127.0.0.1:5199/path' }, { LOCAL_SCHOOL_CHAT_RUNTIME_DIRECTORY: 'relative' }, { LOCAL_SCHOOL_CHAT_EVIDENCE_FILE: '/tmp/chat.txt' }]) assert.throws(() => restoredChatConfig({ ...environment, ...patch }));
});

test('cleanup permits only advancing Auth-managed timestamp of known family profiles', () => {
  const original = [{ id: id(2), active: true, name: 'Synthetic family', updated_at: '2026-10-09T08:00:00Z' }, { id: id(9), active: true, name: 'Other', updated_at: '2026-10-09T08:00:00Z' }];
  const newer = original.map(row => ({ ...row })); newer[0].updated_at = '2026-10-09T08:01:00Z';
  assert.equal(restoredChatProfilesMatch(original, newer, new Set([id(2)])), true);
  for (const patch of [{ name: 'Changed' }, { active: false }, { updated_at: 'invalid' }, { updated_at: '2026-10-09T07:59:00Z' }]) assert.equal(restoredChatProfilesMatch(original, [{ ...newer[0], ...patch }, newer[1]], new Set([id(2)])), false);
  assert.equal(restoredChatProfilesMatch(original, [newer[0], { ...newer[1], updated_at: '2026-10-09T08:01:00Z' }], new Set([id(2)])), false);
  assert.equal(restoredChatProfilesMatch(original, [...newer, { ...newer[0], id: id(30) }], new Set([id(2)])), false);
});
