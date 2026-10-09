"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Year = { id: string; name: string; startsOn: string; endsOn: string; active: boolean };
type Group = { id: string; yearId: string; name: string; stage: "lactantes" | "maternal" | "prekinder" | "preescolar"; active: boolean };
type Teacher = { id: string; name: string; email: string };

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
  const pageSize = 10;

  const listUrl = useCallback((targetPage = groupPage) => {
    const params = new URLSearchParams({ page: String(targetPage), pageSize: String(pageSize), status: groupStatusFilter });
    if (groupSearch.trim()) params.set("q", groupSearch.trim());
    if (yearFilter !== "todos") params.set("yearId", yearFilter);
    if (stageFilter !== "todas") params.set("stage", stageFilter);
    return `/api/groups?${params}`;
  }, [groupPage, pageSize, groupStatusFilter, groupSearch, yearFilter, stageFilter]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(listUrl(), { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("No se pudo cargar la lista de grupos.");
      const result = await response.json() as { items: Group[]; total: number };
      setGroups(result.items); setGroupTotal(result.total);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Error de conexión."); });
    return () => controller.abort();
  }, [listUrl]);

  async function createYear(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setMessage(""); setBusy(true);
    const form = event.currentTarget;
    const fields = new FormData(form);
    try {
      const response = await fetch("/api/years", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(fields)) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "No se pudo guardar el ciclo.");
      const latest = await fetch("/api/years");
      if (!latest.ok) throw new Error("Se guardó, pero no se pudo actualizar la lista.");
      setYears(((await latest.json()) as { items: Year[] }).items);
      setMessage("Ciclo creado correctamente."); form.reset();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Error de conexión."); }
    finally { setBusy(false); }
  }

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setMessage(""); setBusy(true);
    const form = event.currentTarget;
    const fields = new FormData(form);
    try {
      const response = await fetch("/api/groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(fields)) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "No se pudo guardar el grupo.");
      const groupName = String(fields.get("name") ?? "");
      setYearFilter("todos"); setStageFilter("todas"); setGroupStatusFilter("activos"); setGroupSearch(groupName); setGroupPage(1);
      const newGroupResponse = await fetch(`/api/groups?page=1&pageSize=10&status=activos&q=${encodeURIComponent(groupName)}`, { cache: "no-store" });
      if (!newGroupResponse.ok) throw new Error("Se guardó, pero no se pudo actualizar la lista de grupos.");
      const newGroupResult = await newGroupResponse.json() as { items: Group[]; total: number };
      setGroups(newGroupResult.items); setGroupTotal(newGroupResult.total);
      const createdGroup = newGroupResult.items[0];
      if (createdGroup) {
        setSelectedGroup(createdGroup.id);
        setGroupOptions(current => [{ id: createdGroup.id, name: createdGroup.name }, ...current.filter(group => group.id !== createdGroup.id)].slice(0, 50));
      }
      const optionsResponse = await fetch("/api/groups?page=1&pageSize=50&status=activos", { cache: "no-store" });
      if (optionsResponse.ok) {
        const options = ((await optionsResponse.json()) as { items: Group[] }).items.map(({ id, name }) => ({ id, name }));
        setGroupOptions(createdGroup ? [{ id: createdGroup.id, name: createdGroup.name }, ...options.filter(group => group.id !== createdGroup.id)].slice(0, 50) : options);
      }
      setMessage("Grupo creado correctamente."); form.reset();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Error de conexión."); }
    finally { setBusy(false); }
  }

  async function assignTeacher(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setMessage(""); setBusy(true);
    const fields = new FormData(event.currentTarget);
    const groupId = String(fields.get("groupId") ?? "");
    try {
      const response = await fetch(`/api/groups/${groupId}/teachers`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teacherId: fields.get("teacherId") }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "No se pudo asignar la maestra.");
      setMessage("Maestra asignada al grupo.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Error de conexión."); }
    finally { setBusy(false); }
  }

  const groupPageCount = Math.max(1, Math.ceil(groupTotal / pageSize));
  const currentGroupPage = Math.min(groupPage, groupPageCount);

  return <><div className="management-grid"><section className="portal-panel"><h2>Nuevo ciclo escolar</h2><form className="school-form" onSubmit={createYear}><label htmlFor="year-name">Nombre del ciclo</label><input id="year-name" name="name" placeholder="2026–2027" required maxLength={40} disabled={busy} /><label htmlFor="starts-on">Inicia</label><input id="starts-on" name="startsOn" type="date" required disabled={busy} /><label htmlFor="ends-on">Termina</label><input id="ends-on" name="endsOn" type="date" required disabled={busy} /><button disabled={busy}>Guardar ciclo</button></form></section><section className="portal-panel"><h2>Nuevo grupo</h2>{years.length ? <form className="school-form" onSubmit={createGroup}><label htmlFor="group-year">Ciclo</label><select id="group-year" name="yearId" required disabled={busy}>{years.map(year => <option key={year.id} value={year.id}>{year.name}</option>)}</select><label htmlFor="group-name">Nombre del grupo</label><input id="group-name" name="name" placeholder="Maternal A" required maxLength={60} disabled={busy} /><label htmlFor="stage">Etapa</label><select id="stage" name="stage" disabled={busy}><option value="lactantes">Lactantes</option><option value="maternal">Maternal</option><option value="prekinder">Prekínder</option><option value="preescolar">Preescolar</option></select><button disabled={busy}>Guardar grupo</button></form> : <p>Primero crea un ciclo escolar.</p>}</section></div><section className="portal-panel"><h2>Asignar maestra</h2>{groupOptions.length && teachers.length ? <form className="school-form" onSubmit={assignTeacher}><label htmlFor="assign-group">Grupo</label><select id="assign-group" name="groupId" value={selectedGroup || groupOptions[0].id} onChange={e => setSelectedGroup(e.target.value)}>{groupOptions.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select><label htmlFor="assign-teacher">Maestra</label><select id="assign-teacher" name="teacherId">{teachers.map(teacher => <option key={teacher.id} value={teacher.id}>{teacher.name} · {teacher.email}</option>)}</select><button disabled={busy}>Asignar al grupo</button></form> : <p>Crea un grupo y una cuenta de docente antes de asignar.</p>}</section>{error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success" role="status">{message}</p>}<section className="portal-panel"><h2>Grupos registrados</h2><div className="list-filters"><label htmlFor="group-search">Buscar grupo</label><input id="group-search" type="search" value={groupSearch} onChange={event => { setGroupSearch(event.target.value); setGroupPage(1); }} placeholder="Nombre del grupo" /><label htmlFor="group-year-filter">Ciclo escolar</label><select id="group-year-filter" value={yearFilter} onChange={event => { setYearFilter(event.target.value); setGroupPage(1); }}><option value="todos">Todos los ciclos</option>{years.map(year => <option key={year.id} value={year.id}>{year.name}</option>)}</select><label htmlFor="group-stage-filter">Etapa</label><select id="group-stage-filter" value={stageFilter} onChange={event => { setStageFilter(event.target.value); setGroupPage(1); }}><option value="todas">Todas las etapas</option><option value="lactantes">Lactantes</option><option value="maternal">Maternal</option><option value="prekinder">Prekínder</option><option value="preescolar">Preescolar</option></select><label htmlFor="group-status-filter">Estado</label><select id="group-status-filter" value={groupStatusFilter} onChange={event => { setGroupStatusFilter(event.target.value); setGroupPage(1); }}><option value="activos">Activos</option><option value="inactivos">Inactivos</option><option value="todos">Todos los estados</option></select></div><p className="list-count" aria-live="polite">{groupTotal} {groupTotal === 1 ? "grupo" : "grupos"}</p>{groups.length ? <ul className="record-list">{groups.map(group => <li key={group.id}><strong>{group.name}</strong><span>{group.stage} · {years.find(year => year.id === group.yearId)?.name ?? "Ciclo"} · {group.active ? "Activo" : "Inactivo"}</span></li>)}</ul> : <p>{groupTotal ? "No hay grupos que coincidan con esos filtros." : "Todavía no hay grupos registrados."}</p>}{groupTotal > pageSize && <nav className="pagination-controls" aria-label="Páginas de grupos"><button className="secondary-button" type="button" disabled={currentGroupPage <= 1} onClick={() => setGroupPage(currentGroupPage - 1)}>Anterior</button><span>Página {currentGroupPage} de {groupPageCount}</span><button className="secondary-button" type="button" disabled={currentGroupPage >= groupPageCount} onClick={() => setGroupPage(currentGroupPage + 1)}>Siguiente</button></nav>}</section></>;
}
