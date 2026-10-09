"use client";

import { useEffect, useState, type FormEvent } from "react";
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

export function TaskManager({ groups, familyChildren, canCreate, canReview, uploadsReady = false }: { groups: Group[]; familyChildren: Child[]; canCreate: boolean; canReview: boolean; uploadsReady?: boolean }) {
  const [items, setItems] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<Task | null>(null);
  const [submissions, setSubs] = useState<Submission[]>([]);

  async function refresh() {
    const response = await fetch("/api/tasks", { cache: "no-store" });
    const data = await response.json() as { error?: string; items?: Task[] };
    if (!response.ok) throw Error(data.error || "No se cargaron las tareas.");
    setItems(data.items ?? []);
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/tasks", { cache: "no-store" })
      .then(async response => {
        const data = await response.json() as { error?: string; items?: Task[] };
        if (!response.ok) throw Error(data.error || "No se cargaron las tareas.");
        return data.items ?? [];
      })
      .then(tasks => { if (!cancelled) { setItems(tasks); setLoading(false); } })
      .catch(error => { if (!cancelled) { setError(error instanceof Error ? error.message : "No se cargaron las tareas."); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    const form = event.currentTarget; const data = new FormData(form);
    const attachments = data.getAll("attachments").filter((value): value is File => value instanceof File && value.size > 0);
    try {
      if (attachments.some(file => file.size > SCHOOL_UPLOAD_MAX_FILE_BYTES)) throw Error(SCHOOL_UPLOAD_SIZE_MESSAGE);
      if (attachments.length && !uploadsReady) throw Error(SCHOOL_UPLOAD_UNAVAILABLE_MESSAGE);
      const due = String(data.get("dueAt") || "");
      const response = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ groupId: data.get("groupId"), title: data.get("title"), instructions: data.get("instructions"), dueAt: due ? schoolLocalInputToISO(due) : undefined }) });
      const result = await response.json() as { id?: string; error?: string };
      if (!response.ok) throw Error(result.error || "No se pudo publicar.");
      form.reset(); await refresh(); setNotice("Tarea publicada para el grupo.");
      let uploadFailed = false;
      for (const file of attachments) {
        const uploadData = new FormData(); uploadData.set("purpose", "task"); uploadData.set("taskId", result.id!); uploadData.set("file", file);
        const uploadResponse = await fetch("/api/files", { method: "POST", body: uploadData });
        const uploadResult = await readSchoolUploadResponse(uploadResponse) as { error?: string };
        if (!uploadResponse.ok) { uploadFailed = true; setError(uploadResult.error || "No se pudo adjuntar un material."); }
      }
      if (uploadFailed) setError("La tarea se publicó, pero no todos los materiales se adjuntaron. Puedes agregarlos desde la tarjeta de la tarea.");
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Error de conexión."); }
    finally { setBusy(false); }
  }

  async function attach(task: Task, event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    data.set("purpose", "task"); data.set("taskId", task.id); setBusy(true); setError(""); setNotice("");
    try {
      if (!uploadsReady) throw Error(SCHOOL_UPLOAD_UNAVAILABLE_MESSAGE);
      const file = data.get("file");
      if (file instanceof File && file.size > SCHOOL_UPLOAD_MAX_FILE_BYTES) throw Error(SCHOOL_UPLOAD_SIZE_MESSAGE);
      const response = await fetch("/api/files", { method: "POST", body: data });
      const result = await readSchoolUploadResponse(response) as { error?: string };
      if (!response.ok) throw Error(result.error || "No se pudo adjuntar el material.");
      form.reset(); await refresh(); setNotice("Material adjuntado a la tarea.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Error de conexión."); }
    finally { setBusy(false); }
  }

  async function loadSubs(task: Task) {
    setSelected(task); setError("");
    try {
      const response = await fetch(`/api/tasks/${task.id}/submissions`, { cache: "no-store" });
      const data = await response.json() as { error?: string; items?: Submission[] };
      if (!response.ok) throw Error(data.error || "No se cargaron las entregas.");
      setSubs(data.items ?? []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Error de conexión."); }
  }

  async function upload(task: Task, event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    data.set("purpose", "submission"); data.set("taskId", task.id); setBusy(true); setError(""); setNotice("");
    try {
      if (!uploadsReady) throw Error(SCHOOL_UPLOAD_UNAVAILABLE_MESSAGE);
      const file = data.get("file");
      if (file instanceof File && file.size > SCHOOL_UPLOAD_MAX_FILE_BYTES) throw Error(SCHOOL_UPLOAD_SIZE_MESSAGE);
      const response = await fetch("/api/files", { method: "POST", body: data });
      const result = await readSchoolUploadResponse(response) as { error?: string };
      if (!response.ok) throw Error(result.error || "No se pudo subir la evidencia.");
      setNotice("Evidencia entregada."); form.reset(); await refresh(); await loadSubs(task);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Error de conexión."); }
    finally { setBusy(false); }
  }

  async function review(item: Submission, event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return;
    const data = new FormData(event.currentTarget); setBusy(true); setError(""); setNotice("");
    const status = String(data.get("status"));
    const evaluation = data.get("evaluation");
    try {
      const response = await fetch(`/api/submissions/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, reviewNote: data.get("reviewNote"), evaluation: evaluation ? String(evaluation) : null }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw Error(result.error || "No se pudo guardar la evaluación.");
      setNotice("Retroalimentación guardada y notificada a la familia.");
      await refresh(); await loadSubs(selected);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Error de conexión."); }
    finally { setBusy(false); }
  }

  const canEvaluate = selected?.stage === "prekinder" || selected?.stage === "preescolar";

  return <>
    {!uploadsReady && <p role="status">{SCHOOL_UPLOAD_UNAVAILABLE_MESSAGE} Puedes consultar las tareas y sus archivos disponibles.</p>}
    {canCreate && <section className="portal-panel"><h2>Publicar una tarea</h2>{groups.length ? <form className="school-form event-form" onSubmit={create}>
      <label htmlFor="task-group">Grupo</label><select id="task-group" name="groupId" required>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select>
      <label htmlFor="task-title">Título</label><input id="task-title" name="title" required minLength={2} maxLength={120} />
      <label htmlFor="task-instructions">Instrucciones para la familia</label><textarea id="task-instructions" name="instructions" required minLength={2} maxLength={3000} />
      <label htmlFor="task-due">Fecha límite · hora de Ciudad de México</label><input id="task-due" name="dueAt" type="datetime-local" />
      <label htmlFor="task-attachments">Materiales para la actividad · PDF, imagen o audio (hasta {SCHOOL_UPLOAD_LIMIT_LABEL} por archivo)</label><input id="task-attachments" name="attachments" type="file" disabled={!uploadsReady} multiple accept="application/pdf,image/jpeg,image/png,image/webp,audio/mpeg,audio/ogg,audio/wav" />
      <button disabled={busy}>{busy ? "Publicando…" : "Publicar tarea"}</button>
    </form> : <p>Primero registra o asigna un grupo.</p>}</section>}

    <section className="portal-panel"><h2>Actividades de tus grupos</h2>{loading ? <p role="status">Cargando tareas…</p> : !items.length ? <div className="empty-state"><p>{error ? "No pudimos cargar las tareas." : canCreate ? "Todavía no hay tareas. Publica la primera desde el formulario de arriba." : "Todavía no hay tareas para tus grupos. Cuando una maestra publique una, aparecerá aquí."}</p>{error && <button className="secondary-button" type="button" onClick={() => { setLoading(true); setError(""); refresh().catch(cause => setError(cause instanceof Error ? cause.message : "No se cargaron las tareas.")).finally(() => setLoading(false)); }}>Intentar de nuevo</button>}</div> : <ul className="record-list">{items.map(task => <li key={task.id}><div>
      <strong>{task.title}</strong><span>{task.groupName}{task.dueAt ? ` · Entrega: ${schoolDateTime(task.dueAt)}` : " · Sin fecha límite"}</span><p>{task.instructions}</p>
      {task.files.map(file => <p key={file.id}><a href={file.url}>{file.name} · Descargar material ↓</a></p>)}
      {canCreate && <form className="inline-upload" onSubmit={event => attach(task, event)}><input name="file" type="file" disabled={!uploadsReady} accept="application/pdf,image/jpeg,image/png,image/webp,audio/mpeg,audio/ogg,audio/wav" required aria-label={`Adjuntar material a ${task.title} · hasta ${SCHOOL_UPLOAD_LIMIT_LABEL}`} /><button disabled={busy || !uploadsReady}>Adjuntar material</button></form>}
      {familyChildren.length > 0 && Boolean(task.studentStatuses?.length) && <>
        {task.studentStatuses?.map(status => {
          const child = familyChildren.find(item => item.id === status.studentId);
          return child ? <span className="task-status" key={child.id}>{child.name}: {taskStatusLabels[status.status] ?? status.status}</span> : null;
        })}
        <form className="inline-upload" onSubmit={event => upload(task, event)}><select name="studentId" required aria-label="Alumno">{familyChildren.filter(child => task.studentStatuses?.some(status => status.studentId === child.id)).map(child => <option key={child.id} value={child.id}>{child.name} {child.familyName}</option>)}</select><input name="file" type="file" disabled={!uploadsReady} accept="application/pdf,image/jpeg,image/png,image/webp" required aria-label={`Archivo de evidencia · hasta ${SCHOOL_UPLOAD_LIMIT_LABEL}`} /><button disabled={busy || !uploadsReady}>Enviar evidencia</button></form>
      </>}
    </div><button className="secondary-button" onClick={() => loadSubs(task)}>{canReview ? "Revisar entregas" : "Ver mi entrega"}</button></li>)}</ul>}</section>

    {selected && <section className="portal-panel"><div className="panel-heading"><h2>Entregas · {selected.title}</h2><button className="secondary-button" onClick={() => setSelected(null)}>Cerrar</button></div>
      {submissions.length ? <ul className="record-list">{submissions.map(submission => <li key={submission.id}><div>
        <strong>{submission.studentName} {submission.studentFamilyName} · {submission.status}</strong>
        {submission.note && <span>Nota de la familia: {submission.note}</span>}
        {submission.evaluation && <p><strong>Evaluación formativa:</strong> {evaluationLabels[submission.evaluation]}</p>}
        {submission.reviewNote && <p>Retroalimentación: {submission.reviewNote}</p>}
        {submission.files.map(file => <a key={file.id} href={file.url}>{file.name} ↓</a>)}
        {canReview && <form className="school-form evaluation-form" onSubmit={event => review(submission, event)}>
          <label htmlFor={`review-note-${submission.id}`}>Observación para la familia</label><textarea id={`review-note-${submission.id}`} name="reviewNote" maxLength={1000} defaultValue={submission.reviewNote ?? ""} />
          {canEvaluate ? <><label htmlFor={`evaluation-${submission.id}`}>Evaluación formativa · sin calificación numérica</label><select id={`evaluation-${submission.id}`} name="evaluation" defaultValue={submission.evaluation ?? ""}><option value="">Sin evaluación</option><option value="logrado">Logrado</option><option value="en_proceso">En proceso</option><option value="con_acompanamiento">Con acompañamiento</option></select></> : <p className="form-hint">En lactantes y maternal se usan observaciones cualitativas, sin calificaciones académicas.</p>}
          <label htmlFor={`status-${submission.id}`}>Estado de la entrega</label><select id={`status-${submission.id}`} name="status" defaultValue={submission.status === "completada" ? "completada" : "revisada"}><option value="revisada">Revisada</option><option value="completada">Completada</option></select>
          <button disabled={busy}>{busy ? "Guardando…" : "Guardar retroalimentación"}</button>
        </form>}
      </div></li>)}</ul> : <p>No hay entregas registradas aún.</p>}
    </section>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="form-success" role="status">{notice}</p>}
  </>;
}
