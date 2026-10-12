"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { schoolDateKey } from "@/lib/datetime";

type Group = { id: string; name: string };
type Row = { studentId: string; givenName: string; familyName: string; status: string | null; note: string | null };
type HistoryStudent = { id: string; name: string; familyName: string; displayName: string; groupId: string | null };
type HistoryResult = { student: { id: string; name?: string }; period: { from: string; to: string }; counts: { presente: number; retardo: number; ausente: number; justificada: number }; total: number; attendancePercent: number | null; percentageRule: string; records: { date: string; groupName: string; status: string; note: string | null }[] };
type Justification = { id: string; studentId: string; studentName: string; studentFamilyName: string; groupName: string; onDate: string; reason: string; status: "pendiente" | "aceptada" | "rechazada"; createdAt: string };

export function AttendanceManager({ groups, historyStudents, canEdit, canReportAll }: { groups: Group[]; historyStudents: HistoryStudent[]; canEdit: boolean; canReportAll: boolean }) {
  const today = schoolDateKey(new Date());
  const [groupId, setGroup] = useState(groups[0]?.id || "");
  const [date, setDate] = useState(today);
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState<"csv" | "xlsx" | "pdf">("xlsx");
  const [reportGroupId, setReportGroupId] = useState(canReportAll ? "todos" : groups[0]?.id || "");
  const [historyStudentId, setHistoryStudentId] = useState((canEdit ? historyStudents.find(student => student.groupId === groups[0]?.id) : historyStudents[0])?.id || "");
  const [historyFrom, setHistoryFrom] = useState(`${today.slice(0, 7)}-01`);
  const [historyTo, setHistoryTo] = useState(today);
  const [history, setHistory] = useState<HistoryResult | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const historyOptions = canEdit ? historyStudents.filter(student => student.groupId === groupId) : historyStudents;
  const [justifications, setJustifications] = useState<Justification[]>([]);
  const [justificationError, setJustificationError] = useState("");
  const [justificationNotice, setJustificationNotice] = useState("");
  const [justificationBusy, setJustificationBusy] = useState(false);

  const [hasAccess, setHasAccess] = useState(true);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [justificationLoading, setJustificationLoading] = useState(true);
  const [rosterKey, setRosterKey] = useState("");
  const [justificationKey, setJustificationKey] = useState("");
  const [needsRead, setNeedsRead] = useState(false);
  const alive = useRef(true);
  const access = useRef(true);
  const mutation = useRef(false);
  const reviewNeeded = useRef(false);
  const rosterRequest = useRef<AbortController | null>(null);
  const justificationRequest = useRef<AbortController | null>(null);
  const historyRequest = useRef<AbortController | null>(null);
  const mutationRequest = useRef<AbortController | null>(null);
  const currentRoster = useRef("");
  const currentJustifications = useRef("");
  const currentHistory = useRef("");
  const loadedRoster = useRef("");
  const loadedJustifications = useRef<Justification[]>([]);
  const rosterContext = `${groupId}:${date}`;
  const justificationContext = canEdit ? rosterContext : historyStudentId;
  const historyContext = `${groupId}:${historyStudentId}:${historyFrom}:${historyTo}`;
  useLayoutEffect(() => { currentRoster.current = rosterContext; currentJustifications.current = justificationContext; currentHistory.current = historyContext; }, [rosterContext, justificationContext, historyContext]);
  const cancelRequests = useCallback(() => {
    for (const holder of [rosterRequest, justificationRequest, historyRequest, mutationRequest]) { holder.current?.abort(); holder.current = null; }
  }, []);
  useEffect(() => { alive.current = true; return () => { alive.current = false; cancelRequests(); }; }, [cancelRequests]);
  const revoke = useCallback(() => {
    access.current = false; cancelRequests(); loadedRoster.current = ""; loadedJustifications.current = [];
    setHasAccess(false); setRows([]); setHistory(null); setJustifications([]); setErr(""); setMsg(""); setJustificationError(""); setJustificationNotice("");
    setBusy(false); setJustificationBusy(false); setExporting(false); setHistoryBusy(false); setRosterLoading(false); setJustificationLoading(false);
  }, [cancelRequests]);
  const requireRead = useCallback(() => { reviewNeeded.current = true; setNeedsRead(true); }, []);
  async function fetchChecked(url: string, options: RequestInit, controller: AbortController) {
    const response = await fetch(url, { ...options, credentials: "same-origin", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
    if (!alive.current || !access.current || controller.signal.aborted) return null;
    if (response.status === 401 || response.status === 403) { revoke(); return null; }
    return response;
  }
  const load = useCallback(async () => {
    if (!alive.current || !access.current) return false;
    rosterRequest.current?.abort(); rosterRequest.current = null;
    if (!groupId) { setRows([]); loadedRoster.current = ""; setRosterLoading(false); return true; }
    const controller = new AbortController(); rosterRequest.current = controller;
    const key = `${groupId}:${date}`;
    const current = () => alive.current && access.current && !controller.signal.aborted && currentRoster.current === key && rosterRequest.current === controller;
    setRosterLoading(true); setErr("");
    try {
      const response = await fetch(`/api/attendance?groupId=${encodeURIComponent(groupId)}&date=${date}`, { cache: "no-store", credentials: "same-origin", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
      if (!current()) return false;
      if (response.status === 401 || response.status === 403) { revoke(); return false; }
      if (!response.ok) throw Error();
      const data = await response.json() as { items?: Row[] };
      if (!current()) return false;
      if (!Array.isArray(data.items) || !data.items.every(row => row && typeof row.studentId === "string" && typeof row.givenName === "string" && typeof row.familyName === "string" && (row.status === null || ["presente", "retardo", "ausente", "justificada"].includes(String(row.status))))) throw Error();
      setRows(data.items); loadedRoster.current = key; setRosterKey(key); return true;
    } catch { if (current()) { setErr("No se pudo comprobar la asistencia. Consulta de nuevo antes de guardar."); requireRead(); } return false; }
    finally { if (current()) { rosterRequest.current = null; setRosterLoading(false); } }
  }, [groupId, date, revoke, requireRead]);
  useEffect(() => { let cancelled = false; queueMicrotask(() => { if (!cancelled) void load(); }); return () => { cancelled = true; rosterRequest.current?.abort(); }; }, [load]);

  const refreshJustifications = useCallback(async () => {
    if (!alive.current || !access.current) return false;
    justificationRequest.current?.abort(); justificationRequest.current = null;
    if ((canEdit && !groupId) || (!canEdit && !historyStudentId)) { setJustifications([]); loadedJustifications.current = []; setJustificationLoading(false); return true; }
    const controller = new AbortController(); justificationRequest.current = controller;
    const key = canEdit ? `${groupId}:${date}` : historyStudentId;
    const current = () => alive.current && access.current && !controller.signal.aborted && currentJustifications.current === key && justificationRequest.current === controller;
    setJustificationLoading(true); setJustificationError("");
    const params = canEdit ? new URLSearchParams({ groupId, date }) : new URLSearchParams({ studentId: historyStudentId });
    try {
      const response = await fetch(`/api/attendance/justifications?${params}`, { cache: "no-store", credentials: "same-origin", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
      if (!current()) return false;
      if (response.status === 401 || response.status === 403) { revoke(); return false; }
      if (!response.ok) throw Error();
      const data = await response.json() as { items?: Justification[] };
      if (!current()) return false;
      if (!Array.isArray(data.items) || !data.items.every(item => item && typeof item.id === "string" && typeof item.reason === "string" && ["pendiente", "aceptada", "rechazada"].includes(item.status))) throw Error();
      loadedJustifications.current = data.items; setJustifications(data.items); setJustificationKey(key); return true;
    } catch { if (current()) { setJustificationError("No se pudieron comprobar las justificaciones. Consulta de nuevo."); requireRead(); } return false; }
    finally { if (current()) { justificationRequest.current = null; setJustificationLoading(false); } }
  }, [canEdit, groupId, date, historyStudentId, revoke, requireRead]);
  useEffect(() => { let cancelled = false; queueMicrotask(() => { if (!cancelled) void refreshJustifications(); }); return () => { cancelled = true; justificationRequest.current?.abort(); }; }, [refreshJustifications]);

  function invalidateViews() {
    rosterRequest.current?.abort(); justificationRequest.current?.abort(); historyRequest.current?.abort();
    currentRoster.current = ""; currentJustifications.current = ""; currentHistory.current = ""; loadedRoster.current = ""; loadedJustifications.current = [];
    setRows([]); setRosterKey(""); setJustifications([]); setJustificationKey(""); setHistory(null); setHistoryBusy(false); setMsg(""); setJustificationNotice("");
  }
  function chooseGroup(value: string) {
    if (mutation.current || !access.current || value === groupId) return;
    invalidateViews(); setGroup(value); setHistoryStudentId(historyStudents.find(student => student.groupId === value)?.id ?? "");
  }
  function chooseDate(value: string) { if (!mutation.current && access.current && value !== date) { invalidateViews(); setDate(value); } }
  function chooseStudent(value: string) {
    if (mutation.current || !access.current || value === historyStudentId) return;
    justificationRequest.current?.abort(); historyRequest.current?.abort(); currentJustifications.current = ""; currentHistory.current = "";
    loadedJustifications.current = []; setJustifications([]); setJustificationKey(""); setHistory(null); setHistoryBusy(false); setJustificationNotice(""); setHistoryStudentId(value);
  }
  function chooseHistoryRange(value: string, end: boolean) {
    if (mutation.current || !access.current) return;
    historyRequest.current?.abort(); currentHistory.current = ""; setHistory(null); setHistoryBusy(false);
    if (end) setHistoryTo(value); else setHistoryFrom(value);
  }
  function setStatus(studentId: string, status: string) {
    if (!canEdit || mutation.current || loadedRoster.current !== rosterContext || currentRoster.current !== rosterContext) return;
    setRows(old => old.map(row => row.studentId === studentId ? { ...row, status, note: status === "justificada" ? row.note : null } : row));
  }
  function setNote(studentId: string, note: string) {
    if (!canEdit || mutation.current || loadedRoster.current !== rosterContext || currentRoster.current !== rosterContext) return;
    setRows(old => old.map(row => row.studentId === studentId ? { ...row, note } : row));
  }
  function beginMutation() {
    if (!alive.current || !access.current || mutation.current || reviewNeeded.current || rosterRequest.current || justificationRequest.current) return null;
    mutation.current = true; const controller = new AbortController(); mutationRequest.current = controller;
    return { controller, current: () => alive.current && access.current && !controller.signal.aborted };
  }
  type Operation = NonNullable<ReturnType<typeof beginMutation>>;
  async function mutate(operation: Operation, url: string, method: "POST" | "PATCH", fields: Record<string, unknown>, valid: (data: Record<string, unknown>) => boolean, expectedStatus = 200) {
    const response = await fetchChecked(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields) }, operation.controller);
    if (!response) return false;
    const data = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!operation.current()) return false;
    if (!response.ok || response.status !== expectedStatus || !data || typeof data !== "object" || !valid(data)) { requireRead(); throw Error(); }
    return true;
  }
  function finish(operation: Operation) { mutation.current = false; if (operation.current()) { mutationRequest.current = null; setBusy(false); setJustificationBusy(false); setExporting(false); } }
  async function recheck() {
    if (mutation.current || !alive.current || !access.current) return;
    const roster = currentRoster.current, justification = currentJustifications.current;
    const rosterOk = await load(); const justificationOk = await refreshJustifications();
    if (rosterOk && justificationOk && alive.current && access.current && currentRoster.current === roster && currentJustifications.current === justification) { reviewNeeded.current = false; setNeedsRead(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!canEdit || !rows.length || loadedRoster.current !== rosterContext || currentRoster.current !== rosterContext) return;
    const operation = beginMutation(); if (!operation) return;
    setBusy(true); setErr(""); setMsg("");
    try {
      if (!(await mutate(operation, "/api/attendance", "POST", { groupId, onDate: date, records: rows.map(row => ({ studentId: row.studentId, status: row.status || "presente", note: row.note || undefined })) }, data => Number.isSafeInteger(data.saved) && data.saved === rows.length))) return;
      setMsg(`Asistencia guardada para ${rows.length} alumnos.`); await load();
    } catch { if (operation.current()) { requireRead(); setErr("No se pudo confirmar el guardado. Consulta el estado antes de volver a enviar."); } }
    finally { finish(operation); }
  }
  async function exportReport() {
    if (!canEdit) return;
    const operation = beginMutation(); if (!operation) return;
    setExporting(true); setErr(""); setMsg("");
    const selectedReportGroup = canReportAll ? reportGroupId || groupId : groupId;
    try {
      const response = await fetchChecked("/api/attendance/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ groupId: selectedReportGroup, from, to, format: exportFormat }) }, operation.controller);
      if (!response) return;
      if (!response.ok) throw Error();
      const blob = await response.blob(); if (!operation.current()) return;
      const url = URL.createObjectURL(blob); const link = document.createElement("a");
      link.href = url; link.download = `asistencia-${selectedReportGroup === "todos" ? "todos-los-grupos" : from}-${to}.${exportFormat}`;
      try { document.body.appendChild(link); link.click(); } finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
      setMsg(`Reporte ${exportFormat.toUpperCase()} descargado.`);
    } catch { if (operation.current()) { requireRead(); setErr("No se pudo confirmar la descarga del reporte. Consulta el estado antes de solicitarlo de nuevo."); } }
    finally { finish(operation); }
  }
  async function loadHistory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!alive.current || !access.current || !historyOptions.some(student => student.id === historyStudentId)) return;
    historyRequest.current?.abort(); const controller = new AbortController(); historyRequest.current = controller;
    const key = historyContext; const current = () => alive.current && access.current && !controller.signal.aborted && currentHistory.current === key && historyRequest.current === controller;
    setHistoryBusy(true); setHistory(null); setErr("");
    try {
      const params = new URLSearchParams({ studentId: historyStudentId, from: historyFrom, to: historyTo }); if (canEdit) params.set("groupId", groupId);
      const response = await fetchChecked(`/api/attendance/history?${params}`, { cache: "no-store" }, controller);
      if (!response || !current()) return;
      if (!response.ok) throw Error();
      const result = await response.json() as HistoryResult;
      if (!current()) return;
      if (result.student?.id !== historyStudentId || result.period?.from !== historyFrom || result.period?.to !== historyTo || !Array.isArray(result.records) || !result.counts) throw Error();
      setHistory(result);
    } catch { if (current()) setErr("No se pudo comprobar el historial del alumno en este periodo."); }
    finally { if (current()) { historyRequest.current = null; setHistoryBusy(false); } }
  }
  async function submitJustification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (canEdit || !historyStudents.some(student => student.id === historyStudentId)) return;
    const operation = beginMutation(); if (!operation) return;
    const form = event.currentTarget; const data = new FormData(form); setJustificationBusy(true); setJustificationError(""); setJustificationNotice("");
    try {
      if (!(await mutate(operation, "/api/attendance/justifications", "POST", { studentId: historyStudentId, onDate: date, reason: data.get("reason") }, result => typeof result.id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result.id) && result.status === "pendiente", 201))) return;
      form.reset(); setJustificationNotice("La justificación se envió a la escuela para revisión."); await refreshJustifications();
    } catch { if (operation.current()) { requireRead(); setJustificationError("No se pudo confirmar la solicitud. Consulta el estado antes de volver a enviarla."); } }
    finally { finish(operation); }
  }
  async function resolveJustification(item: Justification, status: "aceptada" | "rechazada") {
    if (!canEdit || currentJustifications.current !== justificationContext || !loadedJustifications.current.some(row => row.id === item.id && row.status === "pendiente")) return;
    const operation = beginMutation(); if (!operation) return;
    setJustificationBusy(true); setJustificationError(""); setJustificationNotice("");
    try {
      if (!(await mutate(operation, `/api/attendance/justifications/${encodeURIComponent(item.id)}`, "PATCH", { status }, result => result.status === status))) return;
      setJustificationNotice(status === "aceptada" ? "Justificación aceptada; se actualizó la asistencia." : "Justificación rechazada.");
      await refreshJustifications(); if (status === "aceptada" && operation.current()) await load();
    } catch { if (operation.current()) { requireRead(); setJustificationError("No se pudo confirmar la revisión. Consulta el estado antes de volver a enviarla."); } }
    finally { finish(operation); }
  }
  if (!hasAccess) return <section className="portal-panel"><h2>Acceso a asistencia no disponible</h2><p role="alert">Tu sesión o tus permisos cambiaron. Vuelve a ingresar para revisar el acceso.</p><a href="/ingresar">Volver a ingresar</a></section>;
  const controlsDisabled = busy || justificationBusy || exporting || rosterLoading || justificationLoading || needsRead;
  const visibleRows = rosterKey === rosterContext ? rows : [];
  const visibleJustifications = justificationKey === justificationContext ? justifications : [];
  return <>
    <section className="portal-panel">
      <div className="calendar-controls">
        <label>Grupo <select value={groupId} disabled={busy || justificationBusy || exporting} onChange={event => { chooseGroup(event.target.value); }}>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
        <label>Fecha <input type="date" value={date} disabled={busy || justificationBusy || exporting} onChange={event => chooseDate(event.target.value)} /></label>
      </div>
      {!groupId ? <p>No tienes grupos disponibles.</p> : rosterLoading ? <p role="status">Comprobando asistencia…</p> : visibleRows.length ? <form onSubmit={save}>
        <ul className="record-list">{visibleRows.map(row => <li key={row.studentId}><div><strong>{row.givenName} {row.familyName}</strong>{!canEdit && <><span>Asistencia: {row.status || "Sin registro"}</span>{row.note && <p>Observación: {row.note}</p>}</>}</div>{canEdit && <div className="attendance-edit"><select aria-label={`Asistencia de ${row.givenName}`} value={row.status || "presente"} disabled={controlsDisabled} onChange={event => setStatus(row.studentId, event.target.value)}><option value="presente">Presente</option><option value="retardo">Retardo</option><option value="ausente">Ausente</option><option value="justificada">Falta justificada</option></select>{row.status === "justificada" && <label htmlFor={`attendance-note-${row.studentId}`}>Motivo de la justificación<textarea id={`attendance-note-${row.studentId}`} value={row.note || ""} disabled={controlsDisabled} onChange={event => setNote(row.studentId, event.target.value)} minLength={2} maxLength={400} required placeholder="Describe brevemente el motivo" /></label>}</div>}</li>)}</ul>
        {canEdit && <button disabled={controlsDisabled}>{busy ? "Guardando…" : "Guardar asistencia"}</button>}
      </form> : <p>{err ? "No se pudo comprobar la lista de asistencia." : "No hay alumnos inscritos o todavía no existe registro para esa fecha."}</p>}
    </section>
    <section className="portal-panel attendance-history">
      <h2>Historial individual</h2>
      {historyOptions.length ? <form className="calendar-controls" onSubmit={loadHistory}>
        {canEdit && <label>Alumno <select value={historyStudentId} disabled={busy || justificationBusy || exporting} onChange={event => chooseStudent(event.target.value)} required>{historyOptions.map(student => <option key={`${student.id}-${student.groupId}`} value={student.id}>{student.displayName}</option>)}</select></label>}
        {!canEdit && <label>Hijo o hija <select value={historyStudentId} disabled={busy || justificationBusy || exporting} onChange={event => { chooseStudent(event.target.value); }} required>{historyStudents.map(student => <option key={student.id} value={student.id}>{student.displayName}</option>)}</select></label>}
        <label>Desde <input type="date" value={historyFrom} onChange={event => chooseHistoryRange(event.target.value, false)} required /></label>
        <label>Hasta <input type="date" value={historyTo} onChange={event => chooseHistoryRange(event.target.value, true)} required /></label>
        <button type="submit" disabled={historyBusy || !historyStudentId || busy || justificationBusy || exporting}>{historyBusy ? "Consultando…" : "Consultar historial"}</button>
      </form> : <p>{canEdit ? "No hay alumnos activos en este grupo." : "Dirección aún no ha vinculado alumnos a tu cuenta."}</p>}
      {history && <><p className="page-intro">{history.student.name || historyOptions.find(student => student.id === history.student.id)?.displayName} · {history.period.from} a {history.period.to}</p><div className="dashboard-grid attendance-summary"><article className="stat-card"><p>Asistencia</p><strong>{history.attendancePercent === null ? "—" : `${history.attendancePercent}%`}</strong></article><article className="stat-card"><p>Presentes</p><strong>{history.counts.presente}</strong></article><article className="stat-card"><p>Retardos</p><strong>{history.counts.retardo}</strong></article><article className="stat-card"><p>Ausentes</p><strong>{history.counts.ausente}</strong></article><article className="stat-card"><p>Justificadas</p><strong>{history.counts.justificada}</strong></article></div><p className="form-hint">{history.percentageRule}</p>{history.records.length ? <ul className="record-list">{history.records.map((record,index)=><li key={`${record.date}-${index}`}><div><strong>{record.date} · {record.status}</strong><span>{record.groupName}</span>{record.note && <p>Observación: {record.note}</p>}</div></li>)}</ul> : <p>No hay registros de asistencia en este periodo.</p>}</>}
    </section>
    <section className="portal-panel attendance-justifications">
      <h2>Justificaciones de faltas</h2>
      {!canEdit && historyStudents.length > 0 && <form className="school-form event-form" onSubmit={submitJustification}>
        <label htmlFor="justification-student">Hijo o hija</label><select id="justification-student" value={historyStudentId} disabled={busy || justificationBusy || exporting} onChange={event => chooseStudent(event.target.value)} required>{historyStudents.map(student => <option key={student.id} value={student.id}>{student.displayName}</option>)}</select>
        <label htmlFor="justification-date">Fecha de la falta</label><input id="justification-date" type="date" value={date} disabled={busy || justificationBusy || exporting} onChange={event => chooseDate(event.target.value)} required />
        <label htmlFor="justification-reason">Motivo</label><textarea id="justification-reason" name="reason" minLength={2} maxLength={400} required placeholder="Explica brevemente el motivo de la falta" />
        <button disabled={controlsDisabled}>{justificationBusy ? "Enviando…" : "Enviar para revisión"}</button>
        <p className="form-hint">La solicitud queda pendiente hasta que la escuela la revise. Enviarla no cambia automáticamente la asistencia.</p>
      </form>}
      {justificationLoading ? <p role="status">Comprobando justificaciones…</p> : visibleJustifications.length ? <ul className="record-list">{visibleJustifications.map(item=><li key={item.id}><div><strong>{canEdit ? `${item.studentName} ${item.studentFamilyName} · ` : ""}{item.onDate} · {item.status}</strong><span>{item.groupName}</span><p>{item.reason}</p></div>{canEdit && item.status === "pendiente" && <div className="calendar-controls"><button type="button" disabled={controlsDisabled} onClick={()=>resolveJustification(item,"aceptada")}>Aceptar</button><button className="secondary-button" type="button" disabled={controlsDisabled} onClick={()=>resolveJustification(item,"rechazada")}>Rechazar</button></div>}</li>)}</ul> : <p>{justificationError ? "No se pudo comprobar la lista de justificaciones." : canEdit ? "No hay solicitudes de justificación para este grupo y fecha." : "Aún no has enviado justificaciones para este alumno."}</p>}
      {justificationError && <p className="form-error" role="alert">{justificationError}</p>}{justificationNotice && <p className="form-success" role="status">{justificationNotice}</p>}
    </section>
    {canEdit && groupId && <section className="portal-panel attendance-report">
      <h2>Reporte de asistencia</h2>
      <p>Descarga el historial de un grupo o, en dirección, de toda la escuela en Excel, PDF o CSV.</p>
      <div className="calendar-controls">{canReportAll && <label>Alcance del reporte <select value={reportGroupId} onChange={event => setReportGroupId(event.target.value)}><option value="todos">Todos los grupos</option>{groups.map(group=><option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}<label>Desde <input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label><label>Hasta <input type="date" value={to} onChange={event => setTo(event.target.value)} /></label><label>Formato <select value={exportFormat} onChange={event => setExportFormat(event.target.value as "csv" | "xlsx" | "pdf")}><option value="xlsx">Excel (.xlsx)</option><option value="pdf">PDF (.pdf)</option><option value="csv">CSV (.csv)</option></select></label><button type="button" onClick={exportReport} disabled={controlsDisabled}>{exporting ? "Preparando…" : "Descargar reporte"}</button></div>
    </section>}
    {(err || justificationError || needsRead) && <button type="button" className="secondary-button" disabled={busy || justificationBusy || exporting || rosterLoading || justificationLoading} onClick={() => void recheck()}>Consultar estado de nuevo</button>}
    {err && <p className="form-error" role="alert">{err}</p>}
    {msg && <p className="form-success" role="status">{msg}</p>}
  </>;
}
