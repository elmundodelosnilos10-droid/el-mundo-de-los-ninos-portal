"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { schoolDateTime, schoolLocalInputToISO } from "@/lib/datetime";
import { readSchoolUploadResponse, SCHOOL_UPLOAD_MAX_FILE_BYTES, SCHOOL_UPLOAD_LIMIT_LABEL, SCHOOL_UPLOAD_SIZE_MESSAGE, SCHOOL_UPLOAD_UNAVAILABLE_MESSAGE } from "@/lib/school-upload-limits";

type Group = { id: string; name: string };
type Child = { id: string; name: string; familyName: string };
type Task = { id: string; groupId: string; groupName: string; stage: string; title: string; instructions: string; dueAt: string | null; files: { id: string; name: string; url: string }[]; studentStatuses?: { studentId: string; status: string }[] };
type Evaluation = "logrado" | "en_proceso" | "con_acompanamiento" | null;
type Submission = { id: string; studentId: string; studentName: string; studentFamilyName: string; status: string; note: string | null; reviewNote: string | null; evaluation: Evaluation; files: { id: string; name: string; url: string }[] };

const evaluationLabels: Record<Exclude<Evaluation, null>, string> = {
  logrado: "Logrado",
  en_proceso: "En proceso",
  con_acompanamiento: "Con acompañamiento",
};
const taskStatusLabels: Record<string, string> = { pendiente: "Pendiente", entregada: "Entregada", revisada: "Revisada", completada: "Completada", vencida: "Vencida" };

class ConfirmedRejection extends Error {}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function validId(data: Record<string, unknown>) { return typeof data.id === "string" && uuid.test(data.id); }
function validFiles(value: unknown) { return Array.isArray(value) && value.every(file => file && typeof file.id === "string" && typeof file.name === "string" && typeof file.url === "string"); }
function validTask(value: Task) { return value && typeof value.id === "string" && typeof value.title === "string" && typeof value.groupName === "string" && typeof value.instructions === "string" && typeof value.stage === "string" && validFiles(value.files) && (value.studentStatuses === undefined || (Array.isArray(value.studentStatuses) && value.studentStatuses.every(item => item && typeof item.studentId === "string" && typeof item.status === "string"))); }
function validSubmission(value: Submission) { return value && typeof value.id === "string" && typeof value.studentId === "string" && typeof value.studentName === "string" && typeof value.studentFamilyName === "string" && typeof value.status === "string" && validFiles(value.files); }

