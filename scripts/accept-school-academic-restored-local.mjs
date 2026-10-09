import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import postgres from 'postgres';
import { LocalHttp, localCredentials, loopbackOrigin, requiredId } from './supabase-school-http-local-support.mjs';
import { loadSchoolBackupTables, stableStringify } from './supabase-school-backup.mjs';
import { sha256 } from './backup-crypto.mjs';
import { exerciseRestoredAcademic } from './supabase-school-academic-restored-local-flow.mjs';
import { restoredChatProfilesMatch } from './accept-school-chat-restored-local.mjs';

const canonical = rows => stableStringify(rows.map(row => stableStringify(row)).sort());
const ownRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function privateJson(filename) {
  assert.ok(path.isAbsolute(filename));
  const stat = await lstat(filename); assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.equal(stat.mode & 0o777, 0o600); assert.ok(stat.size < 65536);
  assert.equal(stat.uid, process.getuid());
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const opened = await handle.stat(); assert.equal(opened.ino, stat.ino); assert.equal(opened.dev, stat.dev); return JSON.parse(await handle.readFile('utf8')); } finally { await handle.close(); }
}

export function restoredAcademicConfig(env) {
  assert.equal(env.LOCAL_SCHOOL_ACADEMIC_ISOLATED, 'restored-disposable-target');
  const appOrigin = loopbackOrigin(env.LOCAL_SCHOOL_ACADEMIC_APP_URL, 'App');
  const runtimeDirectory = env.LOCAL_SCHOOL_ACADEMIC_RUNTIME_DIRECTORY;
  const evidenceFile = env.LOCAL_SCHOOL_ACADEMIC_EVIDENCE_FILE;
  assert.ok(path.isAbsolute(runtimeDirectory)); assert.ok(path.isAbsolute(evidenceFile) && evidenceFile.endsWith('.json'));
  const runtimeFile = env.LOCAL_SCHOOL_ACADEMIC_RUNTIME_FILE;
  assert.ok(path.isAbsolute(runtimeFile) && path.dirname(runtimeFile) === runtimeDirectory && path.basename(runtimeFile).startsWith('restore-target-academic-start-result-'));
  return { appOrigin, runtimeDirectory, evidenceFile, runtimeFile };
}

/** Operates solely on a previously restored synthetic target. Does not modify
 * source/provider configuration, passwords, app code, Storage or SQL schema. */
