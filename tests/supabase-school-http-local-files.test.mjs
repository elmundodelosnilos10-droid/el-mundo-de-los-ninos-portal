import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalHttp } from '../scripts/supabase-school-http-local-support.mjs';
import { prepareSchoolPrivateFiles, attachSchoolSubmissionFile } from '../scripts/supabase-school-http-local-files.mjs';

const id = number => `10000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const groupId = id(1), taskId = id(2), studentId = id(3), materialId = id(4);
const teacher = new Map([['session', 'teacher']]);
const familyA = new Map([['session', 'familyA']]);
const familyB = new Map([['session', 'familyB']]);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function fixture({ failFirstUpload = false, foreignFilterStatus = 404 } = {}) {
  const requests = [], evidence = [], checks = [], files = new Map();
  let materialFileId, taskFileId, submissionFileId, nextFile = 10;
  const http = new LocalHttp({ appOrigin: 'http://127.0.0.1:5199', supabaseOrigin: 'http://127.0.0.1:25488', evidence, fetchImpl: async (url, options) => {
    const role = options.headers.Cookie?.replace('session=', '') ?? 'anonymous';
    const { pathname: path, searchParams: params } = url;
    requests.push({ path, method: options.method, role, group: params.get('groupId'), q: params.get('q'), category: params.get('category') });
    assert.equal(options.redirect, 'manual');
    if (path === '/api/files' && options.method === 'POST') {
      if (failFirstUpload) throw new Error('private uncertain upload');
      assert.ok(options.body instanceof FormData);
      assert.equal(options.headers['Content-Type'], undefined);
      const form = options.body, purpose = form.get('purpose');
      if (role === 'familyB') return json({ error: 'No disponible' }, 404);
      const file = form.get('file');
      assert.equal(file.type, 'application/pdf');
      const fileId = id(nextFile++);
      files.set(fileId, new Uint8Array(await file.arrayBuffer()));
      if (purpose === 'material') {
        assert.equal(role, 'teacher'); assert.equal(form.get('groupId'), groupId);
        assert.equal(form.get('category'), 'Guía'); materialFileId = fileId;
      } else if (purpose === 'task') {
        assert.equal(role, 'teacher'); assert.equal(form.get('taskId'), taskId); taskFileId = fileId;
      } else {
        assert.equal(purpose, 'submission'); assert.equal(role, 'familyA');
        assert.equal(form.get('studentId'), studentId); submissionFileId = fileId;
      }
      return json({ id: fileId }, 201);
    }
    if (path === '/api/materials') {
      assert.equal(params.get('q'), 'HTTP synthetic'); assert.equal(params.get('category'), 'Guía');
      assert.equal(params.get('page'), '1'); assert.equal(params.get('pageSize'), '12');
      if (role === 'familyB' && params.has('groupId')) return json({ error: 'No disponible' }, foreignFilterStatus);
      return json({ items: role === 'familyA' ? [{ id: materialId, fileId: materialFileId, category: 'Guía' }] : [], total: role === 'familyA' ? 1 : 0, page: 1, pageSize: 12 });
    }
    if (path.startsWith('/api/files/')) {
      if (role === 'anonymous') return json({ error: 'Ingresa' }, 401);
      if (role === 'familyB') return json({ error: 'No disponible' }, 404);
      const bytes = files.get(path.split('/').at(-1)); assert.ok(bytes);
      return new Response(bytes, { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
    }
    if (path === '/api/tasks') return json({ items: [{ id: taskId, files: [{ id: taskFileId }] }] });
    if (path === `/api/materials/${materialId}/replace`) {
      if (role === 'familyA') return json({ error: 'Sin permiso' }, 403);
      assert.equal(role, 'teacher'); const file = options.body.get('file');
      files.set(materialFileId, new Uint8Array(await file.arrayBuffer()));
      return json({ id: materialId, fileId: materialFileId, name: file.name });
    }
    if (path === `/api/tasks/${taskId}/submissions`) return json({ items: [{ studentId, status: 'entregada', files: [{ id: submissionFileId }] }] });
    assert.fail(`Unexpected fixture route ${options.method} ${path}`);
  } });
  const call = (jar, path, options) => http.request('app', path, { ...options, jar });
  const check = (label, valid) => { assert.equal(valid, true, label); checks.push(label); };
  const args = { call, teacher, familyA, familyB, groupId, taskId, studentId, suffix: 'synthetic', check };
  return { args, requests, evidence, checks };
}

test('file helper confirms foreign group404, own empty feed, private downloads, replacement and submission evidence', async () => {
  const f = fixture();
  const { evidenceBytes } = await prepareSchoolPrivateFiles(f.args);
  await attachSchoolSubmissionFile({ ...f.args, evidenceBytes });
  const libraryB = f.requests.filter(row => row.path === '/api/materials' && row.role === 'familyB');
  assert.equal(libraryB.length, 2);
  assert.equal(libraryB[0].group, groupId);
  assert.equal(libraryB[1].group, null);
  assert.equal(libraryB[1].q, libraryB[0].q);
  assert.equal(libraryB[1].category, libraryB[0].category);
  assert.equal(f.evidence.find(row => row.label === 'B no consulta filtro de grupo ajeno').status, 404);
  assert.equal(f.evidence.find(row => row.label === 'Biblioteca privada autorizada de B').status, 200);
  assert.equal(f.checks.length, 10);
  for (const secret of ['session=', 'familyA', '%PDF-', materialId, groupId, 'HTTP synthetic']) assert.ok(!JSON.stringify(f.evidence).includes(secret));
});

test('unexpected foreign filter success stops the helper instead of accepting a privacy contract change', async () => {
  const f = fixture({ foreignFilterStatus: 200 });
  await assert.rejects(prepareSchoolPrivateFiles(f.args), /HTTP200/);
  assert.equal(f.requests.at(-1).path, '/api/materials');
  assert.equal(f.requests.filter(row => row.method === 'POST').length, 1);
});

test('an uncertain upload halts without replay or subsequent reads and records no private payload', async () => {
  const f = fixture({ failFirstUpload: true });
  await assert.rejects(prepareSchoolPrivateFiles(f.args), /No se reintentó/);
  assert.equal(f.requests.length, 1);
  assert.equal(f.evidence[0].mutationOutcome, 'uncertain');
  assert.ok(!JSON.stringify(f.evidence).includes('private uncertain'));
});
