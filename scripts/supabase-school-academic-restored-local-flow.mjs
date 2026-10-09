import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { items, requiredId } from './supabase-school-http-local-support.mjs';

export function parseAttendanceCsv(bytes) {
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  const rows = []; let row = [], value = '', quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"') { if (quoted && source[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && c === ',') { row.push(value); value = ''; }
    else if (!quoted && c === '\r' && source[i + 1] === '\n') { row.push(value); rows.push(row); row = []; value = ''; i++; }
    else value += c;
  }
  assert.equal(quoted, false); row.push(value); rows.push(row);
  return rows;
}
const decodeXml = value => value.replace(/&(amp|lt|gt|quot|apos);/g, (_, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[entity]);
export function parseAttendanceXlsx(bytes) {
  assert.equal(Buffer.from(bytes).subarray(0, 2).toString(), 'PK');
  const entries = unzipSync(bytes);
  for (const name of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/worksheets/sheet1.xml']) assert.ok(entries[name]);
  assert.ok(strFromU8(entries['[Content_Types].xml']).includes('spreadsheetml.sheet.main+xml'));
  const sheet = strFromU8(entries['xl/worksheets/sheet1.xml']);
  return [...sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(row => [...row[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(cell => decodeXml(cell[1])));
}
export function parseAttendancePdf(bytes) {
  const source = Buffer.from(bytes).toString('latin1');
  assert.ok(source.startsWith('%PDF-1.4')); assert.match(source, /%%EOF\s*$/);
  const xref = Number(source.match(/startxref\s+(\d+)\s+%%EOF/)[1]); assert.equal(source.slice(xref, xref + 4), 'xref');
  const xrefEntries = [...source.slice(xref).matchAll(/(\d{10}) 00000 n /g)]; assert.ok(xrefEntries.length >= 5);
  xrefEntries.forEach((entry, index) => assert.ok(source.slice(Number(entry[1])).startsWith(`${index + 1} 0 obj`)));
  const columns = [41, 111, 221, 406, 516].map(x => [...source.matchAll(/BT \/F1 ([\d.]+) Tf ([\d.]+) ([\d.]+) Td <([A-F\d]*)> Tj ET/g)].filter(item => Number(item[1]) === 8.5 && Number(item[2]) === x).map(item => new TextDecoder('windows-1252').decode(Buffer.from(item[4], 'hex'))).join(''));
  return columns;
}
export function assertAttendanceExport(format, response, expected) {
  assert.equal(response.cacheControl, 'no-store');
  const types = { csv: 'text/csv', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pdf: 'application/pdf' };
  assert.ok(response.contentType?.startsWith(types[format]));
  if (format === 'pdf') assert.deepEqual(parseAttendancePdf(response.bytes), expected.map(value => value.replaceAll('\n', '')));
  else assert.deepEqual((format === 'csv' ? parseAttendanceCsv(response.bytes) : parseAttendanceXlsx(response.bytes)), [['Fecha', 'Grupo', 'Alumno', 'Estado', 'Observación'], expected]);
}

/** Real app calls only: this helper has no fake provider or data implementation. */
export async function exerciseRestoredAcademic({ call, teacher, families, student, group, foreignGroupId, date, marker, check }) {
  const own = families[0], foreign = families[1];
  const originalEvent = { groupId: group.id, kind: 'evento', title: `Evento ${marker}`, description: 'Actividad sintética de calendario', startsAt: `${date}T10:00:00-06:00`, endsAt: `${date}T11:00:00-06:00` };
  const event = await call(teacher, '/api/calendar', { method: 'POST', body: originalEvent, statuses: [201], label: 'Docente crea evento de su grupo' }); requiredId(event.id, 'Evento');
  const updatedEvent = { kind: 'reunion', title: `Reunión ${marker}`, description: 'Actividad editada, hora de Ciudad de México', startsAt: `${date}T12:00:00-06:00`, endsAt: `${date}T13:00:00-06:00` };
  const updated = await call(teacher, `/api/calendar/${event.id}`, { method: 'PATCH', body: updatedEvent, label: 'Docente edita evento propio' }); check('Calendario creación y edición confirmadas', updated.updated === true);
  const calendar = `/api/calendar?from=${date}&to=${date}&groupId=${group.id}&kind=reunion`;
  const feed = await call(own, calendar, { label: 'Familia consulta grupo de su hijo y tipo' });
  check('Calendario filtrado conserva edición y hora CDMX', feed.timeZone === 'America/Mexico_City' && items(feed, 'Calendario').some(row => row.id === event.id && row.title === updatedEvent.title && row.groupId === group.id && Date.parse(row.startsAt) === Date.parse(updatedEvent.startsAt)));
  const foreignCalendar = await call(foreign, calendar, { label: 'Familia ajena consulta filtro del grupo' }); check('Calendario ajeno no filtra eventos privados', items(foreignCalendar, 'Calendario ajeno').length === 0);
  const different = await call(own, `/api/calendar?from=${date}&to=${date}&groupId=${group.id}&kind=festival`, { label: 'Filtro tipo distinto' }); check('Filtro por tipo excluye reunión', !items(different, 'Filtro').some(row => row.id === event.id));
  await call(null, calendar, { statuses: [401], label: 'Calendario anónimo rechazado' });
  await call(own, `/api/calendar/${event.id}`, { method: 'PATCH', body: updatedEvent, statuses: [403], label: 'Familia no puede editar calendario' });
  await call(teacher, '/api/calendar', { method: 'POST', body: { ...originalEvent, groupId: foreignGroupId }, statuses: [404], label: 'Docente no puede crear en grupo ajeno' });

  const saved = await call(teacher, '/api/attendance', { method: 'POST', body: { groupId: group.id, onDate: date, records: [{ studentId: student.id, status: 'ausente', note: `Falta sintética ${marker}` }] }, label: 'Docente registra falta nueva' }); check('Asistencia nueva registrada una vez', saved.saved === 1);
  const roster = await call(teacher, `/api/attendance?groupId=${group.id}&date=${date}`, { label: 'Docente consulta lista nueva' }); const record = items(roster, 'Asistencia').find(row => row.studentId === student.id); requiredId(record?.id, 'Asistencia'); check('Lista de asistencia persiste falta', record.status === 'ausente');
  const historyPath = `/api/attendance/history?studentId=${student.id}&from=${date}&to=${date}`;
  const absent = await call(own, historyPath, { label: 'Familia ve historial inicial' }); check('Historial inicial refleja falta', absent.counts.ausente === 1 && absent.total === 1 && absent.records.length === 1);
  await call(foreign, historyPath, { statuses: [404], label: 'Historial de hijo ajeno rechazado' });
  await call(null, historyPath, { statuses: [401], label: 'Historial anónimo rechazado' });
  const reason = `Motivo ${marker}, con "comillas" y acento: revisión médica.\nSegunda línea completa para exportación.`;
  await call(foreign, '/api/attendance/justifications', { method: 'POST', body: { studentId: student.id, onDate: date, reason }, statuses: [404], label: 'Familia ajena no justifica al alumno' });
  const justification = await call(own, '/api/attendance/justifications', { method: 'POST', body: { studentId: student.id, onDate: date, reason }, statuses: [201], label: 'Familia presenta justificación' }); requiredId(justification.id, 'Justificación'); check('Justificación pendiente confirmada', justification.status === 'pendiente');
  const pending = await call(teacher, `/api/attendance/justifications?groupId=${group.id}&date=${date}`, { label: 'Docente ve justificación pendiente' }); check('Lista docente conserva razón completa', items(pending, 'Justificaciones').some(row => row.id === justification.id && row.status === 'pendiente' && row.reason === reason));
  await call(own, `/api/attendance/justifications/${justification.id}`, { method: 'PATCH', body: { status: 'aceptada' }, statuses: [403], label: 'Familia no puede aprobar su petición' });
  const accepted = await call(teacher, `/api/attendance/justifications/${justification.id}`, { method: 'PATCH', body: { status: 'aceptada' }, label: 'Docente aprueba justificación' }); check('Revisión docente aprobada', accepted.status === 'aceptada');
  const history = await call(own, historyPath, { label: 'Familia ve historial justificado' }); check('Historial final muestra justificación completa', history.counts.justificada === 1 && history.counts.ausente === 0 && history.records.length === 1 && history.records[0].status === 'justificada' && history.records[0].note === reason);
  const staffHistory = await call(teacher, `${historyPath}&groupId=${group.id}`, { label: 'Docente consulta historial de su grupo' }); check('Historial docente coincide con familia', JSON.stringify(staffHistory) === JSON.stringify(history));
  const ownList = await call(own, `/api/attendance/justifications?studentId=${student.id}`, { label: 'Familia ve revisión final' }); check('Familia recibe estado revisado', items(ownList, 'Justificaciones').some(row => row.id === justification.id && row.status === 'aceptada' && row.reviewedAt));
  await call(foreign, `/api/attendance/justifications?studentId=${student.id}`, { statuses: [404], label: 'Familia ajena no ve justificación' });
  const expected = [date, group.name, `${student.given_name} ${student.family_name}`, 'justificada', reason];
  for (const format of ['csv', 'xlsx', 'pdf']) { const response = await call(teacher, '/api/attendance/report', { method: 'POST', body: { groupId: group.id, from: date, to: date, format }, responseType: 'bytes', label: `Exportación real ${format}` }); assertAttendanceExport(format, response, expected); check(`Reporte ${format} contiene grupo, nombre, estado y razón completos`, true); }
  await call(own, '/api/attendance/report', { method: 'POST', body: { groupId: group.id, from: date, to: date, format: 'pdf' }, statuses: [403], label: 'Familia no exporta lista de grupo' });
  await call(teacher, '/api/attendance/report', { method: 'POST', body: { groupId: foreignGroupId, from: date, to: date, format: 'csv' }, statuses: [404], label: 'Docente no exporta grupo ajeno' });

  const announcementInput = { groupId: group.id, title: `Aviso ${marker}`, body: `Comunicado publicado por docente ${marker}`, important: true };
  const announcement = await call(teacher, '/api/announcements', { method: 'POST', body: announcementInput, statuses: [201], label: 'Docente publica comunicado propio' }); requiredId(announcement.id, 'Comunicado'); check('Docente publica y notifica familias', Number.isInteger(announcement.notified) && announcement.notified >= 1);
  const ownFeed = await call(own, '/api/announcements', { label: 'Familia lee comunicado docente' }); check('Familia propia recibe comunicado y autor docente', items(ownFeed, 'Comunicados').some(row => row.id === announcement.id && row.title === announcementInput.title && row.body === announcementInput.body && row.publishedBy === teacher.id));
  const foreignFeed = await call(foreign, '/api/announcements', { label: 'Familia ajena ve su feed' }); check('Comunicado no se filtra a familia ajena', !items(foreignFeed, 'Comunicados').some(row => row.id === announcement.id));
  await call(null, '/api/announcements', { statuses: [401], label: 'Comunicados anónimos rechazados' });
  const read = await call(own, `/api/announcements/${announcement.id}/read`, { method: 'POST', label: 'Familia acusa comunicado' }); check('Acuse de comunicado confirmado', read.read === true);
  await call(foreign, `/api/announcements/${announcement.id}/read`, { method: 'POST', statuses: [404], label: 'Familia ajena no acusa comunicado' });
  await call(teacher, '/api/announcements', { method: 'POST', body: { ...announcementInput, groupId: foreignGroupId }, statuses: [404], label: 'Docente no publica comunicado en grupo ajeno' });
  return { eventId: event.id, event: updatedEvent, attendanceId: record.id, justificationId: justification.id, reason, announcementId: announcement.id, announcement: announcementInput };
}
