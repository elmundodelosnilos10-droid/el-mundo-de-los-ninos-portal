"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";

type Student = { id: string; givenName: string; familyName: string; birthDate?: string | null; active: boolean; groupId?: string | null; groupName?: string | null };
type Group = { id: string; name: string };

export function StudentManager({ initialStudents, initialTotal, groups }: { initialStudents: Student[]; initialTotal: number; groups: Group[] }) {
  const [records, setRecords] = useState(initialStudents);
  const [total, setTotal] = useState(initialTotal);
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("todos");
  const [statusFilter, setStatusFilter] = useState("activos");
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const listUrl = useCallback((targetPage = page) => {
    const params = new URLSearchParams({ page: String(targetPage), pageSize: String(pageSize), status: statusFilter });
    if (search.trim()) params.set("q", search.trim());
    if (groupFilter !== "todos") params.set("groupId", groupFilter);
    return `/api/students?${params}`;
  }, [page, pageSize, statusFilter, search, groupFilter]);

  async function refresh() {
    const response = await fetch(listUrl(), { cache: "no-store" });
    if (!response.ok) throw new Error("No se pudo actualizar el listado.");
    const result = await response.json() as { items: Student[]; total: number };
    setRecords(result.items); setTotal(result.total);
    if (page > Math.max(1, Math.ceil(result.total / pageSize))) setPage(Math.max(1, Math.ceil(result.total / pageSize)));
  }

  useEffect(() => {
    const controller = new AbortController();
    fetch(listUrl(), { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("No se pudo cargar el listado.");
      const result = await response.json() as { items: Student[]; total: number };
      setRecords(result.items); setTotal(result.total);
      if (page > Math.max(1, Math.ceil(result.total / pageSize))) setPage(Math.max(1, Math.ceil(result.total / pageSize)));
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Error de conexión."); });
    return () => controller.abort();
  }, [listUrl, page]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setMessage(""); setBusy(true);
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    if (!body.birthDate) delete body.birthDate;
    try {
      const response = await fetch("/api/students", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "No se pudo registrar al alumno.");
      await refresh(); setMessage("Alumno registrado correctamente."); form.reset();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Error de conexión."); }
    finally { setBusy(false); }
  }

  async function update(event: FormEvent<HTMLFormElement>, student: Student) {
    event.preventDefault(); setError(""); setMessage(""); setBusy(true);
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    const body = { givenName: fields.givenName, familyName: fields.familyName, birthDate: String(fields.birthDate ?? "") || null };
    try {
      const response = await fetch(`/api/students/${student.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "No se pudieron guardar los cambios.");
      await refresh(); setMessage("Expediente actualizado y cambio registrado en auditoría.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Error de conexión."); }
    finally { setBusy(false); }
  }

  async function changeStatus(student: Student, active: boolean, groupId?: string) {
    if (!active && !window.confirm(`¿Dar de baja a ${student.givenName} ${student.familyName}? Se cerrará su inscripción activa; el expediente se conservará para dirección.`)) return;
    setError(""); setMessage(""); setBusy(true);
    try {
      const response = await fetch(`/api/students/${student.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active, ...(groupId ? { groupId } : {}) }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "No se pudo actualizar el estado del alumno.");
      await refresh(); setMessage(active ? "Alumno reactivado y asignado al grupo seleccionado." : "Baja lógica registrada; su expediente se conserva.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Error de conexión."); }
    finally { setBusy(false); }
  }

  async function reactivate(event: FormEvent<HTMLFormElement>, student: Student) {
    event.preventDefault();
    const groupId = String(new FormData(event.currentTarget).get("groupId") ?? "");
    if (!groupId) { setError("Selecciona el grupo para reactivar al alumno."); return; }
    await changeStatus(student, true, groupId);
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pageCount);

  return <>
    <section className="portal-panel"><h2>Registrar alumno</h2>{groups.length ? <form className="school-form" onSubmit={submit}><label htmlFor="given-name">Nombre</label><input id="given-name" name="givenName" required maxLength={100} disabled={busy} /><label htmlFor="family-name">Apellidos</label><input id="family-name" name="familyName" required maxLength={100} disabled={busy} /><label htmlFor="birth-date">Fecha de nacimiento (opcional)</label><input id="birth-date" name="birthDate" type="date" disabled={busy} /><label htmlFor="student-group">Grupo</label><select id="student-group" name="groupId" required disabled={busy}>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select><button disabled={busy}>{busy ? "Guardando…" : "Guardar alumno"}</button></form> : <p>Primero registra un grupo en la sección Grupos.</p>}</section>
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success" role="status">{message}</p>}
    <section className="portal-panel"><h2>Alumnos registrados</h2>
      <div className="list-filters"><label htmlFor="student-search">Buscar por nombre</label><input id="student-search" type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Escribe un nombre o apellido" /><label htmlFor="student-group-filter">Grupo</label><select id="student-group-filter" value={groupFilter} onChange={event => { setGroupFilter(event.target.value); setPage(1); }}><option value="todos">Todos los grupos</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select><label htmlFor="student-status-filter">Estado</label><select id="student-status-filter" value={statusFilter} onChange={event => { setStatusFilter(event.target.value); setPage(1); }}><option value="activos">Activos</option><option value="inactivos">Baja lógica</option><option value="todos">Todos los estados</option></select></div>
      <p className="list-count" aria-live="polite">{total} {total === 1 ? "alumno" : "alumnos"}</p>
      {records.length ? <ul className="record-list">{records.map(student => <li key={student.id}><div><strong>{student.givenName} {student.familyName}</strong><span>{student.active ? `Activo${student.groupName ? ` · ${student.groupName}` : " · Sin grupo activo"}` : "Baja lógica · expediente conservado"}</span><details><summary>Editar datos básicos</summary><form className="school-form" onSubmit={event => update(event, student)}><label htmlFor={`student-given-${student.id}`}>Nombre</label><input id={`student-given-${student.id}`} name="givenName" defaultValue={student.givenName} required maxLength={100} disabled={busy} /><label htmlFor={`student-family-${student.id}`}>Apellidos</label><input id={`student-family-${student.id}`} name="familyName" defaultValue={student.familyName} required maxLength={100} disabled={busy} /><label htmlFor={`student-birth-${student.id}`}>Fecha de nacimiento (opcional)</label><input id={`student-birth-${student.id}`} name="birthDate" type="date" defaultValue={student.birthDate ?? ""} disabled={busy} /><button disabled={busy}>{busy ? "Guardando…" : "Guardar cambios"}</button></form></details>{student.active ? <button className="secondary-button" type="button" disabled={busy} onClick={() => changeStatus(student, false)}>Dar de baja</button> : <form className="school-form" onSubmit={event => reactivate(event, student)}><label htmlFor={`reactivate-group-${student.id}`}>Grupo para reactivar</label><select id={`reactivate-group-${student.id}`} name="groupId" required disabled={busy}>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select><button disabled={busy}>{busy ? "Guardando…" : "Reactivar alumno"}</button></form>}</div><Link href={`/alumnos/${student.id}`}>Abrir expediente →</Link></li>)}</ul> : <p>{total ? "No hay coincidencias con esos filtros." : "Todavía no hay alumnos registrados."}</p>}
      {total > pageSize && <nav className="pagination-controls" aria-label="Páginas de alumnos"><button className="secondary-button" type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Anterior</button><span>Página {currentPage} de {pageCount}</span><button className="secondary-button" type="button" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Siguiente</button></nav>}
    </section>
  </>;
}