export function TaskManager({ groups, familyChildren, canCreate, canReview, uploadsReady = false }: { groups: Group[]; familyChildren: Child[]; canCreate: boolean; canReview: boolean; uploadsReady?: boolean }) {
  const [items, setItems] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<Task | null>(null);
  const [submissions, setSubs] = useState<Submission[]>([]);

  const [page, setPage] = useState(1);
  const [loadedPage, setLoadedPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [listError, setListError] = useState("");
  const [subsError, setSubsError] = useState("");
  const [subsLoading, setSubsLoading] = useState(false);
  const [hasAccess, setHasAccess] = useState(true);
  const [needsRead, setNeedsRead] = useState(false);
  const pageSize = 25;
  const mounted = useRef(true);
  const access = useRef(true);
  const writeLock = useRef(false);
  const readLock = useRef(false);
  const listVersion = useRef(0);
  const viewVersion = useRef(0);
  const lifeVersion = useRef(0);
  const activeTask = useRef<Task | null>(null);
  const visibleSubs = useRef<Submission[]>([]);
  const targetPage = useRef(1);
  const listRequest = useRef<AbortController | null>(null);
  const subsRequest = useRef<AbortController | null>(null);
  const writeRequest = useRef<AbortController | null>(null);
  const requireRead = useCallback(() => { readLock.current = true; setNeedsRead(true); }, []);
  const cancelList = useCallback(() => { listVersion.current++; listRequest.current?.abort(); listRequest.current = null; }, []);
  const cancelView = useCallback(() => { viewVersion.current++; subsRequest.current?.abort(); subsRequest.current = null; }, []);
  const cancelAll = useCallback(() => {
    mounted.current = false; lifeVersion.current++; cancelList(); cancelView();
    writeRequest.current?.abort(); writeRequest.current = null;
  }, [cancelList, cancelView]);
  const revokeAccess = useCallback(() => {
    access.current = false; lifeVersion.current++; cancelList(); cancelView();
    writeRequest.current?.abort(); writeRequest.current = null;
    activeTask.current = null; visibleSubs.current = [];
    setHasAccess(false); setItems([]); setSubs([]); setSelected(null); setTotal(0);
    setNotice(""); setError(""); setListError(""); setSubsError(""); setBusy(false); setLoading(false); setSubsLoading(false);
  }, [cancelList, cancelView]);
  useEffect(() => { mounted.current = true; return cancelAll; }, [cancelAll]);

  const refresh = useCallback(async (requestedPage: number) => {
    if (!mounted.current || !access.current) return false;
    cancelList(); const controller = new AbortController(); listRequest.current = controller;
    const version = listVersion.current;
    const current = () => mounted.current && access.current && version === listVersion.current && !controller.signal.aborted;
    setLoading(true); setListError("");
    try {
      const response = await fetch(`/api/tasks?page=${requestedPage}&pageSize=${pageSize}`, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
      if (!current()) return false;
      if (response.status === 401 || response.status === 403) { revokeAccess(); return false; }
      if (!response.ok) throw Error();
      const data = await response.json() as { items?: Task[]; total?: number; page?: number; pageSize?: number; hasMore?: boolean };
      if (!current()) return false;
      if (!Array.isArray(data.items) || data.items.length > pageSize || !data.items.every(validTask) || !Number.isSafeInteger(data.total) || Number(data.total) < 0 || data.page !== requestedPage || data.pageSize !== pageSize || typeof data.hasMore !== "boolean") throw Error();
      setItems(data.items); setTotal(data.total!); setLoadedPage(data.page); setHasMore(data.hasMore);
      const lastPage = Math.max(1, Math.ceil(data.total! / pageSize));
      if (requestedPage > lastPage) setPage(lastPage);
      return true;
    } catch {
      if (current()) { setListError("No se pudo actualizar la lista de tareas. La última lista disponible puede estar desactualizada."); requireRead(); }
      return false;
    } finally { if (current()) { listRequest.current = null; setLoading(false); } }
  }, [cancelList, requireRead, revokeAccess]);
  useEffect(() => { targetPage.current = page; void refresh(page); return cancelList; }, [page, refresh, cancelList]);

  async function loadSubs(task: Task, internal = false) {
    if (!mounted.current || !access.current || (writeLock.current && !internal)) return false;
    cancelView(); activeTask.current = task; visibleSubs.current = [];
    setSelected(task); setSubs([]); setSubsError(""); setSubsLoading(true);
    const controller = new AbortController(); subsRequest.current = controller;
    const version = viewVersion.current;
    const current = () => mounted.current && access.current && version === viewVersion.current && activeTask.current?.id === task.id && !controller.signal.aborted;
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/submissions`, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
      if (!current()) return false;
      if (response.status === 401 || response.status === 403) { revokeAccess(); return false; }
      if (!response.ok) throw Error();
      const data = await response.json() as { items?: Submission[] };
      if (!current()) return false;
      if (!Array.isArray(data.items) || !data.items.every(validSubmission)) throw Error();
      visibleSubs.current = data.items; setSubs(data.items); return true;
    } catch {
      if (current()) { setSubsError("No se pudieron comprobar las entregas de esta tarea. Intenta consultar de nuevo."); requireRead(); }
      return false;
    } finally { if (current()) { subsRequest.current = null; setSubsLoading(false); } }
  }
  function closeSubs() {
    if (writeLock.current) return;
    cancelView(); activeTask.current = null; visibleSubs.current = [];
    setSelected(null); setSubs([]); setSubsError(""); setSubsLoading(false);
  }
  async function recheck() {
    if (writeLock.current || listRequest.current || subsRequest.current || !mounted.current || !access.current) return;
    const task = activeTask.current;
    const listOk = await refresh(targetPage.current);
    const viewOk = task && activeTask.current?.id === task.id ? await loadSubs(task) : true;
    if (listOk && viewOk && mounted.current && access.current) { readLock.current = false; setNeedsRead(false); }
  }

  function beginWrite() {
    if (!mounted.current || !access.current || writeLock.current || readLock.current || listRequest.current || subsRequest.current) return null;
    writeLock.current = true; const controller = new AbortController(); writeRequest.current = controller;
    const generation = lifeVersion.current;
    setBusy(true); setError(""); setNotice("");
    return { controller, current: () => mounted.current && access.current && generation === lifeVersion.current && !controller.signal.aborted };
  }
  type Write = NonNullable<ReturnType<typeof beginWrite>>;
  async function write(write: Write, url: string, method: "POST" | "PATCH", body: FormData | Record<string, unknown>, confirmation: (data: Record<string, unknown>) => boolean) {
    const multipart = body instanceof FormData;
    const response = await fetch(url, { method, credentials: "same-origin", ...(multipart ? { body } : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), signal: AbortSignal.any([write.controller.signal, AbortSignal.timeout(20_000)]) });
    if (!write.current()) return null;
    if (response.status === 401 || response.status === 403) { revokeAccess(); return null; }
    const data = (multipart ? await readSchoolUploadResponse(response) : await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!write.current()) return null;
    if (!response.ok) {
      if (![400, 404, 409, 413, 422].includes(response.status)) requireRead();
      throw new ConfirmedRejection(data && typeof data.error === "string" && data.error.length <= 1000 ? data.error : "No se pudo guardar el cambio.");
    }
    if (!data || typeof data !== "object" || Array.isArray(data) || (method === "POST" && response.status !== 201) || !confirmation(data)) { requireRead(); throw Error(); }
    return data;
  }
  function writeError(write: Write, cause: unknown) {
    if (!write.current()) return;
    if (cause instanceof ConfirmedRejection) setError(cause.message);
    else { requireRead(); setError("No se pudo confirmar el último cambio. Consulta el estado antes de volver a enviarlo."); }
  }
  function finishWrite(write: Write) {
    writeLock.current = false;
    if (write.current()) { writeRequest.current = null; setBusy(false); }
  }
  async function afterWrite(write: Write, task?: Task) {
    if (!write.current()) return;
    requireRead();
    const listOk = await refresh(targetPage.current);
    const viewOk = task && activeTask.current?.id === task.id ? await loadSubs(task, true) : true;
    if (write.current() && listOk && viewOk) { readLock.current = false; setNeedsRead(false); }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!mounted.current || !access.current || !canCreate) return;
    const form = event.currentTarget; const data = new FormData(form);
    const attachments = data.getAll("attachments").filter((value): value is File => value instanceof File && value.size > 0);
    if (attachments.some(file => file.size > SCHOOL_UPLOAD_MAX_FILE_BYTES)) { setError(SCHOOL_UPLOAD_SIZE_MESSAGE); return; }
    if (attachments.length && !uploadsReady) { setError(SCHOOL_UPLOAD_UNAVAILABLE_MESSAGE); return; }
    const operation = beginWrite(); if (!operation) return;
    let published = false;
    try {
      const due = String(data.get("dueAt") || "");
      const result = await write(operation, "/api/tasks", "POST", { groupId: data.get("groupId"), title: data.get("title"), instructions: data.get("instructions"), dueAt: due ? schoolLocalInputToISO(due) : undefined }, validId);
      if (!result || !operation.current()) return;
      published = true; form.reset(); setNotice("Tarea publicada para el grupo.");
      // Uploads belong to the confirmed task, independently of a later list read.
      let attached = 0;
      for (const file of attachments) {
        const uploadData = new FormData(); uploadData.set("purpose", "task"); uploadData.set("taskId", String(result.id)); uploadData.set("file", file);
        const uploaded = await write(operation, "/api/files", "POST", uploadData, validId);
        if (!uploaded || !operation.current()) return;
        attached++;
        setNotice(`Tarea publicada para el grupo. ${attached} de ${attachments.length} materiales adjuntados.`);
      }
      await afterWrite(operation);
    } catch (cause) {
      writeError(operation, cause);
      if (published && operation.current()) { setNotice("Tarea publicada para el grupo. Revisa sus materiales antes de adjuntar de nuevo."); await afterWrite(operation); }
    } finally { finishWrite(operation); }
  }

  async function fileWrite(task: Task, event: FormEvent<HTMLFormElement>, purpose: "task" | "submission") {
    event.preventDefault(); if (!mounted.current || !access.current || (purpose === "task" && !canCreate)) return;
    if (!uploadsReady) { setError(SCHOOL_UPLOAD_UNAVAILABLE_MESSAGE); return; }
    const form = event.currentTarget; const data = new FormData(form); const file = data.get("file");
    if (!(file instanceof File) || !file.size) { setError("Selecciona un archivo para enviar."); return; }
    if (file.size > SCHOOL_UPLOAD_MAX_FILE_BYTES) { setError(SCHOOL_UPLOAD_SIZE_MESSAGE); return; }
    data.set("purpose", purpose); data.set("taskId", task.id);
    const operation = beginWrite(); if (!operation) return;
    try {
      const result = await write(operation, "/api/files", "POST", data, validId);
      if (!result || !operation.current()) return;
      form.reset(); setNotice(purpose === "submission" ? "Evidencia entregada." : "Material adjuntado a la tarea.");
      await afterWrite(operation, task);
    } catch (cause) { writeError(operation, cause); }
    finally { finishWrite(operation); }
  }
  function attach(task: Task, event: FormEvent<HTMLFormElement>) { return fileWrite(task, event, "task"); }
  function upload(task: Task, event: FormEvent<HTMLFormElement>) { return fileWrite(task, event, "submission"); }

  async function review(item: Submission, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const task = activeTask.current;
    if (!canReview || !task || task.id !== selected?.id || !visibleSubs.current.some(row => row.id === item.id)) return;
    const version = viewVersion.current;
    const operation = beginWrite(); if (!operation) return;
    const data = new FormData(event.currentTarget);
    try {
      const evaluation = data.get("evaluation");
      const result = await write(operation, `/api/submissions/${encodeURIComponent(item.id)}`, "PATCH", { status: String(data.get("status")), reviewNote: data.get("reviewNote"), evaluation: (task.stage === "prekinder" || task.stage === "preescolar") && evaluation ? String(evaluation) : null }, data => data.reviewed === true);
      if (!result || !operation.current() || activeTask.current?.id !== task.id || version !== viewVersion.current) return;
      setNotice("Retroalimentación guardada. La familia puede consultarla en el portal.");
      await afterWrite(operation, task);
    } catch (cause) { writeError(operation, cause); }
    finally { finishWrite(operation); }
  }

  if (!hasAccess) return <section className="portal-panel"><h2>Acceso a tareas no disponible</h2><p role="alert">Tu sesión o tus permisos cambiaron. Vuelve a ingresar para revisar el acceso.</p><a href="/ingresar">Volver a ingresar</a></section>;
  const controlsDisabled = busy || loading || subsLoading || needsRead;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const canEvaluate = selected?.stage === "prekinder" || selected?.stage === "preescolar";

  return <>
    {!uploadsReady && <p role="status">{SCHOOL_UPLOAD_UNAVAILABLE_MESSAGE} Puedes consultar las tareas y sus archivos disponibles.</p>}
    {canCreate && <section className="portal-panel"><h2>Publicar una tarea</h2>{groups.length ? <form className="school-form event-form" onSubmit={create}>
      <label htmlFor="task-group">Grupo</label><select id="task-group" name="groupId" disabled={controlsDisabled} required>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select>
      <label htmlFor="task-title">Título</label><input id="task-title" name="title" disabled={controlsDisabled} required minLength={2} maxLength={120} />
      <label htmlFor="task-instructions">Instrucciones para la familia</label><textarea id="task-instructions" name="instructions" disabled={controlsDisabled} required minLength={2} maxLength={3000} />
      <label htmlFor="task-due">Fecha límite · hora de Ciudad de México</label><input id="task-due" name="dueAt" disabled={controlsDisabled} type="datetime-local" />
      <label htmlFor="task-attachments">Materiales para la actividad · PDF, imagen o audio (hasta {SCHOOL_UPLOAD_LIMIT_LABEL} por archivo)</label><input id="task-attachments" name="attachments" type="file" disabled={controlsDisabled || !uploadsReady} multiple accept="application/pdf,image/jpeg,image/png,image/webp,audio/mpeg,audio/ogg,audio/wav" />
      <button disabled={controlsDisabled}>{busy ? "Publicando…" : "Publicar tarea"}</button>
    </form> : <p>Primero registra o asigna un grupo.</p>}</section>}

    <section className="portal-panel"><h2>Actividades de tus grupos</h2>
      {listError && <p className="form-error" role="alert">{listError}</p>}
      {(listError || needsRead) && <button type="button" className="secondary-button" disabled={busy || loading || subsLoading} onClick={() => void recheck()}>Actualizar tareas</button>}
      {loadedPage > 0 && <p className="list-count" aria-live="polite">{total} {total === 1 ? "tarea" : "tareas"} · Página {loadedPage} de {pageCount}</p>}
{loading ? <p role="status">Cargando tareas…</p> : !items.length ? <div className="empty-state"><p>{listError ? "No pudimos comprobar las tareas." : canCreate ? "Todavía no hay tareas. Publica la primera desde el formulario de arriba." : "Todavía no hay tareas para tus grupos. Cuando una maestra publique una, aparecerá aquí."}</p></div> : <ul className="record-list">{items.map(task => <li key={task.id}><div>
      <strong>{task.title}</strong><span>{task.groupName}{task.dueAt ? ` · Entrega: ${schoolDateTime(task.dueAt)}` : " · Sin fecha límite"}</span><p>{task.instructions}</p>
      {task.files.map(file => <p key={file.id}><a href={file.url}>{file.name} · Descargar material ↓</a></p>)}
      {canCreate && <form className="inline-upload" onSubmit={event => attach(task, event)}><input name="file" type="file" disabled={controlsDisabled || !uploadsReady} accept="application/pdf,image/jpeg,image/png,image/webp,audio/mpeg,audio/ogg,audio/wav" required aria-label={`Adjuntar material a ${task.title} · hasta ${SCHOOL_UPLOAD_LIMIT_LABEL}`} /><button disabled={controlsDisabled || !uploadsReady}>Adjuntar material</button></form>}
      {familyChildren.length > 0 && Boolean(task.studentStatuses?.length) && <>
        {task.studentStatuses?.map(status => {
          const child = familyChildren.find(item => item.id === status.studentId);
          return child ? <span className="task-status" key={child.id}>{child.name}: {taskStatusLabels[status.status] ?? status.status}</span> : null;
        })}
        <form className="inline-upload" onSubmit={event => upload(task, event)}><select name="studentId" disabled={controlsDisabled} required aria-label="Alumno">{familyChildren.filter(child => task.studentStatuses?.some(status => status.studentId === child.id)).map(child => <option key={child.id} value={child.id}>{child.name} {child.familyName}</option>)}</select><input name="file" type="file" disabled={controlsDisabled || !uploadsReady} accept="application/pdf,image/jpeg,image/png,image/webp" required aria-label={`Archivo de evidencia · hasta ${SCHOOL_UPLOAD_LIMIT_LABEL}`} /><button disabled={controlsDisabled || !uploadsReady}>Enviar evidencia</button></form>
      </>}
    </div><button className="secondary-button" disabled={busy} onClick={() => void loadSubs(task)}>{canReview ? "Revisar entregas" : "Ver mi entrega"}</button></li>)}</ul>}
      {loadedPage > 0 && pageCount > 1 && <nav className="pagination-controls" aria-label="Páginas de tareas"><button type="button" className="secondary-button" disabled={busy || loading || loadedPage <= 1} onClick={() => { closeSubs(); setPage(loadedPage - 1); }}>Anterior</button><span>Página {loadedPage} de {pageCount}</span><button type="button" className="secondary-button" disabled={busy || loading || !hasMore} onClick={() => { closeSubs(); setPage(loadedPage + 1); }}>Siguiente</button></nav>}
    </section>

    {selected && <section className="portal-panel"><div className="panel-heading"><h2>Entregas · {selected.title}</h2><button className="secondary-button" disabled={busy} onClick={closeSubs}>Cerrar</button></div>
      {subsError && <p className="form-error" role="alert">{subsError}</p>}
      {subsError && <button type="button" className="secondary-button" disabled={busy || subsLoading || loading} onClick={() => void recheck()}>Consultar entregas de nuevo</button>}
      {subsLoading ? <p role="status">Comprobando entregas de esta tarea…</p> : subsError ? <p>No se pudo confirmar la lista de entregas.</p> : submissions.length ? <ul className="record-list">{submissions.map(submission => <li key={submission.id}><div>
        <strong>{submission.studentName} {submission.studentFamilyName} · {submission.status}</strong>
        {submission.note && <span>Nota de la familia: {submission.note}</span>}
        {submission.evaluation && <p><strong>Evaluación formativa:</strong> {evaluationLabels[submission.evaluation]}</p>}
        {submission.reviewNote && <p>Retroalimentación: {submission.reviewNote}</p>}
        {submission.files.map(file => <a key={file.id} href={file.url}>{file.name} ↓</a>)}
        {canReview && <form className="school-form evaluation-form" onSubmit={event => review(submission, event)}>
          <label htmlFor={`review-note-${submission.id}`}>Observación para la familia</label><textarea id={`review-note-${submission.id}`} name="reviewNote" disabled={controlsDisabled} maxLength={1000} defaultValue={submission.reviewNote ?? ""} />
          {canEvaluate ? <><label htmlFor={`evaluation-${submission.id}`}>Evaluación formativa · sin calificación numérica</label><select id={`evaluation-${submission.id}`} name="evaluation" disabled={controlsDisabled} defaultValue={submission.evaluation ?? ""}><option value="">Sin evaluación</option><option value="logrado">Logrado</option><option value="en_proceso">En proceso</option><option value="con_acompanamiento">Con acompañamiento</option></select></> : <p className="form-hint">En lactantes y maternal se usan observaciones cualitativas, sin calificaciones académicas.</p>}
          <label htmlFor={`status-${submission.id}`}>Estado de la entrega</label><select id={`status-${submission.id}`} name="status" disabled={controlsDisabled} defaultValue={submission.status === "completada" ? "completada" : "revisada"}><option value="revisada">Revisada</option><option value="completada">Completada</option></select>
          <button disabled={controlsDisabled}>{busy ? "Guardando…" : "Guardar retroalimentación"}</button>
        </form>}
      </div></li>)}</ul> : <p>No hay entregas registradas aún.</p>}
    </section>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="form-success" role="status">{notice}</p>}
  </>;
}
