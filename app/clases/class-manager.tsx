"use client";

import { useEffect, useState, type FormEvent } from "react";
import { schoolDateTime, schoolLocalInputToISO } from "@/lib/datetime";

type Group = { id: string; name: string };
type Teacher = { id: string; name: string; email: string };
type Session = { id: string; groupId: string; groupName: string; teacherName: string; title: string; startsAt: string; endsAt: string | null; meetUrl: string | null };

export function ClassManager({ groups, teachers, canCreate }: { groups: Group[]; teachers: Teacher[]; canCreate: boolean }) {
  const [sessions, setSessions] = useState<Session[]>([]); const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [agendaError, setAgendaError] = useState(""); const [message, setMessage] = useState("");
  async function refresh() { const response = await fetch("/api/classes", { cache: "no-store" }); if (!response.ok) throw new Error("No se pudieron cargar las clases autorizadas."); setSessions(((await response.json()) as { items: Session[] }).items); setAgendaError(""); }
  async function retryAgenda() {
    setLoading(true); setAgendaError("");
    try { await refresh(); }
    catch (cause) { setAgendaError(cause instanceof Error ? cause.message : "No se pudieron cargar las clases autorizadas."); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    let cancelled = false;
    fetch("/api/classes", { cache: "no-store" })
      .then(async response => {
        const data = await response.json() as { items?: Session[] };
        if (!response.ok) throw new Error("No se pudieron cargar las clases autorizadas.");
        return data.items ?? [];
      })
      .then(items => { if (!cancelled) setSessions(items); })
      .catch(error => { if (!cancelled) setAgendaError(error instanceof Error ? error.message : "No se pudieron cargar las clases autorizadas."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage(""); const form = event.currentTarget; const formData = new FormData(form);
    try {
      const body = { groupId: String(formData.get("groupId")), teacherId: String(formData.get("teacherId") || "") || undefined, title: String(formData.get("title")), startsAt: schoolLocalInputToISO(String(formData.get("startsAt"))), endsAt: schoolLocalInputToISO(String(formData.get("endsAt"))), meetUrl: String(formData.get("meetUrl")) };
      const response = await fetch("/api/classes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "No se pudo programar la clase.");
      await refresh(); setMessage("La clase quedó publicada para el grupo."); form.reset();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Error de conexión."); }
    finally { setBusy(false); }
  }
  return <><section className="portal-panel"><h2>Próximas clases</h2>{loading ? <p role="status">Cargando agenda…</p> : agendaError ? <div className="empty-state"><p role="alert">No se pudo cargar la agenda de clases.</p><button className="secondary-button" type="button" onClick={retryAgenda}>Intentar de nuevo</button></div> : sessions.length ? <ul className="record-list">{sessions.map(item => <li key={item.id} className="class-session"><div><strong>{item.title}</strong><span>{schoolDateTime(item.startsAt)} · {item.groupName} · {item.teacherName}</span></div>{item.meetUrl && <a className="meet-link" href={item.meetUrl} target="_blank" rel="noopener noreferrer">Entrar a Meet ↗</a>}</li>)}</ul> : <p>No hay clases programadas para tus grupos.</p>}</section>{canCreate && <section className="portal-panel"><h2>Programar una clase</h2>{groups.length && teachers.length ? <form className="school-form event-form" onSubmit={submit}><label htmlFor="class-title">Nombre de la clase</label><input id="class-title" name="title" required maxLength={120} disabled={busy} /><label htmlFor="class-group">Grupo</label><select id="class-group" name="groupId" required disabled={busy}>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select>{teachers.length > 1 && <><label htmlFor="class-teacher">Maestra</label><select id="class-teacher" name="teacherId">{teachers.map(teacher => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}</select></>}<label htmlFor="class-start">Inicio · hora de Ciudad de México</label><input id="class-start" name="startsAt" type="datetime-local" required disabled={busy} /><label htmlFor="class-end">Término</label><input id="class-end" name="endsAt" type="datetime-local" required disabled={busy} /><label htmlFor="meet-url">Enlace de Google Meet</label><input id="meet-url" name="meetUrl" type="url" placeholder="https://meet.google.com/..." required disabled={busy} /><p className="auth-help">La escuela todavía no usa Workspace para Educación, por eso la maestra pega aquí el enlace que creó en Meet. Solo integrantes del grupo podrán verlo en el portal. Las grabaciones permanecen desactivadas.</p><button disabled={busy}>{busy ? "Guardando…" : "Publicar clase"}</button></form> : <p>Registra un grupo y asígnale una docente antes de programar clases.</p>}{error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success" role="status">{message}</p>}</section>}</>;
}
