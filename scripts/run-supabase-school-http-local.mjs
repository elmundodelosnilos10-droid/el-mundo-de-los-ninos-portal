import { randomBytes, randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { prepareSchoolPrivateFiles, attachSchoolSubmissionFile } from './supabase-school-http-local-files.mjs';
import { LocalHttp, items, localConfig, localCredentials, requiredId, requireEmptyLocalStack } from './supabase-school-http-local-support.mjs';

export async function runSchoolHttpLocal(config, credentials, { fetchImpl = fetch, evidence = [], checks = [], timeoutMs = 30000, includeFiles = config.includeFiles === true } = {}) {
  const http = new LocalHttp({ ...config, fetchImpl, timeoutMs, evidence });
  const adminHeaders = { apikey: credentials.anonKey, Authorization: `Bearer ${credentials.serviceRoleKey}` };
  const check = (label, condition) => {
    checks.push({ label, result: condition ? 'passed' : 'failed' });
    if (!condition) throw new Error(`Comprobación fallida: ${label}.`);
  };
  await requireEmptyLocalStack(http, adminHeaders);
  const runId = randomUUID(); const suffix = runId.slice(0, 8);
  const accounts = {};
  // This is test-fixture provisioning, not a school account/invitation flow.
  // Generated passwords remain only in memory and are never included in evidence.
  for (const [key, role] of [['direction', 'direccion'], ['teacher', 'docente'], ['familyA', 'tutor'], ['familyB', 'tutor']]) {
    const email = `http-${suffix}-${key.toLowerCase()}@example.test`;
    const password = `Local!${randomBytes(24).toString('base64url')}`;
    const account = await http.request('supabase', '/auth/v1/admin/users', { method: 'POST', headers: adminHeaders,
      body: { email, password, email_confirm: true, user_metadata: { name: `HTTP local ${key}` } }, statuses: [200, 201], label: `Fixture Auth ${key}` });
    const id = requiredId(account?.id ?? account?.user?.id, 'Fixture Auth');
    await http.request('supabase', `/rest/v1/profiles?id=eq.${id}`, { method: 'PATCH', headers: { ...adminHeaders, Prefer: 'return=representation' }, body: { active: true }, label: `Fixture perfil ${key}` });
    await http.request('supabase', '/rest/v1/user_roles', { method: 'POST', headers: { ...adminHeaders, Prefer: 'return=representation' }, body: { user_id: id, role }, statuses: [201], label: `Fixture rol ${key}` });
    const directoryId = randomUUID();
    if (role === 'docente' || role === 'tutor') await http.request('supabase', `/rest/v1/${role === 'docente' ? 'teachers' : 'guardians'}`, {
      method: 'POST', headers: { ...adminHeaders, Prefer: 'return=representation' }, body: { id: directoryId, user_id: id, active: true }, statuses: [201], label: `Fixture directorio ${key}` });
    accounts[key] = { id, email, password, directoryId, jar: new Map() };
  }
  const call = (account, path, options = {}) => http.request('app', path, { ...options, jar: account?.jar });
  await call(null, '/api/students', { statuses: [401], label: 'Anónimo sin alumnos' });
  for (const [key, account] of Object.entries(accounts)) {
    await call(account, '/api/auth/sign-in/email', { method: 'POST', body: { email: account.email, password: account.password }, label: `Ingreso escolar ${key}` });
    check(`Cookie escolar ${key}`, account.jar.size > 0);
    const session = await call(account, '/api/auth/get-session', { label: `Sesión escolar ${key}` });
    // Proves the app authenticated the identity created in the LOCAL stack
    // before any school mutation; a loopback app configured for another Auth fails here.
    check(`Identidad local ${key}`, session?.user?.id === account.id && session.user.email === account.email);
    account.password = undefined;
  }
  const direction = accounts.direction; const teacher = accounts.teacher;
  const familyA = accounts.familyA; const familyB = accounts.familyB;
  const localGuardians = items(await call(direction, '/api/guardians', { label: 'Verificar directorio local de tutores' }), 'Tutores');
  const localTeachers = items(await call(direction, '/api/teachers', { label: 'Verificar directorio local de docentes' }), 'Docentes');
  check('Backend escolar usa directorio local', localGuardians.length === 2 && [familyA.directoryId, familyB.directoryId].every(id => localGuardians.some(row => row.id === id)) && localTeachers.length === 1 && localTeachers[0].id === teacher.directoryId);
  check('Backend escolar sin grupos previos', items(await call(direction, '/api/groups', { label: 'Verificar grupos locales vacíos' }), 'Grupos').length === 0);
  const now = new Date(); const year = now.getUTCFullYear(); const date = now.toISOString().slice(0, 10);
  const cycle = await call(direction, '/api/years', { method: 'POST', body: { name: `HTTP local ${suffix}`, startsOn: `${year}-01-01`, endsOn: `${year + 1}-12-31` }, statuses: [201], label: 'Dirección crea ciclo' });
  const yearId = requiredId(cycle?.id, 'Ciclo');
  const groups = {}; const students = {};
  for (const family of ['A', 'B']) {
    const group = await call(direction, '/api/groups', { method: 'POST', body: { yearId, name: `HTTP ${suffix} ${family}`, stage: 'preescolar' }, statuses: [201], label: `Dirección crea grupo ${family}` });
    groups[family] = requiredId(group?.id, 'Grupo');
    await call(direction, `/api/groups/${groups[family]}/teachers`, { method: 'POST', body: { teacherId: teacher.directoryId }, statuses: [201], label: `Dirección asigna docente ${family}` });
    const student = await call(direction, '/api/students', { method: 'POST', body: { givenName: `Alumno sintético ${family}`, familyName: `HTTP ${suffix}`, groupId: groups[family] }, statuses: [201], label: `Dirección registra alumno ${family}` });
    students[family] = requiredId(student?.id, 'Alumno');
    await call(direction, `/api/students/${students[family]}/guardians`, { method: 'POST', body: { guardianId: accounts[`family${family}`].directoryId, relationship: 'Tutor de prueba', mayCollect: false }, statuses: [201], label: `Dirección vincula tutor ${family}` });
  }
  for (const family of ['A', 'B']) {
    const visible = items(await call(accounts[`family${family}`], '/api/students', { label: `Alumnos familia ${family}` }), 'Alumnos');
    check(`Familia ${family} ve únicamente su alumno`, visible.length === 1 && visible[0].id === students[family]);
    await call(accounts[`family${family}`], `/api/students/${students[family === 'A' ? 'B' : 'A']}`, { statuses: [404], label: `Familia ${family} sin detalle ajeno` });
  }
  await call(familyA, '/api/students', { method: 'POST', body: { givenName: 'No autorizado', familyName: 'Sintético', groupId: groups.A }, statuses: [403], label: 'Tutor no registra alumnos' });
  const task = await call(teacher, '/api/tasks', { method: 'POST', body: { groupId: groups.A, title: `Tarea HTTP ${suffix}`, instructions: 'Actividad sintética: describir un color.' }, statuses: [201], label: 'Docente publica tarea' });
  const taskId = requiredId(task?.id, 'Tarea');
  check('Tarea visible para A', items(await call(familyA, '/api/tasks', { label: 'Tareas familia A' }), 'Tareas').some(row => row.id === taskId));
  check('Tarea privada no visible para B', !items(await call(familyB, '/api/tasks', { label: 'Tareas familia B' }), 'Tareas').some(row => row.id === taskId));
  await call(familyB, `/api/tasks/${taskId}/submissions`, { method: 'POST', body: { studentId: students.A, note: 'Intento ajeno sintético' }, statuses: [404], label: 'Familia B no entrega por A' });
  const fileFixture = includeFiles ? await prepareSchoolPrivateFiles({ call, teacher, familyA, familyB, groupId: groups.A, taskId, suffix, check }) : null;
  await call(familyA, `/api/tasks/${taskId}/submissions`, { method: 'POST', body: { studentId: students.A, note: 'Evidencia textual sintética del color azul.' }, statuses: [201], label: 'Tutor A entrega tarea' });
  if (fileFixture) await attachSchoolSubmissionFile({ call, teacher, familyA, familyB, studentId: students.A, taskId, evidenceBytes: fileFixture.evidenceBytes, check });
  const submissions = items(await call(teacher, `/api/tasks/${taskId}/submissions`, { label: 'Docente consulta entregas' }), 'Entregas');
  check('Entrega real persistida y pendiente de revisión', submissions.length === 1 && submissions[0].studentId === students.A && submissions[0].status === 'entregada');
  const submissionId = requiredId(submissions[0].id, 'Entrega');
  await call(teacher, `/api/submissions/${submissionId}`, { method: 'PATCH', body: { status: 'completada', reviewNote: 'Retroalimentación HTTP sintética.', evaluation: 'logrado' }, label: 'Docente revisa entrega' });
  const reviewed = items(await call(familyA, `/api/tasks/${taskId}/submissions`, { label: 'Tutor confirma retroalimentación' }), 'Entregas');
  check('Retroalimentación confirmada por tutor A', reviewed.length === 1 && reviewed[0].status === 'completada' && reviewed[0].evaluation === 'logrado' && reviewed[0].reviewNote === 'Retroalimentación HTTP sintética.');
  await call(familyB, `/api/tasks/${taskId}/submissions`, { statuses: [404], label: 'Familia B sin entregas ajenas' });
  await call(familyA, `/api/submissions/${submissionId}`, { method: 'PATCH', body: { status: 'completada' }, statuses: [403], label: 'Tutor no revisa entregas' });
  const savedAttendance = await call(teacher, '/api/attendance', { method: 'POST', body: { groupId: groups.A, onDate: date, records: [{ studentId: students.A, status: 'presente', note: 'Registro sintético.' }] }, label: 'Docente registra asistencia' });
  check('Asistencia confirmada en servidor', savedAttendance?.saved === 1);
  const attendance = items(await call(familyA, `/api/attendance?groupId=${groups.A}&date=${date}`, { label: 'Tutor consulta asistencia propia' }), 'Asistencia');
  check('Asistencia persistida para A', attendance.length === 1 && attendance[0].studentId === students.A && attendance[0].status === 'presente');
  await call(familyB, `/api/attendance?groupId=${groups.A}&date=${date}`, { statuses: [404], label: 'Familia B sin asistencia ajena' });
  const observation = await call(teacher, `/api/students/${students.A}/observations`, { method: 'POST', body: { category: 'participacion', body: 'Observación visible HTTP sintética.', visibleToFamily: true }, statuses: [201], label: 'Docente registra seguimiento visible' });
  const observationId = requiredId(observation?.id, 'Observación');
  const internal = await call(teacher, `/api/students/${students.A}/observations`, { method: 'POST', body: { category: 'participacion', body: 'Observación interna HTTP sintética.', visibleToFamily: false }, statuses: [201], label: 'Docente registra seguimiento interno' });
  const internalId = requiredId(internal?.id, 'Observación interna');
  const observations = items(await call(familyA, `/api/students/${students.A}/observations`, { label: 'Tutor lee seguimiento visible' }), 'Seguimiento');
  check('Tutor ve seguimiento visible y no interno', observations.some(row => row.id === observationId) && !observations.some(row => row.id === internalId));
  await call(familyB, `/api/students/${students.A}/observations`, { statuses: [404], label: 'Familia B sin seguimiento ajeno' });
  const announcement = await call(direction, '/api/announcements', { method: 'POST', body: { groupId: groups.A, title: `Comunicado HTTP ${suffix}`, body: 'Aviso sintético exclusivo del grupo A.', important: true }, statuses: [201], label: 'Dirección publica comunicado' });
  const announcementId = requiredId(announcement?.id, 'Comunicado');
  check('Comunicado notifica una familia', announcement.notified === 1);
  check('A recibe comunicado', items(await call(familyA, '/api/announcements', { label: 'Comunicados familia A' }), 'Comunicados').some(row => row.id === announcementId));
  check('B no recibe comunicado privado', !items(await call(familyB, '/api/announcements', { label: 'Comunicados familia B' }), 'Comunicados').some(row => row.id === announcementId));
  const readAnnouncement = await call(familyA, `/api/announcements/${announcementId}/read`, { method: 'POST', label: 'Tutor confirma lectura' });
  check('Lectura confirmada por servidor', readAnnouncement?.read === true);
  check('Lectura de comunicado persistida', items(await call(familyA, '/api/announcements', { label: 'Lectura persistida de comunicado' }), 'Comunicados').some(row => row.id === announcementId && typeof row.readAt === 'string'));
  await call(familyB, `/api/announcements/${announcementId}/read`, { method: 'POST', statuses: [404], label: 'B no confirma comunicado ajeno' });
  const noticesA = items(await call(familyA, '/api/notifications', { label: 'Avisos familia A' }), 'Avisos');
  const noticesB = items(await call(familyB, '/api/notifications', { label: 'Avisos familia B' }), 'Avisos');
  check('Avisos escolares reales para A', ['tarea', 'entrega_revisada', 'seguimiento', 'comunicado'].every(kind => noticesA.some(row => row.kind === kind)));
  check('Familia B no recibe avisos de A', noticesB.length === 0);
  const noticeId = requiredId(noticesA[0]?.id, 'Aviso');
  await call(familyB, '/api/notifications', { method: 'PATCH', body: { id: noticeId }, statuses: [404], label: 'B no marca aviso ajeno' });
  const markedNotice = await call(familyA, '/api/notifications', { method: 'PATCH', body: { id: noticeId }, label: 'A confirma aviso propio' });
  check('Aviso marcado confirmado', markedNotice?.read === true);
  check('Aviso marcado persistido', items(await call(familyA, '/api/notifications', { label: 'Lectura persistida de aviso' }), 'Avisos').some(row => row.id === noticeId && typeof row.readAt === 'string'));
  // Read back committed records from the local DB independently of UI/API DTOs.
  const persisted = await http.request('supabase', `/rest/v1/submissions?select=id,status,review_note,evaluation&id=eq.${submissionId}`, { headers: adminHeaders, label: 'Persistencia PostgreSQL entrega' });
  check('PostgreSQL confirma revisión', persisted.length === 1 && persisted[0].status === 'completada' && persisted[0].evaluation === 'logrado');
  const audits = await http.request('supabase', '/rest/v1/audit_log?select=action,entity_type&limit=500', { headers: adminHeaders, label: 'Auditoría PostgreSQL' });
  check('Auditoría de operaciones escolares', ['student', 'task', 'submission', 'attendance', 'announcement'].every(entity => audits.some(row => row.entity_type === entity)) && audits.some(row => row.action === 'record_observation' && row.entity_type === 'student'));
  for (const [key, account] of Object.entries(accounts)) {
    await call(account, '/api/auth/sign-out', { method: 'POST', label: `Cerrar sesión ${key}` });
    check(`Cookies retiradas ${key}`, account.jar.size === 0);
    await call(account, '/api/students', { statuses: [401], label: `Sesión cerrada ${key}` });
  }
  return { runId, checks, files: includeFiles ? "passed" : "not-requested" };
}

export async function main(env = process.env) {
  const config = localConfig(env); const credentials = await localCredentials(config.credentialsFile);
  // Reserve evidence before the first network request. Existing files must never
  // cause a run to mutate the stack and then fail to preserve its result.
  const evidenceHandle = await open(config.evidenceFile, 'wx', 0o600);
  const evidence = []; const report = { format: 'school-http-local-v1', environment: 'synthetic-loopback-only', startedAt: new Date().toISOString(), result: 'failed', requested: { files: config.includeFiles === true }, requests: evidence, checks: [] };
  try {
    const outcome = await runSchoolHttpLocal(config, credentials, { evidence, checks: report.checks });
    report.runId = outcome.runId; report.checks = outcome.checks; report.files = outcome.files; report.result = 'passed';
  } catch (cause) {
    // Error text is generated by this runner; never serialize causes/response bodies.
    report.failure = cause instanceof Error ? cause.message : 'Fallo no clasificado en recorrido local.';
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    try { await evidenceHandle.writeFile(JSON.stringify(report, null, 2) + '\n'); }
    finally { await evidenceHandle.close(); }
    console.log(`HTTP local: ${report.result}; ${report.requests.length} solicitudes; ${report.checks.length} comprobaciones. Evidencia: ${config.evidenceFile}`);
    if (report.failure) console.error(report.failure);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