export async function acceptRestoredSchoolAcademic(config) {
  const output = await open(config.evidenceFile, 'wx', 0o600);
  const report = { scope: 'synthetic-restored-loopback-target-only', status: 'FAIL', startedAt: new Date().toISOString(), requests: [], checks: [] };
  let sql, nextChild, nextLog, http, headers, tables, before, teacher, targetOrigin, group, student, date, flow, participants = [], call, familyProfileIds = new Set();

  const check = (label, condition) => { report.checks.push({ label, result: condition ? 'passed' : 'failed' }); if (!condition) throw Error('academic_acceptance_check_failed'); };
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
    assert.ok(Array.isArray(auth.users) && auth.users.length < 100);
    for (const rows of Object.values(data)) assert.ok(Array.isArray(rows) && rows.length < 100);
    const authPasswords = await sql`select id, encrypted_password from auth.users order by id`;
    const identities = await sql`select id,user_id,provider,provider_id,identity_data from auth.identities order by id`;
    return { auth: auth.users.map(user => ({ id: user.id, email: user.email })), passwords: authPasswords.map(row => ({ id: row.id, digest: sha256(Buffer.from(row.encrypted_password)) })), identities: [...identities], data, objects: await listObjects() };
  }
  try {
    assert.equal(await realpath(path.join(local, 'restore-target')), '/private/tmp/school-isolated-runtime-20261008/restore-target');
    const runtime = await privateJson(config.runtimeFile);
    assert.equal(runtime.id, 'f2bd8563efba25e7d7846cceacb670b5ab8238cfb82aab83989d0c8942e6ddea');
    targetOrigin = loopbackOrigin(runtime.endpoints?.['rest.http']?.url, 'Destino');
    assert.notEqual(targetOrigin, config.appOrigin); assert.notEqual(targetOrigin, 'http://127.0.0.1:25488');
    for (const service of ['auth.http', 'storage.http']) assert.equal(loopbackOrigin(runtime.endpoints?.[service]?.url, 'Destino'), targetOrigin);
    const database = new URL(runtime.env?.DB_URL);
    assert.ok(['postgres:', 'postgresql:'].includes(database.protocol)); assert.ok(['127.0.0.1', '[::1]'].includes(database.hostname));
    assert.ok(database.port && database.port !== '23015'); assert.equal(database.username, 'postgres'); assert.equal(database.pathname, '/postgres');
    assert.equal(database.search, ''); assert.equal(database.hash, '');
    const credentials = await localCredentials(path.join(local, 'school-realtime-local-credentials.restore-target.json'));
    for (const [role,key] of [['anon',credentials.anonKey],['service_role',credentials.serviceRoleKey]]) { const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url')); assert.equal(claims.iss, 'supabase-demo'); assert.equal(claims.role,role); }
    const probes = await privateJson(path.join(local, 'school-auth-restore-probes.local.json'));
    assert.equal(probes.users?.length, 2);
    http = new LocalHttp({ appOrigin: config.appOrigin, supabaseOrigin: targetOrigin, evidence: report.requests });
    headers = { apikey: credentials.anonKey, Authorization: `Bearer ${credentials.serviceRoleKey}` };
    tables = await loadSchoolBackupTables(); assert.equal(tables.length, 33);
    sql = postgres(runtime.env.DB_URL, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 1 });
    const columns = await sql`select table_name, column_name from information_schema.columns where table_schema='public'`;
    for (const [table, names] of Object.entries({ calendar_events: ['id','group_id','created_by','starts_at'], attendance: ['id','student_id','group_id','on_date','recorded_by','modified_by'], attendance_justifications: ['id','student_id','submitted_by','reviewed_by','status'], announcements: ['id','group_id','published_by'], announcement_reads: ['announcement_id','user_id'] })) for (const name of names) assert.ok(columns.some(row => row.table_name === table && row.column_name === name));
    const functions = await sql`select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`;
    for (const name of ['school_create_calendar_event','school_update_calendar_event','school_calendar_feed_filtered','school_record_attendance','school_attendance_history','school_submit_attendance_justification','school_review_attendance_justification','school_attendance_report','school_create_announcement','school_mark_announcement_read']) assert.ok(functions.some(row => row.proname === name));
    before = await snapshot();
    assert.equal(before.auth.length, 6); assert.equal(Object.values(before.data).reduce((sum, rows) => sum + rows.length, 0), 69); assert.equal(before.objects.length, 3);
    assert.equal(before.data.conversations.length, 0); assert.equal(before.data.messages.length, 0); assert.equal(before.data.communication_settings.length, 0);
    for (const user of before.auth) assert.ok(/^http-[a-f0-9]{8}-(direction|teacher|familya|familyb)@example\.test$/.test(user.email) || /^realtime-local-[a-f0-9]{12}-(teacher|family-a|family-b)@example\.com$/.test(user.email));
    const families = probes.users.map(probe => {
      assert.equal(probe.role, 'tutor'); requiredId(probe.id, 'Tutor restaurado'); requiredId(probe.ownStudentId, 'Alumno propio'); requiredId(probe.foreignStudentId, 'Alumno ajeno');
      assert.ok(before.auth.some(user => user.id === probe.id && user.email === probe.email));
      assert.ok(before.data.students.some(student => student.id === probe.ownStudentId));
      assert.ok(typeof probe.password === 'string' && probe.password.length >= 12);
      assert.ok(before.data.profiles.some(row => row.id === probe.id && row.active)); assert.ok(before.data.user_roles.some(row => row.user_id === probe.id && row.role === 'tutor'));
      const guardian = before.data.guardians.find(row => row.user_id === probe.id && row.active); assert.ok(guardian);
      assert.ok(before.data.student_guardians.some(row => row.student_id === probe.ownStudentId && row.guardian_id === guardian.id && row.active));
      return { ...probe, guardianId: guardian.id, jar: new Map() };
    });
    assert.equal(families[0].ownStudentId, families[1].foreignStudentId); assert.equal(families[1].ownStudentId, families[0].foreignStudentId);
    familyProfileIds = new Set(families.map(family => family.id));
    const enrollments = families.map(family => before.data.enrollments.filter(row => row.student_id === family.ownStudentId && row.ended_at === null));
    assert.ok(enrollments.every(rows => rows.length === 1)); assert.notEqual(enrollments[0][0].group_id, enrollments[1][0].group_id);
    group = before.data.groups.find(row => row.id === enrollments[0][0].group_id && row.active); assert.ok(group);
    const foreignGroupId = enrollments[1][0].group_id;
    student = before.data.students.find(row => row.id === families[0].ownStudentId && row.active); assert.ok(student);
    date = '2026-11-01';
    while (before.data.attendance.some(row => row.on_date === date) || before.data.attendance_justifications.some(row => row.on_date === date) || before.data.calendar_events.some(row => row.starts_at.startsWith(date))) { date = new Date(Date.parse(date + 'T00:00:00Z') + 86400000).toISOString().slice(0,10); }
    const baselineFile = await open(path.join(local, `${path.basename(config.evidenceFile)}.baseline.private.json`), 'wx', 0o600); try { await baselineFile.writeFile(JSON.stringify(before)); } finally { await baselineFile.close(); }
    check('Schema y baseline destino33/69/Auth6/Storage3 verificados antes de DML', true);
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
    const account = await request('/auth/v1/admin/users', { method: 'POST', body: { email: teacher.email, password: teacher.password, email_confirm: true, user_metadata: { name: 'Docente sintética ensayo académico' } }, statuses: [200, 201], label: 'Crear solamente docente sintética nueva' });
    teacher.id = requiredId(account.id, 'Docente sintética');
    await request(`/rest/v1/profiles?id=eq.${teacher.id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: { active: true }, label: 'Activar perfil docente sintético' });
    await request('/rest/v1/user_roles', { method: 'POST', headers: { Prefer: 'return=representation' }, body: { user_id: teacher.id, role: 'docente' }, statuses: [201], label: 'Asignar rol docente sintético' });
    await request('/rest/v1/teachers', { method: 'POST', headers: { Prefer: 'return=representation' }, body: { id: teacher.directoryId, user_id: teacher.id, active: true }, statuses: [201], label: 'Directorio docente sintético nuevo' });
    for (const assignedGroup of [group]) await request('/rest/v1/teacher_groups', { method: 'POST', headers: { Prefer: 'return=representation' }, body: { teacher_id: teacher.directoryId, group_id: assignedGroup.id }, statuses: [201], label: 'Asignar docente nueva a grupo restaurado' });
    call = (account, route, options = {}) => http.request('app', route, { ...options, jar: account?.jar });
    participants = [teacher,...families];
    for (const [index, account] of participants.entries()) {
      await call(account, '/api/auth/sign-in/email', { method: 'POST', body: { email: account.email, password: account.password }, label: `Login real academic participante${index}` });
      const session = await call(account, '/api/auth/get-session', { label: `Sesión academic participante${index}` });
      check(`Identidad local academic participante${index}`, session?.user?.id === account.id && session.user.email === account.email && account.jar.size > 0);
      account.password = undefined;
    }
    const marker = `academic-${randomBytes(6).toString('hex')}`;
    flow = await exerciseRestoredAcademic({ call, teacher, families, student, group, foreignGroupId, date, marker, check });
    const persisted = await snapshot();
    check('Calendario editado persiste en PostgreSQL con autor docente', persisted.data.calendar_events.some(row => row.id === flow.eventId && row.created_by === teacher.id && row.title === flow.event.title && row.description === flow.event.description && row.group_id === group.id && Date.parse(row.starts_at) === Date.parse(flow.event.startsAt)));
    check('Asistencia y revisión persisten completas en PostgreSQL', persisted.data.attendance.some(row => row.id === flow.attendanceId && row.student_id === student.id && row.status === 'justificada' && row.note === flow.reason && row.modified_by === teacher.id) && persisted.data.attendance_justifications.some(row => row.id === flow.justificationId && row.status === 'aceptada' && row.submitted_by === families[0].id && row.reviewed_by === teacher.id && row.reason === flow.reason));
    check('Comunicado docente y acuse persisten en PostgreSQL', persisted.data.announcements.some(row => row.id === flow.announcementId && row.published_by === teacher.id && row.group_id === group.id && row.body === flow.announcement.body) && persisted.data.announcement_reads.some(row => row.announcement_id === flow.announcementId && row.user_id === families[0].id));
    check('Exportaciones CSV/XLSX/PDF dejaron tres auditorías reales', ['csv','xlsx','pdf'].every(format => persisted.data.audit_log.some(row => row.actor_id === teacher.id && row.entity_type === 'group' && row.entity_id === group.id && row.action === `export_attendance_${format}`)));
    for (const account of [teacher, ...families]) await call(account, '/api/auth/sign-out', { method: 'POST', label: 'Cerrar sesión academic de ensayo' });
    report.status = 'PASS';
  } catch (error) {
    report.failureCategory = error?.name === 'AssertionError' ? 'harness-assertion' : 'request-or-precondition';
    report.failure = 'Local restored academic acceptance did not complete. Inspect redacted requests; no mutation was replayed.';
  } finally {
    for (const participant of participants.filter(account => account.jar.size > 0)) {
      try { await call(participant, '/api/auth/sign-out', { method: 'POST', label: 'Cerrar sesión propia en finalización de ensayo' }); } catch { report.status = 'FAIL'; report.sessionCloseFailure = true; }
    }
    await stopNext();
    if (before && teacher?.id) {
      try {
        // Inspect actual committed rows after success OR uncertain HTTP writes.
        // Only records attached to the newly issued teacher UUID are removable.
        const current = await snapshot();
        const events = current.data.calendar_events.filter(row => row.created_by === teacher.id && row.group_id === group.id); const eventIds = new Set(events.map(row => row.id));
        const attendance = current.data.attendance.filter(row => row.recorded_by === teacher.id && row.student_id === student.id && row.group_id === group.id && row.on_date === date); const attendanceIds = new Set(attendance.map(row => row.id));
        const justifications = current.data.attendance_justifications.filter(row => row.submitted_by === [...familyProfileIds][0] && row.student_id === student.id && row.group_id === group.id && row.on_date === date && (row.reviewed_by === null || row.reviewed_by === teacher.id)); const justificationIds = new Set(justifications.map(row => row.id));
        const announcements = current.data.announcements.filter(row => row.published_by === teacher.id && row.group_id === group.id); const announcementIds = new Set(announcements.map(row => row.id));
        assert.ok(events.length <= 1 && attendance.length <= 1 && justifications.length <= 1 && announcements.length <= 1);
        const allowed = {
          profiles: row => row.id === teacher.id, user_roles: row => row.user_id === teacher.id && row.role === 'docente', teachers: row => row.id === teacher.directoryId && row.user_id === teacher.id,
          teacher_groups: row => row.teacher_id === teacher.directoryId && row.group_id === group.id,
          calendar_events: row => eventIds.has(row.id), attendance: row => attendanceIds.has(row.id), attendance_justifications: row => justificationIds.has(row.id), announcements: row => announcementIds.has(row.id),
          announcement_reads: row => announcementIds.has(row.announcement_id) && row.user_id === [...familyProfileIds][0],
          notifications: row => typeof row.dedupe_key === 'string' && (row.kind === 'calendario' && [...eventIds].some(id => row.dedupe_key === `calendario:${id}:${row.user_id}`) || row.kind === 'comunicado' && [...announcementIds].some(id => row.dedupe_key === `announcement:${id}:${row.user_id}`) || row.kind.startsWith('asistencia_justificacion') && [...justificationIds].some(id => row.dedupe_key.startsWith(`attendance-justification:${id}:`))),
          audit_log: row => (row.actor_id === teacher.id || familyProfileIds.has(row.actor_id)) && (row.entity_type === 'calendar_event' && eventIds.has(row.entity_id) && ['create','update'].includes(row.action) || row.entity_type === 'attendance' && attendanceIds.has(row.entity_id) && row.action === 'record_attendance' || row.entity_type === 'attendance_justification' && justificationIds.has(row.entity_id) && ['submit_attendance_justification','approve_attendance_justification'].includes(row.action) || row.entity_type === 'announcement' && announcementIds.has(row.entity_id) && row.action === 'publish' || row.entity_type === 'group' && row.entity_id === group.id && ['export_attendance_csv','export_attendance_xlsx','export_attendance_pdf'].includes(row.action)),
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
        assert.equal(canonical(current.passwords.filter(row => row.id !== teacher.id)), canonical(before.passwords));
        assert.equal(canonical(current.identities.filter(row => row.user_id !== teacher.id)), canonical(before.identities));
        await sql.begin(async transaction => {
          for (const name of ['notifications','audit_log','announcement_reads','announcements','attendance_justifications','attendance','calendar_events','teacher_groups','teachers','user_roles']) {
            const table = tables.find(row => row.name === name);
            assert.match(name, /^[a-z_]+$/);
            for (const row of delta[name]) {
              table.primaryKey.forEach(column => assert.match(column, /^[a-z_]+$/));
              const where = table.primaryKey.map((column,index) => `"${column}"=$${index+1}`).join(' and ');
              const removed = await transaction.unsafe(`delete from public."${name}" where ${where} returning *`, table.primaryKey.map(column => row[column]));
              assert.equal(removed.length, 1);
            }
          }
        });
        await request(`/auth/v1/admin/users/${teacher.id}`, { method: 'DELETE', label: 'Cleanup exclusiva de nueva docente Auth' });
        const after = await snapshot();
        assert.equal(canonical(after.auth), canonical(before.auth)); assert.equal(canonical(after.objects), canonical(before.objects));
        for (const table of tables) {
          if (table.name === 'profiles') assert.ok(restoredChatProfilesMatch(before.data.profiles, after.data.profiles, familyProfileIds));
          else assert.equal(canonical(after.data[table.name]), canonical(before.data[table.name]));
        }
        assert.equal(canonical(after.passwords), canonical(before.passwords)); assert.equal(canonical(after.identities), canonical(before.identities));
        report.cleanup = { status: 'PASS', auth: 6, tables: 33, rows: 69, storageObjects: 3, originalSchoolFieldsAndObjectHashesPreserved: true, authPasswordHashesAndIdentityFieldsPreserved: true, authManagedProfileTimestampAdvanceAllowed: true };
        check('Cleanup dirigido conserva destino restaurado33/69/Auth6/Storage3 y hashes', true);
      } catch (error) {
        report.cleanupFailureCategory = error?.name === 'AssertionError' ? 'unexpected-snapshot-delta' : 'cleanup-request';
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
    const report = await acceptRestoredSchoolAcademic(restoredAcademicConfig(process.env));
    console.log(JSON.stringify({ status: report.status, requests: report.requests.length, checks: report.checks.length, cleanup: report.cleanup ?? null, failure: report.failure ?? null }));
    if (report.status !== 'PASS') process.exitCode = 1;
  } catch { console.error('Local academic configuration or private evidence unavailable; no acceptance was declared.'); process.exitCode = 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
