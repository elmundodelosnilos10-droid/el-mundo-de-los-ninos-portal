"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

type Student = { id: string; givenName: string; familyName: string; birthDate?: string | null; active: boolean; groupId?: string | null; groupName?: string | null };
type Group = { id: string; name: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uncertainWrite = "No se pudo confirmar el cambio. Puede haberse guardado. Consulta el listado antes de volver a enviarlo.";

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
  const [listError, setListError] = useState("");
  const [loadingList, setLoadingList] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const writePending = useRef(false);
  const denied = useRef(false);
  const mounted = useRef(true);
  const listRevision = useRef(0);

  const listUrl = useCallback((targetPage = page) => {
    const params = new URLSearchParams({ page: String(targetPage), pageSize: String(pageSize), status: statusFilter });
    if (search.trim()) params.set("q", search.trim());
    if (groupFilter !== "todos") params.set("groupId", groupFilter);
    return `/api/students?${params}`;
  }, [page, pageSize, statusFilter, search, groupFilter]);

  const loseAccess = useCallback(() => {
    denied.current = true;
    listRevision.current += 1;
    if (!mounted.current) return;
    setRecords([]); setTotal(0); setAccessDenied(true); setLoadingList(false);
    setError(""); setListError(""); setMessage(""); setUncertain(false);
  }, []);

  const readList = useCallback(async (url: string, signal?: AbortSignal) => {
    if (denied.current || !mounted.current || signal?.aborted) return false;
    const revision = ++listRevision.current;
    const current = () => mounted.current && !denied.current && !signal?.aborted && listRevision.current === revision;
    setLoadingList(true);
    try {
      const response = await fetch(url, { cache: "no-store", credentials: "same-origin", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) });
      if (!current()) return false;
      if (response.status === 401 || response.status === 403) { loseAccess(); return false; }
      if (!response.ok) throw Error();
      const result = await response.json() as { items?: Student[]; total?: number };
      if (!Array.isArray(result.items) || !Number.isSafeInteger(result.total) || result.total! < 0 || result.items.some(row => !row || typeof row.id !== "string" || typeof row.givenName !== "string" || typeof row.familyName !== "string" || typeof row.active !== "boolean")) throw Error();
      if (!current()) return false;
      setRecords(result.items); setTotal(result.total!); setListError("");
      const requestedPage = Number(new URL(url, "http://local.invalid").searchParams.get("page"));
      const lastPage = Math.max(1, Math.ceil(result.total! / pageSize));
      if (requestedPage > lastPage) setPage(lastPage);
      return true;
    } catch {
      if (current()) setListError("No se pudo actualizar el listado. Puedes consultarlo otra vez; los registros mostrados se conservan.");
      return false;
    } finally { if (current()) setLoadingList(false); }
  }, [loseAccess]);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; listRevision.current += 1; }; }, []);

  useEffect(() => {
    const controller = new AbortController();
    const url = listUrl();
    void Promise.resolve().then(() => readList(url, controller.signal));
    return () => controller.abort();
  }, [listUrl, readList]);

  function startWrite() {
    if (writePending.current || denied.current || !mounted.current) return false;
    writePending.current = true;
    setError(""); setMessage(""); setBusy(true); setUncertain(false);
    return true;
  }

  function endWrite() { writePending.current = false; if (mounted.current) setBusy(false); }

  async function refresh() {
    const loaded = await readList(listUrl());
    if (loaded && mounted.current && !denied.current) setUncertain(false);
  }

  function unconfirmed() { if (mounted.current && !denied.current) { setError(uncertainWrite); setUncertain(true); } }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!startWrite()) return;
    const form = event.currentTarget;
    try {
      const body = Object.fromEntries(new FormData(form));
      if (!body.birthDate) delete body.birthDate;
      const response = await fetch("/api/students", { method: "POST", credentials: "same-origin", signal: AbortSignal.timeout(20000), headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!mounted.current || denied.current) return;
      if (response.status === 401 || response.status === 403) { loseAccess(); return; }
      const result = await response.json().catch(() => null) as { error?: string; id?: string } | null;
      if (!mounted.current || denied.current) return;
      if (response.status !== 201 || typeof result?.id !== "string" || !uuid.test(result.id)) {
        if ([400, 404, 409].includes(response.status)) setError(typeof result?.error === "string" ? result.error : "Revisa los datos del alumno y el grupo.");
        else unconfirmed();
        return;
      }
      setMessage("Alumno registrado correctamente."); form.reset();
      await refresh();
    } catch { unconfirmed(); }
    finally { endWrite(); }
  }

  async function update(event: FormEvent<HTMLFormElement>, student: Student) {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    const body = { givenName: fields.givenName, familyName: fields.familyName, birthDate: String(fields.birthDate ?? "") || null };
    await patch(student.id, body, "Expediente actualizado y cambio registrado en auditoría.");
  }

  async function changeStatus(student: Student, active: boolean, groupId?: string) {
    if (writePending.current || denied.current) return;
    if (!active && !window.confirm(`¿Dar de baja a ${student.givenName} ${student.familyName}? Se cerrará su inscripción activa; el expediente se conservará para dirección.`)) return;
    await patch(student.id, { active, ...(groupId ? { groupId } : {}) }, active ? "Alumno reactivado y asignado al grupo seleccionado." : "Baja lógica registrada; su expediente se conserva.");
  }

  async function patch(studentId: string, body: Record<string, unknown>, success: string) {
    if (!startWrite()) return;
    try {
      const response = await fetch(`/api/students/${studentId}`, { method: "PATCH", credentials: "same-origin", signal: AbortSignal.timeout(20000), headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!mounted.current || denied.current) return;
      if (response.status === 401 || response.status === 403) { loseAccess(); return; }
      const result = await response.json().catch(() => null) as { error?: string; updated?: boolean } | null;
      if (!mounted.current || denied.current) return;
      if (response.status !== 200 || result?.updated !== true) {
        if ([400, 404, 409].includes(response.status)) setError(typeof result?.error === "string" ? result.error : "Revisa el alumno y su grupo.");
        else unconfirmed();
        return;
      }
      setMessage(success); await refresh();
    } catch { unconfirmed(); }
    finally { endWrite(); }
  }

  async function reactivate(event: FormEvent<HTMLFormElement>, student: Student) {
    event.preventDefault();
    const groupId = String(new FormData(event.currentTarget).get("groupId") ?? "");
    if (!groupId) { setError("Selecciona el grupo para reactivar al alumno."); return; }
    await changeStatus(student, true, groupId);
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pageCount);
  const blocked = busy || accessDenied;

  return <>
    <section className="portal-panel"><h2>Registrar alumno</h2>{groups.length ? <form className="school-form" onSubmit={submit}><label htmlFor="given-name">Nombre</label><input id="given-name" name="givenName" required maxLength={100} disabled={blocked} /><label htmlFor="family-name">Apellidos</label><input id="family-name" name="familyName" required maxLength={100} disabled={blocked} /><label htmlFor="birth-date">Fecha de nacimiento (opcional)</label><input id="birth-date" name="birthDate" type="date" disabled={blocked} /><label htmlFor="student-group">Grupo</label><select id="student-group" name="groupId" required disabled={blocked}>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select><button disabled={blocked}>{busy ? "Guardando…" : "Guardar alumno"}</button></form> : <p>Primero registra un grupo en la sección Grupos.</p>}</section>
    {accessDenied && <p className="form-error" role="alert">Tu sesión o tus permisos ya no permiten consultar este directorio. <Link href="/ingresar">Vuelve a iniciar sesión</Link> o solicita acceso a dirección.</p>}{error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success" role="status">{message}</p>}
    <section className="portal-panel"><h2>Alumnos registrados</h2>
      <div className="list-filters"><label htmlFor="student-search">Buscar por nombre</label><input id="student-search" type="search" disabled={blocked} value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Escribe un nombre o apellido" /><label htmlFor="student-group-filter">Grupo</label><select id="student-group-filter" disabled={blocked} value={groupFilter} onChange={event => { setGroupFilter(event.target.value); setPage(1); }}><option value="todos">Todos los grupos</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select><label htmlFor="student-status-filter">Estado</label><select id="student-status-filter" disabled={blocked} value={statusFilter} onChange={event => { setStatusFilter(event.target.value); setPage(1); }}><option value="activos">Activos</option><option value="inactivos">Baja lógica</option><option value="todos">Todos los estados</option></select></div>
      {listError && <p className="form-error" role="alert">{listError}</p>}
      {loadingList && <p role="status">Actualizando listado…</p>}
      {!accessDenied && <button className="secondary-button" type="button" disabled={busy || loadingList} onClick={() => { void refresh(); }}>{uncertain ? "Comprobar listado antes de reintentar" : "Actualizar listado"}</button>}
      <p className="list-count" aria-live="polite">{total} {total === 1 ? "alumno" : "alumnos"}</p>
      {records.length ? <ul className="record-list">{records.map(student => <li key={student.id}><div><strong>{student.givenName} {student.familyName}</strong><span>{student.active ? `Activo${student.groupName ? ` · ${student.groupName}` : " · Sin grupo activo"}` : "Baja lógica · expediente conservado"}</span><details><summary>Editar datos básicos</summary><form className="school-form" onSubmit={event => update(event, student)}><label htmlFor={`student-given-${student.id}`}>Nombre</label><input id={`student-given-${student.id}`} name="givenName" defaultValue={student.givenName} required maxLength={100} disabled={blocked} /><label htmlFor={`student-family-${student.id}`}>Apellidos</label><input id={`student-family-${student.id}`} name="familyName" defaultValue={student.familyName} required maxLength={100} disabled={blocked} /><label htmlFor={`student-birth-${student.id}`}>Fecha de nacimiento (opcional)</label><input id={`student-birth-${student.id}`} name="birthDate" type="date" defaultValue={student.birthDate ?? ""} disabled={blocked} /><button disabled={blocked}>{busy ? "Guardando…" : "Guardar cambios"}</button></form></details>{student.active ? <button className="secondary-button" type="button" disabled={blocked} onClick={() => changeStatus(student, false)}>Dar de baja</button> : <form className="school-form" onSubmit={event => reactivate(event, student)}><label htmlFor={`reactivate-group-${student.id}`}>Grupo para reactivar</label><select id={`reactivate-group-${student.id}`} name="groupId" required disabled={blocked}>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select><button disabled={blocked}>{busy ? "Guardando…" : "Reactivar alumno"}</button></form>}</div><Link href={`/alumnos/${student.id}`}>Abrir expediente →</Link></li>)}</ul> : !accessDenied && !listError && !loadingList ? <p>{total ? "No hay coincidencias con esos filtros." : "Todavía no hay alumnos registrados."}</p> : null}
      {total > pageSize && <nav className="pagination-controls" aria-label="Páginas de alumnos"><button className="secondary-button" type="button" disabled={blocked || loadingList || currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Anterior</button><span>Página {currentPage} de {pageCount}</span><button className="secondary-button" type="button" disabled={blocked || loadingList || currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Siguiente</button></nav>}
    </section>
  </>;
}
