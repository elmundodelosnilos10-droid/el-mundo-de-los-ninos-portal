"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type UserRow = { id: string; name: string; email: string; role: string; active: boolean };

export function AccountManager({ initialUsers, initialTotal, canCreateDirection, actorId, useSupabaseInvites }: { initialUsers: UserRow[]; initialTotal: number; canCreateDirection: boolean; actorId: string; useSupabaseInvites: boolean }) {
  const [users, setUsers] = useState(initialUsers);
  const [total, setTotal] = useState(initialTotal);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("todos");
  const [statusFilter, setStatusFilter] = useState("todas");
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const listUrl = useCallback((targetPage = page) => {
    const params = new URLSearchParams({ page: String(targetPage), pageSize: String(pageSize) });
    if (search.trim()) params.set("q", search.trim());
    if (roleFilter !== "todos") params.set("role", roleFilter);
    if (statusFilter !== "todas") params.set("status", statusFilter === "activas" ? "activas" : "desactivadas");
    return `/api/users?${params}`;
  }, [page, pageSize, search, roleFilter, statusFilter]);

  async function refresh() {
    const latest = await fetch(listUrl(), { cache: "no-store" });
    if (!latest.ok) throw new Error("No se pudo actualizar la lista de cuentas.");
    const result = await latest.json() as { items: UserRow[]; total: number };
    setUsers(result.items); setTotal(result.total);
    if (page > Math.max(1, Math.ceil(result.total / pageSize))) setPage(Math.max(1, Math.ceil(result.total / pageSize)));
  }

  useEffect(() => {
    const controller = new AbortController();
    fetch(listUrl(), { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("No se pudo cargar la lista de cuentas.");
      const result = await response.json() as { items: UserRow[]; total: number };
      setUsers(result.items); setTotal(result.total);
      if (page > Math.max(1, Math.ceil(result.total / pageSize))) setPage(Math.max(1, Math.ceil(result.total / pageSize)));
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Error de conexión."); });
    return () => controller.abort();
  }, [listUrl, page]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setMessage(""); setBusy(true);
    const form = event.currentTarget;
    try {
      const response = await fetch("/api/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      const result = await response.json() as { error?: string; invited?: boolean };
      if (!response.ok) throw new Error(result.error ?? "No se pudo crear la cuenta.");
      await refresh();
      setMessage(result.invited ? "Invitación enviada. La persona podrá crear su contraseña desde el correo." : "Cuenta creada. Comparte el acceso inicial de forma privada.");
      form.reset();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Error de conexión."); }
    finally { setBusy(false); }
  }

  async function edit(event: FormEvent<HTMLFormElement>, person: UserRow) {
    event.preventDefault(); setError(""); setMessage(""); setBusy(true);
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch(`/api/users/${person.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "No se pudo actualizar la cuenta.");
      await refresh(); setMessage("Datos actualizados. La persona deberá volver a iniciar sesión con el correo guardado.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Error de conexión."); }
    finally { setBusy(false); }
  }

  async function setRole(event: FormEvent<HTMLFormElement>, person: UserRow) {
    event.preventDefault();
    const role = String(new FormData(event.currentTarget).get("role"));
    if (!window.confirm(`¿Cambiar el acceso de ${person.name} a ${role}? El cambio se aplicará al acceder a la información escolar.`)) return;
    setError(""); setMessage(""); setBusy(true);
    try {
      const response = await fetch(`/api/users/${person.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "No se pudo cambiar el tipo de acceso.");
      await refresh(); setMessage("Tipo de acceso actualizado.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Error de conexión."); }
    finally { setBusy(false); }
  }

  async function setActive(person: UserRow) {
    const active = !person.active;
    if (!active && !window.confirm(`¿Desactivar la cuenta de ${person.name}? Ya no podrá consultar el portal; sus registros escolares se conservarán.`)) return;
    setError(""); setMessage(""); setBusy(true);
    try {
      const response = await fetch(`/api/users/${person.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "No se pudo cambiar el acceso.");
      await refresh(); setMessage(active ? "Cuenta reactivada." : "Cuenta desactivada. El acceso al portal está bloqueado.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Error de conexión."); }
    finally { setBusy(false); }
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pageCount);

  return <>
    <section className="portal-panel">
      <h2>Nueva cuenta</h2>
      <form className="school-form" onSubmit={submit}>
        <label htmlFor="account-name">Nombre</label><input id="account-name" name="name" required minLength={2} maxLength={100} disabled={busy} />
        <label htmlFor="account-email">Correo escolar o del tutor</label><input id="account-email" name="email" type="email" autoComplete="off" required disabled={busy} />
        <label htmlFor="account-role">Tipo de acceso</label><select id="account-role" name="role" disabled={busy}><option value="docente">Maestra / docente</option><option value="tutor">Madre, padre o tutor</option>{canCreateDirection && <option value="direccion">Dirección</option>}</select>
        {useSupabaseInvites ? <p className="form-hint">Enviaremos una invitación al correo. Cada persona crea su contraseña en privado.</p> : <><label htmlFor="account-password">Contraseña inicial (mínimo 12 caracteres)</label><input id="account-password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={busy} /></>}
        <button disabled={busy}>{busy ? "Guardando…" : useSupabaseInvites ? "Enviar invitación" : "Crear cuenta"}</button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success" role="status">{message}</p>}
    </section>
    <section className="portal-panel">
      <h2>Personas con acceso</h2>
      <div className="list-filters">
        <label htmlFor="account-search">Buscar por nombre o correo</label><input id="account-search" type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Nombre o correo" />
        <label htmlFor="account-role-filter">Tipo de acceso</label><select id="account-role-filter" value={roleFilter} onChange={event => { setRoleFilter(event.target.value); setPage(1); }}><option value="todos">Todos los tipos</option><option value="direccion">Dirección</option><option value="docente">Docentes</option><option value="tutor">Familias</option><option value="superadmin">Superadministración</option></select>
        <label htmlFor="account-status-filter">Estado</label><select id="account-status-filter" value={statusFilter} onChange={event => { setStatusFilter(event.target.value); setPage(1); }}><option value="todas">Todos los estados</option><option value="activas">Activas</option><option value="desactivadas">Desactivadas</option></select>
      </div>
      <p className="list-count" aria-live="polite">{total} {total === 1 ? "cuenta" : "cuentas"}</p>
      {users.length ? <ul className="record-list">{users.map(person => {
        const protectedAccount = person.id === actorId || person.role === "superadmin" || (person.role === "direccion" && !canCreateDirection);
        return <li key={`${person.id}-${person.role}`}><div><strong>{person.name} · {person.role}</strong><span>{person.email} · {person.active ? "Activa" : "Desactivada"}</span>
          {!protectedAccount && <details><summary>Administrar cuenta</summary><form className="school-form" onSubmit={event => edit(event, person)}><label htmlFor={`edit-name-${person.id}`}>Nombre</label><input id={`edit-name-${person.id}`} name="name" defaultValue={person.name} required minLength={2} maxLength={100} disabled={busy} />{useSupabaseInvites ? <><input type="hidden" name="email" value={person.email} /><p className="form-hint">Para cambiar el correo de acceso, contacta a la administración técnica. El correo también debe actualizarse en Supabase Auth.</p></> : <><label htmlFor={`edit-email-${person.id}`}>Correo</label><input id={`edit-email-${person.id}`} name="email" type="email" defaultValue={person.email} required disabled={busy} /> </>}<button disabled={busy}>Guardar cambios</button></form><form className="school-form" onSubmit={event => setRole(event, person)}><label htmlFor={`edit-role-${person.id}`}>Tipo de acceso</label><select id={`edit-role-${person.id}`} name="role" defaultValue={person.role} disabled={busy}><option value="docente">Docente</option><option value="tutor">Madre, padre o tutor</option>{canCreateDirection && <option value="direccion">Dirección</option>}</select><button className="secondary-button" disabled={busy}>Cambiar acceso</button><p className="form-hint">El cambio actualiza los permisos de acceso. Solo superadministración puede asignar dirección.</p></form><button className="secondary-button" type="button" disabled={busy} onClick={() => setActive(person)}>{person.active ? "Desactivar acceso" : "Reactivar acceso"}</button></details>}
        </div></li>;
      })}</ul> : <p>{total ? "No hay coincidencias con esos filtros." : "Todavía no hay cuentas."}</p>}
      {total > pageSize && <nav className="pagination-controls" aria-label="Páginas de cuentas"><button className="secondary-button" type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Anterior</button><span>Página {currentPage} de {pageCount}</span><button className="secondary-button" type="button" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Siguiente</button></nav>}
    </section>
  </>;
}
