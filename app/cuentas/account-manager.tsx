"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

type UserRow = { id: string; name: string; email: string; role: string; active: boolean };
type Receipt = { id?: string; updated?: boolean; invited?: boolean; error?: string };
const listUnavailable = "No se pudo actualizar la lista de cuentas. Conservamos la última lista disponible; puede estar desactualizada.";
const uncertainChange = "No se pudo confirmar el cambio. Actualiza la lista y revisa el estado de la cuenta antes de volver a intentarlo.";

function accountFeed(value: unknown): { items: UserRow[]; total: number } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as { items?: unknown; total?: unknown };
  if (!Array.isArray(result.items) || !Number.isSafeInteger(result.total) || (result.total as number) < 0 || result.items.length > 10) return null;
  if (!result.items.every(person => person && typeof person === "object" && typeof person.id === "string" && person.id.length > 0 &&
    typeof person.name === "string" && typeof person.email === "string" && typeof person.role === "string" && typeof person.active === "boolean")) return null;
  return result as { items: UserRow[]; total: number };
}

export function AccountManager({ initialUsers, initialTotal, canCreateDirection, actorId, useSupabaseInvites }: { initialUsers: UserRow[]; initialTotal: number; canCreateDirection: boolean; actorId: string; useSupabaseInvites: boolean }) {
  const [users, setUsers] = useState(initialUsers);
  const [total, setTotal] = useState(initialTotal);
  const [error, setError] = useState("");
  const [listError, setListError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState(true);
  const [reviewRequired, setReviewRequired] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("todos");
  const [statusFilter, setStatusFilter] = useState("todas");
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const alive = useRef(false);
  const access = useRef(true);
  const mutationLock = useRef(false);
  const reviewLock = useRef(false);
  const listVersion = useRef(0);
  const lifecycle = useRef(0);
  const listRequest = useRef<AbortController | null>(null);
  const writeRequest = useRef<AbortController | null>(null);
  const latestListUrl = useRef("");

  const requireReview = useCallback(() => { reviewLock.current = true; setReviewRequired(true); }, []);
  const cancelList = useCallback(() => {
    listVersion.current++; listRequest.current?.abort(); listRequest.current = null;
  }, []);
  const cancelAll = useCallback(() => {
    alive.current = false; lifecycle.current++;
    cancelList(); writeRequest.current?.abort(); writeRequest.current = null;
  }, [cancelList]);
  const revokeAccess = useCallback(() => {
    if (!alive.current) return;
    access.current = false;
    lifecycle.current++;
    listVersion.current++;
    listRequest.current?.abort(); listRequest.current = null;
    writeRequest.current?.abort(); writeRequest.current = null;
    setHasAccess(false); setUsers([]); setTotal(0); setSearch("");
    setError(""); setListError(""); setMessage(""); setBusy(false); setLoading(false);
  }, []);

  useEffect(() => {
    alive.current = true;
    return cancelAll;
  }, [cancelAll]);

  const listUrl = useCallback((targetPage = page) => {
    const params = new URLSearchParams({ page: String(targetPage), pageSize: String(pageSize) });
    if (search.trim()) params.set("q", search.trim());
    if (roleFilter !== "todos") params.set("role", roleFilter);
    if (statusFilter !== "todas") params.set("status", statusFilter === "activas" ? "activas" : "desactivadas");
    return `/api/users?${params}`;
  }, [page, search, roleFilter, statusFilter]);

  const refresh = useCallback(async (url: string) => {
    if (!alive.current || !access.current) return false;
    listRequest.current?.abort();
    const controller = new AbortController(); listRequest.current = controller;
    const version = ++listVersion.current;
    const current = () => alive.current && access.current && version === listVersion.current && !controller.signal.aborted;
    setLoading(true); setListError("");
    try {
      const response = await fetch(url, { method: "GET", credentials: "same-origin", cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
      if (!current()) return false;
      if (response.status === 401 || response.status === 403) { revokeAccess(); return false; }
      if (!response.ok) throw Error();
      const result = accountFeed(await response.json());
      if (!current()) return false;
      if (!result) throw Error();
      setUsers(result.items); setTotal(result.total);
      const targetPage = Number(new URLSearchParams(url.split("?")[1]).get("page"));
      const lastPage = Math.max(1, Math.ceil(result.total / pageSize));
      if (targetPage > lastPage) setPage(lastPage);
      reviewLock.current = false; setReviewRequired(false);
      return true;
    } catch {
      if (current()) { setListError(listUnavailable); requireReview(); }
      return false;
    } finally {
      if (current()) { listRequest.current = null; setLoading(false); }
    }
  }, [requireReview, revokeAccess]);

  useEffect(() => {
    latestListUrl.current = listUrl();
    void refresh(latestListUrl.current);
    return cancelList;
  }, [listUrl, refresh, cancelList]);

  function canMutate() {
    return alive.current && access.current && !mutationLock.current && !reviewLock.current && !listRequest.current;
  }

  async function change(path: string, method: "POST" | "PATCH", fields: () => Record<string, unknown>, confirmation: (result: Receipt) => boolean, success: (result: Receipt) => string) {
    if (!canMutate()) return;
    mutationLock.current = true;
    const generation = lifecycle.current;
    const controller = new AbortController(); writeRequest.current = controller;
    const current = () => alive.current && access.current && lifecycle.current === generation && !controller.signal.aborted;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(path, { method, credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields()), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
      if (!current()) return;
      if (response.status === 401 || response.status === 403) { revokeAccess(); return; }
      const result = await response.json().catch(() => null) as Receipt | null;
      if (!current()) return;
      if (!response.ok) {
        if (![400, 404, 409, 422].includes(response.status)) requireReview();
        setError(result && typeof result.error === "string" && result.error.length <= 1000 ? result.error : uncertainChange);
        return;
      }
      if (!result || typeof result !== "object" || Array.isArray(result) || (method === "POST" && response.status !== 201) || !confirmation(result)) {
        requireReview(); setError(uncertainChange); return;
      }
      // Receipt confirmation and form reset precede the independent list read.
      setMessage(success(result));
      requireReview();
      await refresh(latestListUrl.current);
    } catch {
      if (current()) { requireReview(); setError(uncertainChange); }
    } finally {
      mutationLock.current = false;
      if (current()) { writeRequest.current = null; setBusy(false); }
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    await change("/api/users", "POST", () => Object.fromEntries(new FormData(form)),
      result => typeof result.id === "string" && result.id.length > 0 && (result.invited === undefined || typeof result.invited === "boolean"),
      result => { form.reset(); return result.invited ? "Invitación creada. Revisa con la persona la recepción del correo para activar su acceso." : "Cuenta creada. Comparte el acceso inicial de forma privada."; });
  }

  function patchConfirmed(result: Receipt, person: UserRow) { return result.updated === true && (result.id === undefined || result.id === person.id); }
  async function edit(event: FormEvent<HTMLFormElement>, person: UserRow) {
    event.preventDefault(); const form = event.currentTarget;
    await change(`/api/users/${encodeURIComponent(person.id)}`, "PATCH", () => Object.fromEntries(new FormData(form)), result => patchConfirmed(result, person), () => "Datos de la cuenta actualizados.");
  }
  async function setRole(event: FormEvent<HTMLFormElement>, person: UserRow) {
    event.preventDefault(); if (!canMutate()) return;
    const role = String(new FormData(event.currentTarget).get("role"));
    if (!window.confirm(`¿Cambiar el acceso de ${person.name} a ${role}? El cambio se aplicará al acceder a la información escolar.`)) return;
    await change(`/api/users/${encodeURIComponent(person.id)}`, "PATCH", () => ({ role }), result => patchConfirmed(result, person), () => "Tipo de acceso actualizado. Los permisos se aplican en las siguientes solicitudes.");
  }
  async function setActive(person: UserRow) {
    if (!canMutate()) return;
    const active = !person.active;
    if (!active && !window.confirm(`¿Desactivar la cuenta de ${person.name}? Ya no podrá consultar el portal; sus registros escolares se conservarán.`)) return;
    await change(`/api/users/${encodeURIComponent(person.id)}`, "PATCH", () => ({ active }), result => patchConfirmed(result, person), () => active ? "Cuenta reactivada." : "Cuenta desactivada. El acceso escolar está bloqueado.");
  }

  if (!hasAccess) return <section className="portal-panel"><h2>Acceso a cuentas no disponible</h2><p role="alert">Tu sesión o tus permisos cambiaron. Vuelve a ingresar para revisar el acceso.</p><a href="/ingresar">Volver a ingresar</a></section>;
  const controlsDisabled = busy || loading || reviewRequired;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pageCount);

  return <>
    <section className="portal-panel">
      <h2>Nueva cuenta</h2>
      <form className="school-form" onSubmit={submit}>
        <label htmlFor="account-name">Nombre</label><input id="account-name" name="name" required minLength={2} maxLength={100} disabled={controlsDisabled} />
        <label htmlFor="account-email">Correo escolar o del tutor</label><input id="account-email" name="email" type="email" autoComplete="off" required disabled={controlsDisabled} />
        <label htmlFor="account-role">Tipo de acceso</label><select id="account-role" name="role" disabled={controlsDisabled}><option value="docente">Maestra / docente</option><option value="tutor">Madre, padre o tutor</option>{canCreateDirection && <option value="direccion">Dirección</option>}</select>
        {useSupabaseInvites ? <p className="form-hint">Enviaremos una invitación al correo. Cada persona crea su contraseña en privado.</p> : <><label htmlFor="account-password">Contraseña inicial (mínimo 12 caracteres)</label><input id="account-password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={controlsDisabled} /></>}
        <button disabled={controlsDisabled}>{busy ? "Guardando…" : useSupabaseInvites ? "Enviar invitación" : "Crear cuenta"}</button>
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
      {loading && <p role="status">Actualizando lista de cuentas…</p>}
      {listError && <p className="form-error" role="alert">{listError}</p>}
      {(listError || reviewRequired) && <button className="secondary-button" type="button" disabled={busy || loading} onClick={() => { void refresh(latestListUrl.current); }}>Actualizar lista</button>}
      <p className="list-count" aria-live="polite">{total} {total === 1 ? "cuenta" : "cuentas"}</p>
      {users.length ? <ul className="record-list">{users.map(person => {
        const protectedAccount = person.id === actorId || person.role === "superadmin" || (person.role === "direccion" && !canCreateDirection);
        return <li key={`${person.id}-${person.role}`}><div><strong>{person.name} · {person.role}</strong><span>{person.email} · {person.active ? "Activa" : "Desactivada"}</span>
          {!protectedAccount && <details><summary>Administrar cuenta</summary><form className="school-form" onSubmit={event => edit(event, person)}><label htmlFor={`edit-name-${person.id}`}>Nombre</label><input id={`edit-name-${person.id}`} name="name" defaultValue={person.name} required minLength={2} maxLength={100} disabled={controlsDisabled} />{useSupabaseInvites ? <><input type="hidden" name="email" value={person.email} /><p className="form-hint">Para cambiar el correo de acceso, contacta a la administración técnica. El correo también debe actualizarse en Supabase Auth.</p></> : <><label htmlFor={`edit-email-${person.id}`}>Correo</label><input id={`edit-email-${person.id}`} name="email" type="email" defaultValue={person.email} required disabled={controlsDisabled} /> </>}<button disabled={controlsDisabled}>Guardar cambios</button></form><form className="school-form" onSubmit={event => setRole(event, person)}><label htmlFor={`edit-role-${person.id}`}>Tipo de acceso</label><select id={`edit-role-${person.id}`} name="role" defaultValue={person.role} disabled={controlsDisabled}><option value="docente">Docente</option><option value="tutor">Madre, padre o tutor</option>{canCreateDirection && <option value="direccion">Dirección</option>}</select><button className="secondary-button" disabled={controlsDisabled}>Cambiar acceso</button><p className="form-hint">El cambio actualiza los permisos de acceso. Solo superadministración puede asignar dirección.</p></form><button className="secondary-button" type="button" disabled={controlsDisabled} onClick={() => setActive(person)}>{person.active ? "Desactivar acceso" : "Reactivar acceso"}</button></details>}
        </div></li>;
      })}</ul> : <p>{loading ? "Estamos comprobando las cuentas." : listError ? "No se pudo comprobar si hay cuentas para estos filtros." : "No hay coincidencias con esos filtros."}</p>}
      {total > pageSize && <nav className="pagination-controls" aria-label="Páginas de cuentas"><button className="secondary-button" type="button" disabled={busy || loading || currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Anterior</button><span>Página {currentPage} de {pageCount}</span><button className="secondary-button" type="button" disabled={busy || loading || currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Siguiente</button></nav>}
    </section>
  </>;
}
