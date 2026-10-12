"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";

type Year = { id: string; name: string; startsOn: string; endsOn: string; active: boolean };
type Group = { id: string; yearId: string; name: string; stage: "lactantes" | "maternal" | "prekinder" | "preescolar"; active: boolean };
type Teacher = { id: string; name: string; email: string };
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const isGroup = (value: Group) => value && uuid(value.id) && uuid(value.yearId) && typeof value.name === "string" && ["lactantes", "maternal", "prekinder", "preescolar"].includes(value.stage) && typeof value.active === "boolean";

export function GroupManager({ initialYears, initialGroups, initialTotal, selectableGroups, teachers }: { initialYears: Year[]; initialGroups: Group[]; initialTotal: number; selectableGroups: { id: string; name: string }[]; teachers: Teacher[] }) {
  const [years, setYears] = useState(initialYears);
  const [groups, setGroups] = useState(initialGroups);
  const [groupOptions, setGroupOptions] = useState(selectableGroups);
  const [groupTotal, setGroupTotal] = useState(initialTotal);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState("");
  const [groupSearch, setGroupSearch] = useState("");
  const [yearFilter, setYearFilter] = useState("todos");
  const [stageFilter, setStageFilter] = useState("todas");
  const [groupStatusFilter, setGroupStatusFilter] = useState("activos");
  const [groupPage, setGroupPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState(true);
  const [needsRead, setNeedsRead] = useState(false);
  const [reload, setReload] = useState(0);
  const alive = useRef(true), access = useRef(true), writing = useRef(false), reviewNeeded = useRef(false);
  const listRequest = useRef<AbortController | null>(null), writeRequest = useRef<AbortController | null>(null);
  const currentList = useRef("");
  const [loadedList, setLoadedList] = useState("");
  const pageSize = 10;

  const listUrl = useCallback((targetPage = groupPage) => {
    const params = new URLSearchParams({ page: String(targetPage), pageSize: String(pageSize), status: groupStatusFilter });
    if (groupSearch.trim()) params.set("q", groupSearch.trim());
    if (yearFilter !== "todos") params.set("yearId", yearFilter);
    if (stageFilter !== "todas") params.set("stage", stageFilter);
    return `/api/groups?${params}`;
  }, [groupPage, pageSize, groupStatusFilter, groupSearch, yearFilter, stageFilter]);

  const listKey = listUrl();
  useLayoutEffect(() => { currentList.current = listKey; });
  useEffect(() => { alive.current = true; return () => { alive.current = false; listRequest.current?.abort(); writeRequest.current?.abort(); }; }, []);
  const revoke = useCallback(() => {
    access.current = false; listRequest.current?.abort(); writeRequest.current?.abort();
    setHasAccess(false); setYears([]); setGroups([]); setGroupOptions([]); setSelectedGroup(""); setMessage(""); setError(""); setBusy(false); setLoading(false);
  }, []);
  const requireRead = useCallback(() => { reviewNeeded.current = true; setNeedsRead(true); }, []);
  async function checked(url: string, options: RequestInit, controller: AbortController) {
    const response = await fetch(url, { ...options, credentials: "same-origin", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
    if (!alive.current || !access.current || controller.signal.aborted) return null;
    if (response.status === 401 || response.status === 403) { revoke(); return null; }
    return response;
  }
  const load = useCallback(async () => {
    if (!alive.current || !access.current) return false;
    listRequest.current?.abort(); const controller = new AbortController(); listRequest.current = controller;
    const key = listUrl();
    const current = () => alive.current && access.current && !controller.signal.aborted && listRequest.current === controller && currentList.current === key;
    setLoading(true); setError("");
    try {
      const response = await fetch(key, { cache: "no-store", credentials: "same-origin", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
      if (!current()) return false;
      if (response.status === 401 || response.status === 403) { revoke(); return false; }
      if (!response.ok) throw Error();
      const result = await response.json() as { items?: Group[]; total?: number; page?: number; pageSize?: number };
      if (!current()) return false;
      if (!Array.isArray(result.items) || !result.items.every(isGroup) || !Number.isSafeInteger(result.total) || Number(result.total) < result.items.length || result.page !== groupPage || result.pageSize !== pageSize) throw Error();
      setGroups(result.items); setGroupTotal(Number(result.total)); setLoadedList(key); return true;
    } catch { if (current()) { setError("No se pudo comprobar la lista de grupos. Consulta de nuevo antes de guardar."); requireRead(); } return false; }
    finally { if (current()) { listRequest.current = null; setLoading(false); } }
  }, [listUrl, groupPage, pageSize, revoke, requireRead]);
  useEffect(() => { let cancelled = false; queueMicrotask(() => { if (!cancelled) void load(); }); return () => { cancelled = true; listRequest.current?.abort(); }; }, [load, reload]);
  function changeFilter(change: () => void) {
    if (!access.current || writing.current) return;
    listRequest.current?.abort(); currentList.current = ""; setLoadedList(""); setLoading(true); setError(""); change(); setGroupPage(1); setReload(previous => previous + 1);
  }
  function begin() {
    if (!alive.current || !access.current || writing.current || reviewNeeded.current || listRequest.current || currentList.current !== listKey || loadedList !== listKey) return null;
    writing.current = true; const controller = new AbortController(); writeRequest.current = controller; setBusy(true); setError(""); setMessage(""); return controller;
  }
  function currentWrite(controller: AbortController) { return alive.current && access.current && !controller.signal.aborted && writeRequest.current === controller; }
  function finish(controller: AbortController) { writing.current = false; if (currentWrite(controller)) { writeRequest.current = null; setBusy(false); } }
  async function receipt(url: string, fields: Record<string, unknown>, controller: AbortController, valid: (data: Record<string, unknown>) => boolean) {
    const response = await checked(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields) }, controller);
    if (!response) return null;
    const data = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!currentWrite(controller)) return null;
    if (response.status !== 201 || !data || !valid(data)) throw Error();
    return data;
  }
  async function refreshYears(controller: AbortController) {
    const response = await checked("/api/years", { cache: "no-store" }, controller); if (!response) return false;
    const data = await response.json() as { items?: Year[] }; if (!currentWrite(controller)) return false;
    if (!response.ok || !Array.isArray(data.items) || !data.items.every(year => year && uuid(year.id) && typeof year.name === "string" && typeof year.startsOn === "string" && typeof year.endsOn === "string" && typeof year.active === "boolean")) throw Error();
    setYears(data.items); return true;
  }
  async function refreshOptions(controller: AbortController, selected?: { id: string; name: string }) {
    const response = await checked("/api/groups?page=1&pageSize=50&status=activos", { cache: "no-store" }, controller); if (!response) return false;
    const data = await response.json() as { items?: Group[] }; if (!currentWrite(controller)) return false;
    if (!response.ok || !Array.isArray(data.items) || !data.items.every(isGroup)) throw Error();
    const options = data.items.map(({ id, name }) => ({ id, name }));
    setGroupOptions(selected ? [selected, ...options.filter(group => group.id !== selected.id)].slice(0, 50) : options);
    if (!selected) setSelectedGroup(previous => options.some(group => group.id === previous) ? previous : options[0]?.id ?? "");
    return true;
  }
  async function recheck() {
    if (!alive.current || !access.current || writing.current) return;
    const controller = new AbortController(); writing.current = true; writeRequest.current = controller; setBusy(true);
    const key = currentList.current;
    try {
      const results = await Promise.all([load(), refreshYears(controller), refreshOptions(controller)]);
      if (currentWrite(controller) && currentList.current === key && results.every(Boolean)) { reviewNeeded.current = false; setNeedsRead(false); setError(""); }
    } catch { if (currentWrite(controller)) { requireRead(); setError("No se pudieron comprobar los ciclos y grupos. Consulta de nuevo."); } }
    finally { finish(controller); }
  }

  async function createYear(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const controller = begin(); if (!controller) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    try {
      const body = await receipt("/api/years", Object.fromEntries(fields), controller, data => uuid(data.id)); if (!body) return;
      setYears(previous => [...previous.map(year => ({ ...year, active: false })), { id: String(body.id), name: String(fields.get("name") ?? "").trim(), startsOn: String(fields.get("startsOn")), endsOn: String(fields.get("endsOn")), active: true }]);
      setMessage("Ciclo creado correctamente."); form.reset();
      try { await refreshYears(controller); } catch { if (currentWrite(controller)) { requireRead(); setError("El ciclo se guardó; no se pudo actualizar la lista. Consulta el estado antes de guardar otro."); } }
    } catch { if (currentWrite(controller)) { requireRead(); setError("No se pudo confirmar el ciclo. Consulta el estado antes de volver a enviarlo."); } }
    finally { finish(controller); }
  }

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const controller = begin(); if (!controller) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    try {
      const body = await receipt("/api/groups", Object.fromEntries(fields), controller, data => uuid(data.id)); if (!body) return;
      const groupName = String(fields.get("name") ?? "").trim();
      const createdGroup = { id: String(body.id), name: groupName };
      setSelectedGroup(createdGroup.id); setGroupOptions(previous => [createdGroup, ...previous.filter(group => group.id !== createdGroup.id)].slice(0, 50));
      setMessage("Grupo creado correctamente."); form.reset();
      listRequest.current?.abort(); currentList.current = ""; setLoadedList(""); setLoading(true);
      setYearFilter("todos"); setStageFilter("todas"); setGroupStatusFilter("activos"); setGroupSearch(groupName); setGroupPage(1);
      setReload(previous => previous + 1);
      try { await refreshOptions(controller, createdGroup); } catch { if (currentWrite(controller)) { requireRead(); setError("El grupo se guardó; no se pudo actualizar la lista. Consulta el estado antes de guardar otro."); } }
    } catch { if (currentWrite(controller)) { requireRead(); setError("No se pudo confirmar el grupo. Consulta el estado antes de volver a enviarlo."); } }
    finally { finish(controller); }
  }

  async function assignTeacher(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const controller = begin(); if (!controller) return;
    const fields = new FormData(event.currentTarget);
    const groupId = String(fields.get("groupId") ?? "");
    try {
      if (!groupOptions.some(group => group.id === groupId) || !teachers.some(teacher => teacher.id === fields.get("teacherId"))) throw Error();
      const body = await receipt(`/api/groups/${encodeURIComponent(groupId)}/teachers`, { teacherId: fields.get("teacherId") }, controller, data => data.assigned === true); if (!body) return;
      setMessage("Maestra asignada al grupo.");
    } catch { if (currentWrite(controller)) { requireRead(); setError("No se pudo confirmar la asignación. Consulta el estado antes de volver a enviarla."); } }
    finally { finish(controller); }
  }

  const groupPageCount = Math.max(1, Math.ceil(groupTotal / pageSize));
  const currentGroupPage = Math.min(groupPage, groupPageCount);
  const controlsDisabled = busy || loading || needsRead;
  const visibleGroups = loadedList === listKey ? groups : [];
  if (!hasAccess) return <section className="portal-panel"><h2>Acceso a grupos no disponible</h2><p role="alert">Tu sesión o tus permisos cambiaron. Vuelve a ingresar para revisar el acceso.</p><a href="/ingresar">Volver a ingresar</a></section>;

  return <>
    <div className="management-grid">
      <section className="portal-panel"><h2>Nuevo ciclo escolar</h2><form className="school-form" onSubmit={createYear}>
        <label htmlFor="year-name">Nombre del ciclo</label><input id="year-name" name="name" placeholder="2026–2027" required maxLength={40} disabled={controlsDisabled} />
        <label htmlFor="starts-on">Inicia</label><input id="starts-on" name="startsOn" type="date" required disabled={controlsDisabled} />
        <label htmlFor="ends-on">Termina</label><input id="ends-on" name="endsOn" type="date" required disabled={controlsDisabled} />
        <button disabled={controlsDisabled}>Guardar ciclo</button>
      </form></section>
      <section className="portal-panel"><h2>Nuevo grupo</h2>{years.length ? <form className="school-form" onSubmit={createGroup}>
        <label htmlFor="group-year">Ciclo</label><select id="group-year" name="yearId" required disabled={controlsDisabled}>{years.map(year => <option key={year.id} value={year.id}>{year.name}</option>)}</select>
        <label htmlFor="group-name">Nombre del grupo</label><input id="group-name" name="name" placeholder="Maternal A" required maxLength={60} disabled={controlsDisabled} />
        <label htmlFor="stage">Etapa</label><select id="stage" name="stage" disabled={controlsDisabled}><option value="lactantes">Lactantes</option><option value="maternal">Maternal</option><option value="prekinder">Prekínder</option><option value="preescolar">Preescolar</option></select>
        <button disabled={controlsDisabled}>Guardar grupo</button>
      </form> : <p>Primero crea un ciclo escolar.</p>}</section>
    </div>
    <section className="portal-panel"><h2>Asignar maestra</h2>{groupOptions.length > 0 && teachers.length > 0 ? <form className="school-form" onSubmit={assignTeacher}>
      <label htmlFor="assign-group">Grupo</label><select id="assign-group" name="groupId" value={selectedGroup || groupOptions[0].id} disabled={controlsDisabled} onChange={event => { if (!writing.current && access.current) setSelectedGroup(event.target.value); }}>{groupOptions.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select>
      <label htmlFor="assign-teacher">Maestra</label><select id="assign-teacher" name="teacherId" disabled={controlsDisabled}>{teachers.map(teacher => <option key={teacher.id} value={teacher.id}>{teacher.name} · {teacher.email}</option>)}</select>
      <button disabled={controlsDisabled}>Asignar al grupo</button>
    </form> : <p>Crea un grupo y una cuenta de docente antes de asignar.</p>}</section>
    {(error || needsRead) && <button type="button" className="secondary-button" disabled={busy || loading} onClick={() => void recheck()}>Consultar estado de nuevo</button>}
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success" role="status">{message}</p>}
    <section className="portal-panel"><h2>Grupos registrados</h2><div className="list-filters">
      <label htmlFor="group-search">Buscar grupo</label><input id="group-search" type="search" value={groupSearch} disabled={busy} onChange={event => changeFilter(() => setGroupSearch(event.target.value))} placeholder="Nombre del grupo" />
      <label htmlFor="group-year-filter">Ciclo escolar</label><select id="group-year-filter" value={yearFilter} disabled={busy} onChange={event => changeFilter(() => setYearFilter(event.target.value))}><option value="todos">Todos los ciclos</option>{years.map(year => <option key={year.id} value={year.id}>{year.name}</option>)}</select>
      <label htmlFor="group-stage-filter">Etapa</label><select id="group-stage-filter" value={stageFilter} disabled={busy} onChange={event => changeFilter(() => setStageFilter(event.target.value))}><option value="todas">Todas las etapas</option><option value="lactantes">Lactantes</option><option value="maternal">Maternal</option><option value="prekinder">Prekínder</option><option value="preescolar">Preescolar</option></select>
      <label htmlFor="group-status-filter">Estado</label><select id="group-status-filter" value={groupStatusFilter} disabled={busy} onChange={event => changeFilter(() => setGroupStatusFilter(event.target.value))}><option value="activos">Activos</option><option value="inactivos">Inactivos</option><option value="todos">Todos los estados</option></select>
    </div>
      {loading ? <p role="status">Comprobando grupos…</p> : loadedList !== listKey ? <p>No se pudo comprobar la lista de grupos.</p> : <>
        <p className="list-count" aria-live="polite">{groupTotal} {groupTotal === 1 ? "grupo" : "grupos"}</p>
        {visibleGroups.length ? <ul className="record-list">{visibleGroups.map(group => <li key={group.id}><strong>{group.name}</strong><span>{group.stage} · {years.find(year => year.id === group.yearId)?.name ?? "Ciclo"} · {group.active ? "Activo" : "Inactivo"}</span></li>)}</ul> : <p>{groupTotal ? "No hay grupos en esta página; consulta la anterior." : "No hay grupos que coincidan con esos filtros."}</p>}
        {groupTotal > pageSize && <nav className="pagination-controls" aria-label="Páginas de grupos">
          <button className="secondary-button" type="button" disabled={busy || groupPage <= 1} onClick={() => { if (!writing.current) { listRequest.current?.abort(); currentList.current = ""; setLoadedList(""); setLoading(true); setGroupPage(groupPage - 1); } }}>Anterior</button>
          <span>Página {currentGroupPage} de {groupPageCount}</span>
          <button className="secondary-button" type="button" disabled={busy || groupPage >= groupPageCount} onClick={() => { if (!writing.current) { listRequest.current?.abort(); currentList.current = ""; setLoadedList(""); setLoading(true); setGroupPage(groupPage + 1); } }}>Siguiente</button>
        </nav>}
      </>}
    </section>
  </>;
}
