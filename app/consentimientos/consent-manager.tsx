"use client";

import { useEffect, useMemo, useState } from "react";

type Student = { id: string; givenName: string; familyName: string };
type Guardian = { id: string; name: string; studentId: string };
type RecordItem = { id: string; studentId: string; studentName: string; studentFamilyName: string; guardianId: string; guardianName: string; purpose: string; granted: boolean; recordedAt: string; expiresAt: string | null; noticeVersion: string | null; evidenceReference: string | null };
type Payload = { items: RecordItem[]; students: Student[]; guardians: Guardian[] };

const purposeLabels: Record<string, string> = { school_activity_image: "Imagen en actividades escolares", public_image: "Publicación de imagen", class_recording: "Grabación de clase" };

export function ConsentManager() {
  const [data, setData] = useState<Payload>({ items: [], students: [], guardians: [] });
  const [studentId, setStudentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const guardianOptions = useMemo(() => data.guardians.filter(item => item.studentId === studentId), [data.guardians, studentId]);

  async function refresh() {
    const response = await fetch("/api/consents", { cache: "no-store" });
    if (!response.ok) throw new Error("No se pudo cargar el registro.");
    setData(await response.json() as Payload);
  }

  useEffect(() => {
    void fetch("/api/consents", { cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("No se pudo cargar el registro.");
      setData(await response.json() as Payload);
    }).catch(() => setError("No se pudo cargar la información. Recarga la página e inténtalo de nuevo."));
  }, []);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(true); setError(""); setMessage("");
    const form = new FormData(formElement);
    const payload = { studentId: String(form.get("studentId")), guardianId: String(form.get("guardianId")), purpose: String(form.get("purpose")), granted: String(form.get("granted")) === "true", noticeVersion: String(form.get("noticeVersion") ?? ""), evidenceReference: String(form.get("evidenceReference") ?? ""), expiresAt: form.get("expiresAt") ? new Date(`${String(form.get("expiresAt"))}T23:59:59-06:00`).toISOString() : null };
    try {
      const response = await fetch("/api/consents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "No se pudo guardar.");
      formElement.reset(); setStudentId(""); setMessage("Registro guardado y agregado a la auditoría."); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar el registro."); }
    finally { setBusy(false); }
  }

  return <>
    <section className="content-card"><h2>Registrar una decisión existente</h2><p className="form-hint">Usa solo decisiones documentadas con un aviso escolar aprobado. Guarda la versión del aviso y el folio o referencia del comprobante; no subas aquí documentos con datos personales.</p>
      <form className="school-form" onSubmit={save}>
        <label htmlFor="consent-student">Alumno</label><select id="consent-student" name="studentId" required value={studentId} onChange={event => setStudentId(event.target.value)}><option value="">Selecciona un alumno</option>{data.students.map(item => <option key={item.id} value={item.id}>{item.givenName} {item.familyName}</option>)}</select>
        <label htmlFor="consent-guardian">Madre, padre o tutor</label><select id="consent-guardian" name="guardianId" required disabled={!studentId}><option value="">Selecciona un tutor vinculado</option>{guardianOptions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <label htmlFor="consent-purpose">Uso</label><select id="consent-purpose" name="purpose" required><option value="school_activity_image">Imagen en actividades escolares</option><option value="public_image">Publicación de imagen</option><option value="class_recording">Grabación de clase</option></select>
        <label htmlFor="consent-decision">Decisión documentada</label><select id="consent-decision" name="granted" required defaultValue=""><option value="" disabled>Selecciona la decisión documentada</option><option value="true">Autorizado</option><option value="false">No autorizado o retirado</option></select>
        <label htmlFor="consent-version">Versión del aviso aprobado</label><input id="consent-version" name="noticeVersion" required maxLength={50} placeholder="Ej. aviso-2026-v1" />
        <label htmlFor="consent-reference">Folio o referencia del comprobante</label><input id="consent-reference" name="evidenceReference" required maxLength={100} placeholder="Ej. carpeta escolar / folio" />
        <label htmlFor="consent-expiry">Vigencia hasta (opcional)</label><input id="consent-expiry" name="expiresAt" type="date" />
        <button disabled={busy || !data.students.length}>{busy ? "Guardando…" : "Guardar registro"}</button>
      </form>
      <p className="form-hint">Este registro es administrativo. No sustituye el aviso o formato de la escuela ni habilita grabaciones.</p>
      {message && <p className="success-message" role="status">{message}</p>}{error && <p className="error-message" role="alert">{error}</p>}
    </section>
    <section className="content-card"><h2>Historial registrado</h2>{data.items.length ? <div className="audit-table-wrap"><table className="audit-table"><thead><tr><th>Fecha</th><th>Alumno y tutor</th><th>Uso</th><th>Decisión</th><th>Aviso y comprobante</th></tr></thead><tbody>{data.items.map(item => <tr key={item.id}><td>{new Date(item.recordedAt).toLocaleDateString("es-MX", { timeZone: "America/Mexico_City", dateStyle: "medium" })}</td><td>{item.studentName} {item.studentFamilyName}<br />{item.guardianName}</td><td>{purposeLabels[item.purpose] ?? item.purpose}</td><td>{item.granted ? "Autorizado" : "No autorizado o retirado"}{item.expiresAt && <><br />Vence: {new Date(item.expiresAt).toLocaleDateString("es-MX", { timeZone: "America/Mexico_City" })}</>}</td><td>Aviso: {item.noticeVersion ?? "sin referencia"}<br />Folio: {item.evidenceReference ?? "sin referencia"}</td></tr>)}</tbody></table></div> : <p className="empty-state">Todavía no hay decisiones registradas. Sin registro no se considera que exista autorización.</p>}</section>
  </>;
}
