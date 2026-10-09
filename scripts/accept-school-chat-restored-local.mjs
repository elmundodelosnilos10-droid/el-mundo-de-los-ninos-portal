import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, lstat, open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import postgres from 'postgres';
import { LocalHttp, localCredentials, loopbackOrigin, requiredId } from './supabase-school-http-local-support.mjs';
import { loadSchoolBackupTables, stableStringify } from './supabase-school-backup.mjs';
import { sha256 } from './backup-crypto.mjs';
import { exercisePrivateSchoolChat } from './supabase-school-chat-http-local-flow.mjs';

const canonical = rows => stableStringify(rows.map(row => stableStringify(row)).sort());
/** Auth's profile trigger legitimately advances updated_at during login. All
 * other existing profile fields must remain identical; new/foreign IDs and
 * backwards/invalid timestamps are rejected before targeted cleanup. */
export function restoredChatProfilesMatch(original, current, participantIds) {
  if (original.length !== current.length) return false;
  return original.every(prior => {
    const row = current.find(item => item.id === prior.id);
    if (!row) return false;
    if (!participantIds.has(prior.id)) return stableStringify(row) === stableStringify(prior);
    const timestamp = Date.parse(row.updated_at), before = Date.parse(prior.updated_at);
    if (!Number.isFinite(timestamp) || !Number.isFinite(before) || timestamp < before) return false;
    const priorFields = { ...prior }, currentFields = { ...row };
    delete priorFields.updated_at; delete currentFields.updated_at;
    return stableStringify(priorFields) === stableStringify(currentFields);
  });
}
const ownRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function privateJson(filename) {
  assert.ok(path.isAbsolute(filename));
  const stat = await lstat(filename); assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.equal(stat.mode & 0o777, 0o600); assert.ok(stat.size < 65536);
  return JSON.parse(await readFile(filename, 'utf8'));
}

export function restoredChatConfig(env) {
  assert.equal(env.LOCAL_SCHOOL_CHAT_ISOLATED, 'restored-disposable-target');
  const appOrigin = loopbackOrigin(env.LOCAL_SCHOOL_CHAT_APP_URL, 'App');
  const runtimeDirectory = env.LOCAL_SCHOOL_CHAT_RUNTIME_DIRECTORY;
  const evidenceFile = env.LOCAL_SCHOOL_CHAT_EVIDENCE_FILE;
  assert.ok(path.isAbsolute(runtimeDirectory)); assert.ok(path.isAbsolute(evidenceFile) && evidenceFile.endsWith('.json'));
  return { appOrigin, runtimeDirectory, evidenceFile };
}

/** Operates solely on a previously restored synthetic target. Does not modify
 * source/provider configuration, passwords, app code, Storage or SQL schema. */
