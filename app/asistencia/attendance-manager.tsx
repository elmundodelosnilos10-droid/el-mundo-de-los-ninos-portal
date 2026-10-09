"use client";

import { useEffect, useState, type FormEvent } from "react";
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
  const [historyStudentId, setHistoryStudentId] = useState(historyStudents[0]?.id || "");
  const [historyFrom, setHistoryFrom] = useState(`${today.slice(0, 7)}-01`);
  const [historyTo, setHistoryTo] = useState(today);
  const [history, setHistory] = useState<HistoryResult | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const historyOptions = canEdit ? historyStudents.filter(student => student.groupId === groupId) : historyStudents;
  const [justifications, setJustifications] = useState<Justification[]>([]);
  const [justificationError, setJustificationError] = useState("");
  const [justificationNotice, setJustificationNotice] = useState("");
  const [justificationBusy, setJustificationBusy] = useState(false);

  async function load() {
    if (!groupId) return;
    setErr("");
    const response = await fetch(`/api/attendance?groupId=${encodeURIComponent(groupId)}&date=${date}`, { cache: "no-store" });
    const data = await response.json() as { error?: string; items?: Row[] };
    if (!response.ok) throw Error(data.error || "No se cargó la asistencia.");
    setRows(data.items ?? []);
  }

  useEffect(() => {
    if (!groupId) return;
    let cancelled = false;
    fetch(`/api/attendance?groupId=${encodeURIComponent(groupId)}&date=${date}`, { cache: "no-store" })
      .then(async response => {
        const data = await response.json() as { error?: string; items?: Row[] };
        if (!response.ok) throw Error(data.error || "No se cargó la asistencia.");
        return data.items ?? [];
      })
      .then(items => { if (!cancelled) setRows(items); })
      .catch(error => { if (!cancelled) setErr(error instanceof Error ? error.message : "No se cargó la asistencia."); });
    return () => { cancelled = true; };
  }, [groupId, date]);

  async function refreshJustifications() {
    if (canEdit && !groupId) return;
    if (!canEdit && !historyStudentId) return;
    const params = canEdit ? new URLSearchParams({ groupId, date }) : new URLSearchParams({ studentId: historyStudentId });
    const response = await fetch(`/api/attendance/justifications?${params}`, { cache: "no-store" });
    const data = await response.json() as { error?: string; items?: Justification[] };
    if (!response.ok) throw Error(data.error || "No se cargaron las justificaciones.");
    setJustifications(data.items ?? []);
  }

  useEffect(() => {
    if ((canEdit && !groupId) || (!canEdit && !historyStudentId)) return;
    let cancelled = false;
    const params = canEdit ? new URLSearchParams({ groupId, date }) : new URLSearchParams({ studentId: historyStudentId });
    fetch(`/api/attendance/justifications?${params}`, { cache: "no-store" })
      .then(async response => {
        const data = await response.json() as { error?: string; items?: Justification[] };
        if (!response.ok) throw Error(data.error || "No se cargaron las justificaciones.");
        return data.items ?? [];
      })
      .then(items => { if (!cancelled) setJustifications(items); })
      .catch(error => { if (!cancelled) setJustificationError(error instanceof Error ? error.message : "No se cargaron las justificaciones."); });
    return () => { cancelled = true; };
  }, [groupId, date, historyStudentId, canEdit]);

  function setStatus(studentId: string, status: string) {
    setRows(old => old.map(row => row.studentId === studentId ? { ...row, status, note: status === "justificada" ? row.note : null } : row));
  }

  function setNote(studentId: string, note: string) {
    setRows(old => old.map(row => row.studentId === studentId ? { ...row, note } : row));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setErr(""); setMsg("");
    try {
      const response = await fetch("/api/attendance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ groupId, onDate: date, records: rows.map(row => ({ studentId: row.studentId, status: row.status || "presente", note: row.note || undefined })) }) });
      const data = await response.json() as { error?: string; saved?: number };
      if (!response.ok) throw Error(data.error || "No se pudo guardar.");
      setMsg(`Asistencia guardada para ${data.saved} alumnos.`);
      await load();
    } catch (error) { setErr(error instanceof Error ? error.message : "Error de conexión."); }
    finally { setBusy(false); }
  }

  async function exportReport() {
    setExporting(true); setErr(""); setMsg("");
    try {
      const response = await fetch("/api/attendance/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ groupId: reportGroupId || groupId, from, to, format: exportFormat }) });
      if (!response.ok) {
        const data = await response.json() as { error?: string };
        throw Error(data.error || "No se pudo descargar el reporte.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = `asistencia-${reportGroupId === "todos" ? "todos-los-grupos" : from}-${to}.${exportFormat}`;
      document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMsg(`Reporte ${exportFormat.toUpperCase()} descargado.`);
    } catch (error) { setErr(error instanceof Error ? error.message : "Error de conexión."); }
    finally { setExporting(false); }
  }

  async function loadHistory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setHistoryBusy(true); setErr(""); setMsg("");
    try {
      const params = new URLSearchParams({ studentId: historyStudentId, from: historyFrom, to: historyTo });
      if (canEdit) params.set("groupId", groupId);
      const response = await fetch(`/api/attendance/history?${params}`, { cache: "no-store" });
      const result = await response.json() as HistoryResult & { error?: string };
      if (!response.ok) throw Error(result.error || "No se cargó el historial.");
      setHistory(result);
    } catch (error) { setErr(error instanceof Error ? error.message : "Error de conexión."); }
    finally { setHistoryBusy(false); }
  }

  async function submitJustification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setJustificationBusy(true); setJustificationError(""); setJustificationNotice("");
    const form = event.currentTarget; const data = new FormData(form);
    try {
      const response = await fetch("/api/attendance/justifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studentId: historyStudentId, onDate: date, reason: data.get("reason") }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw Error(result.error || "No se pudo enviar la justificación.");
      form.reset(); setJustificationNotice("La justificación se envió a la escuela para revisión."); await refreshJustifications();
    } catch (error) { setJustificationError(error instanceof Error ? error.message : "Error de conexión."); }
    finally { setJustificationBusy(false); }
  }

  async function resolveJustification(item: Justification, status: "aceptada" | "rechazada") {
    setJustificationBusy(true); setJustificationError(""); setJustificationNotice("");
    try {
      const response = await fetch(`/api/attendance/justifications/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw Error(result.error || "No se pudo resolver la justificación.");
      setJustificationNotice(status === "aceptada" ? "Justificación aceptada; se actualizó la asistencia." : "Justificación rechazada.");
      await refreshJustifications(); if (status === "aceptada") await load();
    } catch (error) { setJustificationError(error instanceof Error ? error.message : "Error de conexión."); }
    finally { setJustificationBusy(false); }
  }

  return <>
    <section className="portal-panel">
      <div className="calendar-controls">
        <label>Grupo <select value={groupId} onChange={event => { const next = event.target.value; setGroup(next); const first = historyStudents.find(student => student.groupId === next); if (first) setHistoryStudentId(first.id); setHistory(null); }}>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
        <label>Fecha <input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
      </div>
      {!groupId ? <p>No tienes grupos disponibles.</p> : rows.length ? <form onSubmit={save}>
        <ul className="record-list">{rows.map(row => <li key={row.studentId}><div><strong>{row.givenName} {row.familyName}</strong>{!canEdit && <><span>Asistencia: {row.status || "Sin registro"}</span>{row.note && <p>Observación: {row.note}</p>}</>}</div>{canEdit && <div className="attendance-edit"><select aria-label={`Asistencia de ${row.givenName}`} value={row.status || "presente"} onChange={event => setStatus(row.studentId, event.target.value)}><option value="presente">Presente</option><option value="retardo">Retardo</option><option value="ausente">Ausente</option><option value="justificada">Falta justificada</option></select>{row.status === "justificada" && <label htmlFor={`attendance-note-${row.studentId}`}>Motivo de la justificación<textarea id={`attendance-note-${row.studentId}`} value={row.note || ""} onChange={event => setNote(row.studentId, event.target.value)} minLength={2} maxLength={400} required placeholder="Describe brevemente el motivo" /></label>}</div>}</li>)}</ul>
        {canEdit && <button disabled={busy}>{busy ? "Guardando…" : "Guardar asistencia"}</button>}
      </form> : <p>No hay alumnos inscritos o todavía no existe registro para esa fecha.</p>}
    </section>
    <section className="portal-panel attendance-history">
      <h2>Historial individual</h2>
      {historyOptions.length ? <form className="calendar-controls" onSubmit={loadHistory}>
        {canEdit && <label>Alumno <select value={historyStudentId} onChange={event => setHistoryStudentId(event.target.value)} required>{historyOptions.map(student => <option key={`${student.id}-${student.groupId}`} value={student.id}>{student.displayName}</option>)}</select></label>}
        {!canEdit && <label>Hijo o hija <select value={historyStudentId} onChange={event => { setHistoryStudentId(event.target.value); setHistory(null); }} required>{historyStudents.map(student => <option key={student.id} value={student.id}>{student.displayName}</option>)}</select></label>}
        <label>Desde <input type="date" value={historyFrom} onChange={event => setHistoryFrom(event.target.value)} required /></label>
        <label>Hasta <input type="date" value={historyTo} onChange={event => setHistoryTo(event.target.value)} required /></label>
        <button type="submit" disabled={historyBusy || !historyStudentId}>{historyBusy ? "Consultando…" : "Consultar historial"}</button>
      </form> : <p>{canEdit ? "No hay alumnos activos en este grupo." : "Dirección aún no ha vinculado alumnos a tu cuenta."}</p>}
      {history && <><p className="page-intro">{history.student.name || historyOptions.find(student => student.id === history.student.id)?.displayName} · {history.period.from} a {history.period.to}</p><div className="dashboard-grid attendance-summary"><article className="stat-card"><p>Asistencia</p><strong>{history.attendancePercent === null ? "—" : `${history.attendancePercent}%`}</strong></article><article className="stat-card"><p>Presentes</p><strong>{history.counts.presente}</strong></article><article className="stat-card"><p>Retardos</p><strong>{history.counts.retardo}</strong></article><article className="stat-card"><p>Ausentes</p><strong>{history.counts.ausente}</strong></article><article className="stat-card"><p>Justificadas</p><strong>{history.counts.justificada}</strong></article></div><p className="form-hint">{history.percentageRule}</p>{history.records.length ? <ul className="record-list">{history.records.map((record,index)=><li key={`${record.date}-${index}`}><div><strong>{record.date} · {record.status}</strong><span>{record.groupName}</span>{record.note && <p>Observación: {record.note}</p>}</div></li>)}</ul> : <p>No hay registros de asistencia en este periodo.</p>}</>}
    </section>
    <section className="portal-panel attendance-justifications">
      <h2>Justificaciones de faltas</h2>
      {!canEdit && historyStudents.length > 0 && <form className="school-form event-form" onSubmit={submitJustification}>
        <label htmlFor="justification-student">Hijo o hija</label><select id="justification-student" value={historyStudentId} onChange={event => setHistoryStudentId(event.target.value)} required>{historyStudents.map(student => <option key={student.id} value={student.id}>{student.displayName}</option>)}</select>
        <label htmlFor="justification-date">Fecha de la falta</label><input id="justification-date" type="date" value={date} onChange={event => setDate(event.target.value)} required />
        <label htmlFor="justification-reason">Motivo</label><textarea id="justification-reason" name="reason" minLength={2} maxLength={400} required placeholder="Explica brevemente el motivo de la falta" />
        <button disabled={justificationBusy}>{justificationBusy ? "Enviando…" : "Enviar para revisión"}</button>
        <p className="form-hint">La solicitud queda pendiente hasta que la escuela la revise. Enviarla no cambia automáticamente la asistencia.</p>
      </form>}
      {justifications.length ? <ul className="record-list">{justifications.map(item=><li key={item.id}><div><strong>{canEdit ? `${item.studentName} ${item.studentFamilyName} · ` : ""}{item.onDate} · {item.status}</strong><span>{item.groupName}</span><p>{item.reason}</p></div>{canEdit && item.status === "pendiente" && <div className="calendar-controls"><button type="button" disabled={justificationBusy} onClick={()=>resolveJustification(item,"aceptada")}>Aceptar</button><button className="secondary-button" type="button" disabled={justificationBusy} onClick={()=>resolveJustification(item,"rechazada")}>Rechazar</button></div>}</li>)}</ul> : <p>{canEdit ? "No hay solicitudes de justificación para este grupo y fecha." : "Aún no has enviado justificaciones para este alumno."}</p>}
      {justificationError && <p className="form-error" role="alert">{justificationError}</p>}{justificationNotice && <p className="form-success" role="status">{justificationNotice}</p>}
    </section>
    {canEdit && groupId && <section className="portal-panel attendance-report">
      <h2>Reporte de asistencia</h2>
      <p>Descarga el historial de un grupo o, en dirección, de toda la escuela en Excel, PDF o CSV.</p>
      <div className="calendar-controls">{canReportAll && <label>Alcance del reporte <select value={reportGroupId} onChange={event => setReportGroupId(event.target.value)}><option value="todos">Todos los grupos</option>{groups.map(group=><option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}<label>Desde <input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label><label>Hasta <input type="date" value={to} onChange={event => setTo(event.target.value)} /></label><label>Formato <select value={exportFormat} onChange={event => setExportFormat(event.target.value as "csv" | "xlsx" | "pdf")}><option value="xlsx">Excel (.xlsx)</option><option value="pdf">PDF (.pdf)</option><option value="csv">CSV (.csv)</option></select></label><button type="button" onClick={exportReport} disabled={exporting}>{exporting ? "Preparando…" : "Descargar reporte"}</button></div>
    </section>}
    {err && <p className="form-error" role="alert">{err}</p>}
    {msg && <p className="form-success" role="status">{msg}</p>}
  </>;
}
