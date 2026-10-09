"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";

type Student = { id: string; name: string; familyName: string; groupName: string };
type Observation = { id: string; category: string; body: string; visibleToFamily: boolean; recordedAt: string };
type ObservationResponse = { error?: string; items?: Observation[] };
type ActionResponse = { error?: string };
const labels: Record<string, string> = { lenguaje: "Lenguaje", motricidad: "Motricidad", socioemocional: "Desarrollo socioemocional", participacion: "Participación", autonomia: "Autonomía", convivencia: "Convivencia", creatividad: "Creatividad", objetivo_aprendizaje: "Objetivo de aprendizaje" };

export function ProgressManager({ students, canWrite }: { students: Student[]; canWrite: boolean }) {
  const [studentId, setStudent] = useState(students[0]?.id || "");
  const [items, setItems] = useState<Observation[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    if (!studentId) return;
    const response = await fetch(`/api/students/${studentId}/observations`, { cache: "no-store" });
    const data = await response.json() as ObservationResponse;
    if (!response.ok) throw Error(data.error || "No se cargó el seguimiento.");
    setItems(data.items ?? []);
  }

  useEffect(() => {
    if (!studentId) return;
    let cancelled = false;
    void fetch(`/api/students/${studentId}/observations`, { cache: "no-store" })
      .then(async response => ({ response, data: await response.json() as ObservationResponse }))
      .then(({ response, data }) => {
        if (!response.ok) throw Error(data.error || "No se cargó el seguimiento.");
        if (!cancelled) setItems(data.items ?? []);
      })
      .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : "No se cargó el seguimiento."); });
    return () => { cancelled = true; };
  }, [studentId]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError("");
    try {
      const response = await fetch(`/api/students/${studentId}/observations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category: data.get("category"), body: data.get("body"), visibleToFamily: data.get("visibleToFamily") === "on" }) });
      const result = await response.json() as ActionResponse;
      if (!response.ok) throw Error(result.error || "No se guardó la observación.");
      form.reset();
      setNotice("Observación guardada.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error de conexión.");
    }
  }

  return <><section className="portal-panel">{students.length ? <label htmlFor="progress-student">Alumno <select id="progress-student" value={studentId} onChange={event => setStudent(event.target.value)}>{students.map(student => <option key={student.id} value={student.id}>{student.name} {student.familyName} · {student.groupName}</option>)}</select></label> : <div className="empty-state"><p>{canWrite ? "No hay alumnos activos en tus grupos. Revisa las matrículas antes de registrar avances." : "Aún no hay alumnos vinculados a tu cuenta. Contacta a dirección para asociar a tu hijo o hija."}</p>{canWrite && <Link className="meet-link" href="/alumnos">Revisar alumnos y matrículas →</Link>}</div>}{canWrite && studentId && <form className="school-form event-form" onSubmit={save}><h2>Agregar observación</h2><label htmlFor="progress-category">Área de desarrollo</label><select id="progress-category" name="category">{Object.entries(labels).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select><label htmlFor="progress-body">Observación o avance</label><textarea id="progress-body" name="body" required minLength={2} maxLength={2000} /><label className="check-label"><input name="visibleToFamily" type="checkbox" /> Visible para la familia</label><button>Guardar observación</button></form>}</section>{studentId && <section className="portal-panel"><h2>Registro de avances</h2>{items.length ? <ul className="record-list">{items.map(item => <li key={item.id}><div><strong>{labels[item.category] || item.category}</strong><span>{new Date(item.recordedAt).toLocaleDateString("es-MX")} · {item.visibleToFamily ? "Visible para la familia" : "Solo equipo escolar"}</span><p>{item.body}</p></div></li>)}</ul> : <div className="empty-state"><p>{canWrite ? "Todavía no hay observaciones para este alumno. Registra el primer avance en el formulario." : "Todavía no hay observaciones compartidas con la familia."}</p></div>}</section>}{error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="form-success" role="status">{notice}</p>}</>;
}