export async function acceptRestoredSchoolChat(config) {
  const output = await open(config.evidenceFile, 'wx', 0o600);
  const report = { scope: 'synthetic-restored-loopback-target-only', status: 'FAIL', startedAt: new Date().toISOString(), requests: [], checks: [] };
  let sql, nextChild, nextLog, http, headers, tables, before, teacher, previousHours, targetOrigin, familyProfileIds = new Set();
  let hoursChanged = false;
  const check = (label, condition) => { report.checks.push({ label, result: condition ? 'passed' : 'failed' }); if (!condition) throw Error('chat_acceptance_check_failed'); };
  const local = config.runtimeDirectory;
  const request = (route, options = {}) => http.request('supabase', route, { ...options, headers: { ...headers, ...options.headers } });
  async function stopNext() {
    if (nextChild && nextChild.exitCode === null) {
      const exited = once(nextChild, 'exit'); nextChild.kill('SIGTERM'); const timer = setTimeout(() => nextChild.kill('SIGKILL'), 10000);
      try { await exited; } finally { clearTimeout(timer); }
    }
    await nextLog?.close(); nextLog = null;
  }
  async function listObjects(prefix = '') {
    const rows = await request('/storage/v1/object/list/school-files', { method: 'POST', body: { prefix, limit: 100, offset: 0 }, label: 'Inventario Storage destino restaurado' });
    assert.ok(Array.isArray(rows) && rows.length < 100);
    const found = [];
    for (const row of rows) {
      assert.ok(typeof row.name === 'string' && !row.name.includes('/'));
      if (row.id !== null) {
        const key = `${prefix}${row.name}`; assert.match(key, /^private\/(material|submission)\/[0-9a-f-]{36}$/i);
        const downloaded = await request(`/storage/v1/object/school-files/${key}`, { responseType: 'bytes', label: 'Huella Storage previa o posterior' });
        found.push({ key, size: downloaded.bytes.length, sha256: sha256(downloaded.bytes) });
      } else found.push(...await listObjects(`${prefix}${row.name}/`));
    }
    return found;
  }
  async function snapshot() {
    const auth = await request('/auth/v1/admin/users?page=1&per_page=100', { label: 'Inventario Auth destino restaurado' });
    const data = {};
    for (const table of tables) data[table.name] = await request(`/rest/v1/${table.name}?select=*&limit=100`, { label: `Inventario destino ${table.name}` });
    return { auth: auth.users.map(user => ({ id: user.id, email: user.email })), data, objects: await listObjects() };
  }
  try {
    const runtime = await privateJson(path.join(local, 'restore-target-start-result.json'));
    targetOrigin = loopbackOrigin(runtime.endpoints?.['rest.http']?.url, 'Destino');
    assert.notEqual(targetOrigin, config.appOrigin); assert.notEqual(targetOrigin, 'http://127.0.0.1:25488');
    for (const service of ['auth.http', 'storage.http']) assert.equal(loopbackOrigin(runtime.endpoints?.[service]?.url, 'Destino'), targetOrigin);
    const database = new URL(runtime.env?.DB_URL);
    assert.ok(['postgres:', 'postgresql:'].includes(database.protocol)); assert.ok(['127.0.0.1', '[::1]'].includes(database.hostname));
    assert.ok(database.port && database.port !== '23015'); assert.equal(database.username, 'postgres'); assert.equal(database.pathname, '/postgres');
    assert.equal(database.search, ''); assert.equal(database.hash, '');
    const credentials = await localCredentials(path.join(local, 'school-realtime-local-credentials.restore-target.json'));
    const probes = await privateJson(path.join(local, 'school-auth-restore-probes.local.json'));
    assert.equal(probes.users?.length, 2);
    http = new LocalHttp({ appOrigin: config.appOrigin, supabaseOrigin: targetOrigin, evidence: report.requests });
    headers = { apikey: credentials.anonKey, Authorization: `Bearer ${credentials.serviceRoleKey}` };
    tables = await loadSchoolBackupTables(); assert.equal(tables.length, 33);
    before = await snapshot();
    assert.equal(before.auth.length, 6); assert.equal(Object.values(before.data).reduce((sum, rows) => sum + rows.length, 0), 69); assert.equal(before.objects.length, 3);
    assert.equal(before.data.conversations.length, 0); assert.equal(before.data.messages.length, 0); assert.equal(before.data.communication_settings.length, 0);
    for (const user of before.auth) assert.ok(/^http-[a-f0-9]{8}-(direction|teacher|familya|familyb)@example\.test$/.test(user.email) || /^realtime-local-[a-f0-9]{12}-(teacher|family-a|family-b)@example\.com$/.test(user.email));
    const families = probes.users.map(probe => {
      assert.equal(probe.role, 'tutor'); requiredId(probe.id, 'Tutor restaurado'); requiredId(probe.ownStudentId, 'Alumno propio'); requiredId(probe.foreignStudentId, 'Alumno ajeno');
      assert.ok(before.auth.some(user => user.id === probe.id && user.email === probe.email));
      assert.ok(before.data.students.some(student => student.id === probe.ownStudentId));
      assert.ok(typeof probe.password === 'string' && probe.password.length >= 12);
      const guardian = before.data.guardians.find(row => row.user_id === probe.id); assert.ok(guardian);
      assert.ok(before.data.student_guardians.some(row => row.student_id === probe.ownStudentId && row.guardian_id === guardian.id && row.active));
      return { ...probe, guardianId: guardian.id, jar: new Map() };
    });
    assert.equal(families[0].ownStudentId, families[1].foreignStudentId); assert.equal(families[1].ownStudentId, families[0].foreignStudentId);
    familyProfileIds = new Set(families.map(family => family.id));
    check('Destino restaurado sintético y snapshot69/6/3 verificados', true);
    const appDirectory = path.join(local, 'school-app');
    for (const filename of ['.env', '.env.local', '.env.development', '.env.development.local', '.dev.vars']) {
      try { await lstat(path.join(appDirectory, filename)); throw Error('isolated_app_contains_env_file'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    nextLog = await open(`${config.evidenceFile}.next.log`, 'wx', 0o600);
    const environment = { PATH: '/usr/local/bin:/usr/bin:/bin', NODE_ENV: 'development', SCHOOL_LOCAL_SUPABASE_HTTP: 'isolated-test', APP_ORIGIN: config.appOrigin, BETTER_AUTH_URL: config.appOrigin,
      SCHOOL_AUTH_PROVIDER: 'supabase', SCHOOL_DATA_PROVIDER: 'supabase', SCHOOL_FILE_STORAGE_PROVIDER: 'supabase', SUPABASE_STORAGE_BUCKET: 'school-files',
      SUPABASE_URL: targetOrigin, SUPABASE_AUTH_URL: targetOrigin, SUPABASE_DATA_URL: targetOrigin, SUPABASE_STORAGE_URL: targetOrigin,
      SUPABASE_PUBLISHABLE_KEY: credentials.anonKey, SUPABASE_SECRET_KEY: credentials.serviceRoleKey, SCHOOL_FILE_SCAN_LOCAL_MOCK: 'false', NEXT_TELEMETRY_DISABLED: '1' };
    nextChild = spawn(process.execPath, [path.join(ownRoot, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', new URL(config.appOrigin).hostname.replace(/^\[|\]$/g, ''), '--port', new URL(config.appOrigin).port, '--webpack'], { cwd: appDirectory, env: environment, stdio: ['ignore', nextLog.fd, nextLog.fd] });
    const deadline = Date.now() + 60000; let ready = false;
    while (Date.now() < deadline) {
      if (nextChild.exitCode !== null) throw Error('isolated_next_exited');
      try { const response = await fetch(`${config.appOrigin}/ingresar`, { redirect: 'error', signal: AbortSignal.timeout(3000) }); if (response.status === 200) { ready = true; break; } } catch { /* Only read-only liveness polling. */ }
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    assert.ok(ready);
    teacher = { email: `realtime-local-${randomBytes(6).toString('hex')}-teacher@example.com`, password: `Local!${randomBytes(24).toString('base64url')}`, directoryId: randomUUID(), jar: new Map() };
    const account = await request('/auth/v1/admin/users', { method: 'POST', body: { email: teacher.email, password: teacher.password, email_confirm: true, user_metadata: { name: 'Docente sintética chat restaurado' } }, statuses: [200, 201], label: 'Crear solamente docente sintética nueva' });
    teacher.id = requiredId(account.id, 'Docente sintética');
    await request(`/rest/v1/profiles?id=eq.${teacher.id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: { active: true }, label: 'Activar perfil docente sintético' });
    await request('/rest/v1/user_roles', { method: 'POST', headers: { Prefer: 'return=representation' }, body: { user_id: teacher.id, role: 'docente' }, statuses: [201], label: 'Asignar rol docente sintético' });
    await request('/rest/v1/teachers', { method: 'POST', headers: { Prefer: 'return=representation' }, body: { id: teacher.directoryId, user_id: teacher.id, active: true }, statuses: [201], label: 'Directorio docente sintético nuevo' });
    for (const group of before.data.groups) await request('/rest/v1/teacher_groups', { method: 'POST', headers: { Prefer: 'return=representation' }, body: { teacher_id: teacher.directoryId, group_id: group.id }, statuses: [201], label: 'Asignar docente nueva a grupo restaurado' });
    sql = postgres(runtime.env.DB_URL, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 1 });
    previousHours = await sql`select * from public.communication_settings order by id`; assert.equal(previousHours.length, 0);
    await sql`insert into public.communication_settings(id,enabled,weekdays,start_time,end_time,updated_by,updated_at) values('school',false,'0,1,2,3,4,5,6','00:00','23:59',${teacher.id},now())`;
    hoursChanged = true;
    const call = (account, route, options = {}) => http.request('app', route, { ...options, jar: account?.jar });
    for (const [index, account] of [teacher, ...families].entries()) {
      await call(account, '/api/auth/sign-in/email', { method: 'POST', body: { email: account.email, password: account.password }, label: `Login real chat participante${index}` });
      const session = await call(account, '/api/auth/get-session', { label: `Sesión chat participante${index}` });
      check(`Identidad local chat participante${index}`, session?.user?.id === account.id && session.user.email === account.email && account.jar.size > 0);
      account.password = undefined;
    }
    const flow = await exercisePrivateSchoolChat({ call, teacher, families, teacherId: teacher.directoryId, check });
    const messages = await request(`/rest/v1/messages?select=*&conversation_id=in.(${flow.conversations.join(',')})`, { label: 'Verificar persistencia PostgreSQL de chat' });
    check('Cuatro mensajes de texto y acuses persistidos', messages.length === 4 && messages.every(row => flow.messageIds.includes(row.id) && row.file_id === null && typeof row.read_at === 'string'));
    const notices = await request('/rest/v1/notifications?select=*&kind=eq.mensaje', { label: 'Verificar destinatarios de avisos del chat' });
    check('Cuatro avisos de mensaje con destinatarios correctos', notices.length === 4 && messages.every(message => notices.some(notice => notice.dedupe_key === `message:${message.id}` && notice.user_id !== message.author_id && [teacher.id, ...families.map(family => family.id)].includes(notice.user_id))));
    const audits = await request(`/rest/v1/audit_log?select=*&entity_type=eq.conversation&entity_id=in.(${flow.conversations.join(',')})`, { label: 'Auditoría real de conversaciones nuevas' });
    check('Auditoría conserva aperturas y envíos reales', audits.length === 6 && audits.filter(row => row.action === 'open').length === 2 && audits.filter(row => row.action === 'send_message').length === 4);
    for (const account of [teacher, ...families]) await call(account, '/api/auth/sign-out', { method: 'POST', label: 'Cerrar sesión chat de ensayo' });
    report.status = 'PASS';
  } catch {
    report.failure = 'Local restored chat acceptance did not complete. Inspect redacted requests; no mutation was replayed.';
  } finally {
    await stopNext();
    if (before && teacher?.id) {
      try {
        // Inspect actual committed rows after success OR uncertain HTTP writes.
        // Only records attached to the newly issued teacher UUID are removable.
        const current = await snapshot();
        const conversations = current.data.conversations.filter(row => row.teacher_id === teacher.directoryId);
        const conversationIds = new Set(conversations.map(row => row.id));
        const newMessages = current.data.messages.filter(row => conversationIds.has(row.conversation_id));
        const messageIds = new Set(newMessages.map(row => row.id));
        const allowed = {
          profiles: row => row.id === teacher.id, user_roles: row => row.user_id === teacher.id && row.role === 'docente', teachers: row => row.id === teacher.directoryId && row.user_id === teacher.id,
          teacher_groups: row => row.teacher_id === teacher.directoryId && before.data.groups.some(group => group.id === row.group_id),
          conversations: row => conversationIds.has(row.id), messages: row => messageIds.has(row.id),
          notifications: row => row.kind === 'mensaje' && [...messageIds].some(id => row.dedupe_key === `message:${id}`),
          audit_log: row => row.entity_type === 'conversation' && conversationIds.has(row.entity_id) && ['open', 'send_message'].includes(row.action),
          communication_settings: row => row.id === 'school' && row.updated_by === teacher.id,
        };
        const delta = {};
        for (const table of tables) {
          if (table.name === 'profiles') {
            const originalProfiles = current.data.profiles.filter(row => row.id !== teacher.id);
            assert.ok(restoredChatProfilesMatch(before.data.profiles, originalProfiles, familyProfileIds));
            delta.profiles = current.data.profiles.filter(row => row.id === teacher.id);
            continue;
          }
          const original = new Set(before.data[table.name].map(row => stableStringify(row)));
          const stable = current.data[table.name].filter(row => original.has(stableStringify(row)));
          assert.equal(canonical(stable), canonical(before.data[table.name]));
          delta[table.name] = current.data[table.name].filter(row => !original.has(stableStringify(row)));
          assert.ok(delta[table.name].every(row => allowed[table.name]?.(row) === true));
        }
        assert.equal(canonical(current.objects), canonical(before.objects));
        assert.equal(canonical(current.auth.filter(user => user.id !== teacher.id)), canonical(before.auth));
        for (const tableName of ['notifications', 'audit_log', 'messages', 'conversations', 'teacher_groups', 'teachers', 'user_roles']) {
          const table = tables.find(row => row.name === tableName);
          for (const row of delta[tableName]) {
            const filters = table.primaryKey.map(column => `${column}=eq.${encodeURIComponent(column === 'role' ? row[column] : requiredId(row[column], 'Cleanup PK'))}`).join('&');
            const removed = await request(`/rest/v1/${tableName}?${filters}`, { method: 'DELETE', headers: { Prefer: 'return=representation' }, label: `Cleanup exclusivo de chat ${tableName}` }); assert.equal(removed.length, 1);
          }
        }
        if (hoursChanged) {
          const removed = await sql`delete from public.communication_settings where id='school' and updated_by=${teacher.id} returning id`; assert.equal(removed.length, 1); hoursChanged = false;
        }
        await request(`/auth/v1/admin/users/${teacher.id}`, { method: 'DELETE', label: 'Cleanup exclusiva de nueva docente Auth' });
        const after = await snapshot();
        assert.equal(canonical(after.auth), canonical(before.auth)); assert.equal(canonical(after.objects), canonical(before.objects));
        for (const table of tables) {
          if (table.name === 'profiles') assert.ok(restoredChatProfilesMatch(before.data.profiles, after.data.profiles, familyProfileIds));
          else assert.equal(canonical(after.data[table.name]), canonical(before.data[table.name]));
        }
        report.cleanup = { status: 'PASS', auth: 6, tables: 33, rows: 69, storageObjects: 3, priorHoursRestored: true, originalSchoolFieldsAndObjectHashesPreserved: true, authManagedProfileTimestampAdvanceAllowed: true };
        check('Cleanup dirigido conserva destino restaurado69/6/3 y horario previo', true);
      } catch {
        report.status = 'FAIL'; report.cleanup = { status: 'FAIL', preservedForInspection: true }; report.failure = 'Targeted cleanup did not confirm the original restored snapshot; no automatic mutation retry or broad reset.';
      }
    }
    await sql?.end({ timeout: 5 });
    report.finishedAt = new Date().toISOString();
    try { await output.writeFile(JSON.stringify(report, null, 2) + '\n'); } finally { await output.close(); }
  }
  return report;
}

async function main() {
  try {
    const report = await acceptRestoredSchoolChat(restoredChatConfig(process.env));
    console.log(JSON.stringify({ status: report.status, requests: report.requests.length, checks: report.checks.length, cleanup: report.cleanup ?? null, failure: report.failure ?? null }));
    if (report.status !== 'PASS') process.exitCode = 1;
  } catch { console.error('Local chat configuration or private evidence unavailable; no acceptance was declared.'); process.exitCode = 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
