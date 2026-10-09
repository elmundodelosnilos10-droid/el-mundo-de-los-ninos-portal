"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { createObservationController, EMPTY_OBSERVATION_STATE, type ObservationState } from "@/lib/observation-client";

type Student = { id: string; name: string; familyName: string; groupName: string };
const labels: Record<string, string> = { lenguaje: "Lenguaje", motricidad: "Motricidad", socioemocional: "Desarrollo socioemocional", participacion: "Participación", autonomia: "Autonomía", convivencia: "Convivencia", creatividad: "Creatividad", objetivo_aprendizaje: "Objetivo de aprendizaje" };

export function ProgressManager({ students, canWrite }: { students: Student[]; canWrite: boolean }) {
  const [state, setState] = useState<ObservationState>(EMPTY_OBSERVATION_STATE);
  const controller = useRef<ReturnType<typeof createObservationController> | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const client = createObservationController({ onChange: setState, onSaveConfirmed: () => formRef.current?.reset() });
    controller.current = client; client.selectStudent(students[0]?.id ?? "");
    return () => { client.dispose(); if (controller.current === client) controller.current = null; };
  }, [students]);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWrite || state.saving || state.accessDenied) return;
    const data = new FormData(event.currentTarget);
    void controller.current?.save({ category: String(data.get("category")), body: String(data.get("body")), visibleToFamily: data.get("visibleToFamily") === "on" });
  }
  const selectedStudent = students.find(student => student.id === state.studentId);
  const busyReading = state.loadingFirst || state.loadingMore;
  return <>
    <section className="portal-panel">
      {students.length ? <label htmlFor="progress-student">Alumno <select id="progress-student" value={state.studentId} disabled={state.saving} onChange={event => controller.current?.selectStudent(event.target.value)}>
        {!state.studentId && <option value="">Selecciona un alumno</option>}
        {students.map(student => <option key={student.id} value={student.id}>{student.name} {student.familyName} · {student.groupName}</option>)}
      </select></label> : <div className="empty-state"><p>{canWrite ? "No hay alumnos activos en tus grupos. Revisa las matrículas antes de registrar avances." : "Aún no hay alumnos vinculados a tu cuenta. Contacta a dirección para asociar a tu hijo o hija."}</p>{canWrite && <Link className="meet-link" href="/alumnos">Revisar alumnos y matrículas →</Link>}</div>}
      {canWrite && selectedStudent && <form key={state.studentId} ref={formRef} className="school-form event-form" onSubmit={save}>
        <fieldset disabled={state.saving || state.accessDenied} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: "contents" }}>
          <h2>Agregar observación</h2><label htmlFor="progress-category">Área de desarrollo</label><select id="progress-category" name="category">{Object.entries(labels).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select>
          <label htmlFor="progress-body">Observación o avance</label><textarea id="progress-body" name="body" required minLength={2} maxLength={2000} />
          <label className="check-label"><input name="visibleToFamily" type="checkbox" /> Visible para la familia</label>
          <button type="submit">{state.saving ? "Guardando…" : "Guardar observación"}</button>
        </fieldset>
      </form>}
    </section>
    {selectedStudent && <section className="portal-panel" aria-busy={busyReading}>
      <h2>Registro de avances</h2><p>De más recientes a anteriores.</p>
      <button type="button" className="secondary-button" disabled={state.saving || busyReading || state.accessDenied} onClick={() => void controller.current?.refresh()}>Actualizar avances</button>
      {state.loadingFirst && <p role="status">Cargando avances…</p>}
      {state.items.length ? <ul className="record-list">{state.items.map(item => <li key={item.id}><div><strong>{labels[item.category] || item.category}</strong><span>{new Date(item.recordedAt).toLocaleDateString("es-MX", { timeZone: "America/Mexico_City" })} · {item.visibleToFamily ? "Visible para la familia" : "Solo equipo escolar"}</span><p>{item.body}</p></div></li>)}</ul> : !state.loadingFirst && !state.readError && !state.accessDenied && <div className="empty-state"><p>{canWrite ? "Todavía no hay observaciones para este alumno. Registra el primer avance en el formulario." : "Todavía no hay observaciones compartidas con la familia."}</p></div>}
      {state.hasMore && <button type="button" className="secondary-button" disabled={state.saving || busyReading || state.accessDenied} onClick={() => void controller.current?.loadMore()}>{state.loadingMore ? "Cargando anteriores…" : "Cargar anteriores"}</button>}
      {state.readError && <div><p className="form-error" role="alert">{state.readError}</p>{state.failedRead && <button type="button" className="secondary-button" disabled={state.saving || busyReading} onClick={() => void controller.current?.retryRead()}>Reintentar consulta</button>}</div>}
    </section>}
    {state.saveError && <p className="form-error" role="alert">{state.saveError}</p>}
    {state.note && <p className="form-success" role="status">{state.note}</p>}
  </>;
}
