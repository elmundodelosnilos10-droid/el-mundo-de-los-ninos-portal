import { createHash } from 'node:crypto';
import { items, requiredId } from './supabase-school-http-local-support.mjs';

export function syntheticPdf(text) {
  if (!/^[A-Za-z0-9 .-]{1,120}$/.test(text)) throw new Error('Texto PDF sintético no válido.');
  const stream = `BT /F1 12 Tf 40 100 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 160] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let content = '%PDF-1.4\n'; const offsets = [0];
  for (let index = 0; index < objects.length; index++) { offsets.push(Buffer.byteLength(content)); content += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`; }
  const xref = Buffer.byteLength(content);
  content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) content += `${String(offset).padStart(10, '0')} 00000 n \n`;
  content += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(content));
}

export function syntheticUpload(fields, bytes, name = 'actividad-sintetica.pdf') {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  form.set('file', new Blob([bytes], { type: 'application/pdf' }), name);
  return form;
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function confirmDownload(call, account, fileId, expected, check, label) {
  const downloaded = await call(account, `/api/files/${fileId}`, { responseType: 'bytes', label });
  check(`${label}: PDF privado y bytes íntegros`, downloaded.contentType === 'application/pdf' && downloaded.cacheControl === 'private, no-store' && downloaded.nosniff === 'nosniff' && hash(downloaded.bytes) === hash(expected));
}

/** Uses only existing school APIs, cookie jars in RAM and local synthetic files.
 * The app must perform real scanning and private Storage writes; there is no
 * scanner replacement, signed/public URL, file-system fixture or hidden retry.
 */
export async function prepareSchoolPrivateFiles({ call, teacher, familyA, familyB, groupId, taskId, suffix, check }) {
  const original = syntheticPdf('Synthetic private school resource version one.');
  const updated = syntheticPdf('Synthetic private school resource version two.');
  const taskBytes = syntheticPdf('Synthetic task guide for family A.');
  const published = await call(teacher, '/api/files', { method: 'POST', body: syntheticUpload({ purpose: 'material', groupId, title: `Material HTTP ${suffix}`, category: 'Guía' }, original), statuses: [201], label: 'Docente sube material con escáner real' });
  const materialFileId = requiredId(published?.id, 'Archivo biblioteca');
  const query = `?q=${encodeURIComponent(`HTTP ${suffix}`)}&groupId=${groupId}&category=${encodeURIComponent('Guía')}&page=1&pageSize=12`;
  const feed = await call(familyA, `/api/materials${query}`, { label: 'Familia A busca biblioteca privada' });
  const resources = items(feed, 'Biblioteca');
  const material = resources.find(row => row.fileId === materialFileId);
  check('Biblioteca filtra y pagina material autorizado', resources.length === 1 && feed.total === 1 && feed.page === 1 && feed.pageSize === 12 && material?.category === 'Guía');
  const materialId = requiredId(material?.id, 'Recurso biblioteca');
  await call(familyB, `/api/materials${query}`, { statuses: [404], label: 'B no consulta filtro de grupo ajeno' });
  const ownQuery = `?q=${encodeURIComponent(`HTTP ${suffix}`)}&category=${encodeURIComponent('Guía')}&page=1&pageSize=12`;
  const ownFeed = await call(familyB, `/api/materials${ownQuery}`, { label: 'Biblioteca privada autorizada de B' });
  check('Biblioteca B no contiene material ajeno', items(ownFeed, 'Biblioteca').length === 0 && ownFeed.total === 0);
  await confirmDownload(call, familyA, materialFileId, original, check, 'Previsualización PDF biblioteca A');
  await call(familyB, `/api/files/${materialFileId}`, { statuses: [404], label: 'B sin descarga de biblioteca ajena' });
  await call(null, `/api/files/${materialFileId}`, { statuses: [401], label: 'Anónimo sin descarga privada' });
  const attached = await call(teacher, '/api/files', { method: 'POST', body: syntheticUpload({ purpose: 'task', taskId }, taskBytes, 'guia-tarea-sintetica.pdf'), statuses: [201], label: 'Docente adjunta PDF a tarea' });
  const taskFileId = requiredId(attached?.id, 'Archivo tarea');
  const withFile = items(await call(familyA, '/api/tasks', { label: 'Tutor recibe tarea con PDF' }), 'Tareas').find(row => row.id === taskId);
  check('PDF de tarea enlazado por API', Array.isArray(withFile?.files) && withFile.files.some(row => row.id === taskFileId));
  await confirmDownload(call, familyA, taskFileId, taskBytes, check, 'PDF privado de tarea A');
  await call(familyB, `/api/files/${taskFileId}`, { statuses: [404], label: 'B sin descarga de tarea ajena' });
  const replacement = await call(teacher, `/api/materials/${materialId}/replace`, { method: 'POST', body: syntheticUpload({}, updated, 'actividad-sintetica-v2.pdf'), label: 'Docente reemplaza material con escáner real' });
  check('Reemplazo conserva recurso e identidad privada', replacement?.id === materialId && replacement.fileId === materialFileId && replacement.name === 'actividad-sintetica-v2.pdf');
  await confirmDownload(call, familyA, materialFileId, updated, check, 'PDF biblioteca actualizado A');
  await call(familyA, `/api/materials/${materialId}/replace`, { method: 'POST', body: syntheticUpload({}, original), statuses: [403], label: 'Tutor no reemplaza material' });
  await call(familyB, `/api/files/${materialFileId}`, { statuses: [404], label: 'Reemplazo mantiene aislamiento de B' });
  return { evidenceBytes: syntheticPdf('Synthetic student evidence for family A.') };
}

export async function attachSchoolSubmissionFile({ call, teacher, familyA, familyB, studentId, taskId, evidenceBytes, check }) {
  const uploaded = await call(familyA, '/api/files', { method: 'POST', body: syntheticUpload({ purpose: 'submission', taskId, studentId }, evidenceBytes, 'evidencia-sintetica.pdf'), statuses: [201], label: 'Tutor sube evidencia con escáner real' });
  const fileId = requiredId(uploaded?.id, 'Archivo evidencia');
  const rows = items(await call(teacher, `/api/tasks/${taskId}/submissions`, { label: 'Docente recibe entrega con archivo' }), 'Entregas');
  check('Evidencia vinculada a entrega correcta', rows.length === 1 && rows[0].studentId === studentId && rows[0].status === 'entregada' && Array.isArray(rows[0].files) && rows[0].files.some(row => row.id === fileId));
  await confirmDownload(call, teacher, fileId, evidenceBytes, check, 'Docente descarga evidencia privada');
  await confirmDownload(call, familyA, fileId, evidenceBytes, check, 'Tutor descarga evidencia propia');
  await call(familyB, `/api/files/${fileId}`, { statuses: [404], label: 'B sin evidencia de alumno ajeno' });
  await call(familyB, '/api/files', { method: 'POST', body: syntheticUpload({ purpose: 'submission', taskId, studentId }, evidenceBytes), statuses: [404], label: 'B no adjunta evidencia por alumno ajeno' });
}
