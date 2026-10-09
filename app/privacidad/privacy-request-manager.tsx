"use client";

import { useEffect, useState } from "react";

type Child = { id: string; givenName: string; familyName: string };
type RequestItem = { id: string; studentId: string; studentName: string; studentFamilyName: string; requesterName?: string; kind: string; details: string; status: string; responseNote: string | null; createdAt: string; updatedAt: string };
type Payload = { items: RequestItem[]; students?: Child[] };
const kindLabels: Record<string, string> = { acceso: "Acceso a información", correccion: "Corrección de información", eliminacion: "Eliminación de información" };
const statusLabels: Record<string, string> = { recibida: "Recibida", en_revision: "En revisión", respondida: "Respondida", cerrada: "Cerrada" };

export function PrivacyRequestManager({ canReview }: { canReview: boolean }) {
  const [items, setItems] = useState<RequestItem[]>([]);
  const [students, setStudents] = useState<Child[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function refresh() {
    const response = await fetch("/api/privacy-requests", { cache: "no-store" });
    const payload = await response.json() as Payload & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "No se pudieron cargar las solicitudes.");
    setItems(payload.items); setStudents(payload.students ?? []);
  }

  useEffect(() => { void fetch("/api/privacy-requests", { cache: "no-store" }).then(async response => { const payload = await response.json() as Payload & { error?: string }; if (!response.ok) throw new Error(payload.error); setItems(payload.items); setStudents(payload.students ?? []); }).catch(() => setError("No se pudo cargar la información. Recarga la página e inténtalo de nuevo.")); }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/privacy-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studentId: form.get("studentId"), kind: form.get("kind"), details: form.get("details") }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "No se pudo enviar.");
      formElement.reset(); setMessage("Tu solicitud quedó registrada para revisión por Dirección."); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo enviar la solicitud."); }
    finally { setBusy(false); }
  }

  async function update(event: React.FormEvent<HTMLFormElement>, item: RequestItem) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const status = String(form.get("status")); const responseNote = String(form.get("responseNote") ?? "").trim(); setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/privacy-requests/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, ...(responseNote ? { responseNote } : {}) }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "No se pudo actualizar.");
      setMessage("Solicitud actualizada; la familia recibió un aviso interno."); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo actualizar."); }
    finally { setBusy(false); }
  }

  return <>
    {!canReview && <section className="content-card"><h2>Enviar una solicitud</h2><p>Dirección revisará la petición y te dará seguimiento por este portal. No se realizan cambios automáticos ni se define aquí un plazo de respuesta. Evita incluir documentos, contraseñas o información que no sea necesaria.</p>
      <form className="school-form" onSubmit={submit}><label htmlFor="privacy-student">Hija o hijo</label><select id="privacy-student" name="studentId" required disabled={!students.length}><option value="">Selecciona a tu hija o hijo</option>{students.map(child => <option key={child.id} value={child.id}>{child.givenName} {child.familyName}</option>)}</select>
        <label htmlFor="privacy-kind">Tipo de solicitud</label><select id="privacy-kind" name="kind" required><option value="acceso">Acceso a información</option><option value="correccion">Corrección de información</option><option value="eliminacion">Eliminación de información</option></select>
        <label htmlFor="privacy-details">¿Qué información o corrección solicitas?</label><textarea id="privacy-details" name="details" minLength={10} maxLength={1200} required placeholder="Describe brevemente tu solicitud." />
        <button disabled={busy || !students.length}>{busy ? "Enviando…" : "Enviar a Dirección"}</button>
      </form>
    </section>}
    <section className="content-card"><h2>{canReview ? "Solicitudes recibidas" : "Mis solicitudes"}</h2>{items.length ? <div className="privacy-request-list">{items.map(item => <article key={item.id} className="privacy-request-item"><header><div><h3>{kindLabels[item.kind] ?? item.kind}</h3><p>{item.studentName} {item.studentFamilyName}{canReview ? ` · Familia: ${item.requesterName ?? "Cuenta autorizada"}` : ""}</p></div><span className="task-status">{statusLabels[item.status] ?? item.status}</span></header><p className="privacy-request-details">{item.details}</p>{item.responseNote && <p className="privacy-response"><strong>Nota de Dirección:</strong> {item.responseNote}</p>}{canReview && item.status !== "cerrada" && <form className="privacy-review-form" onSubmit={event => update(event, item)}><label htmlFor={`status-${item.id}`}>Siguiente estado</label><select id={`status-${item.id}`} name="status" defaultValue="" required><option value="" disabled>Selecciona una acción</option>{item.status === "recibida" && <option value="en_revision">En revisión</option>}{item.status !== "respondida" && <option value="respondida">Respondida</option>}<option value="cerrada">Cerrada</option></select><label htmlFor={`note-${item.id}`}>Nota para la familia (requerida al responder o cerrar)</label><textarea id={`note-${item.id}`} name="responseNote" maxLength={1200} defaultValue={item.responseNote ?? ""} /><button className="secondary-button" disabled={busy}>Guardar seguimiento</button></form>}</article>)}</div> : <p className="empty-state">Todavía no hay solicitudes.</p>}</section>
    {message && <p className="success-message" role="status">{message}</p>}{error && <p className="error-message" role="alert">{error}</p>}
  </>;
}
