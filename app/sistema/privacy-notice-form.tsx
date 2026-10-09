"use client";

import { useEffect, useState } from "react";

const blank = {
  version: "",
  responsibleName: "",
  address: "",
  contactName: "",
  contactEmail: "",
  personalDataCategories: "",
  sensitiveDataCategories: "",
  purposes: "",
  consentPurposes: "",
  limitationMeans: "",
  arcoProcedure: "",
  noticeChanges: "",
  processorsAndTransfers: "",
  effectiveDate: "",
};

type FormFields = typeof blank;
type Notice = FormFields & { id?: string; publishedAt?: string };
type Payload = { notice: Notice | null; error?: string };

const fieldLabels: Record<keyof FormFields, string> = {
  version: "Versión del aviso aprobado",
  responsibleName: "Nombre legal de la persona o entidad responsable",
  address: "Domicilio del responsable",
  contactName: "Persona responsable de privacidad o área de contacto",
  contactEmail: "Correo para asuntos de privacidad",
  personalDataCategories: "Categorías de datos personales que trata la escuela",
  sensitiveDataCategories: "Datos sensibles tratados o declaración aprobada de que no se recaban",
  purposes: "Finalidades principales del tratamiento",
  consentPurposes: "Finalidades que requieren consentimiento y cómo se obtiene o retira",
  limitationMeans: "Medios para limitar el uso o divulgación de los datos",
  arcoProcedure: "Procedimiento y medios para solicitudes ARCO",
  noticeChanges: "Cómo comunicará la escuela los cambios al aviso",
  processorsAndTransfers: "Proveedores, encargados y transferencias que la escuela haya revisado",
  effectiveDate: "Fecha de entrada en vigor",
};

const multiline = new Set<keyof FormFields>([
  "address", "personalDataCategories", "sensitiveDataCategories", "purposes", "consentPurposes",
  "limitationMeans", "arcoProcedure", "noticeChanges", "processorsAndTransfers",
]);

export function PrivacyNoticeForm() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [fields, setFields] = useState<FormFields>(blank);
  const [approvalConfirmed, setApprovalConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function refresh() {
    const response = await fetch("/api/privacy-notice", { cache: "no-store" });
    const payload = await response.json() as Payload;
    if (!response.ok) throw new Error(payload.error ?? "No se pudo consultar el aviso publicado.");
    setNotice(payload.notice);
    if (payload.notice) {
      const current = payload.notice;
      setFields({
        version: "", responsibleName: current.responsibleName, address: current.address, contactName: current.contactName,
        contactEmail: current.contactEmail, personalDataCategories: current.personalDataCategories,
        sensitiveDataCategories: current.sensitiveDataCategories, purposes: current.purposes,
        consentPurposes: current.consentPurposes, limitationMeans: current.limitationMeans,
        arcoProcedure: current.arcoProcedure, noticeChanges: current.noticeChanges,
        processorsAndTransfers: current.processorsAndTransfers, effectiveDate: current.effectiveDate,
      });
    }
  }

  useEffect(() => {
    void fetch("/api/privacy-notice", { cache: "no-store" }).then(async response => {
      const payload = await response.json() as Payload;
      if (!response.ok) throw new Error(payload.error ?? "No se pudo consultar el aviso.");
      setNotice(payload.notice);
      if (payload.notice) {
        const current = payload.notice;
        setFields({
          version: "", responsibleName: current.responsibleName, address: current.address, contactName: current.contactName,
          contactEmail: current.contactEmail, personalDataCategories: current.personalDataCategories,
          sensitiveDataCategories: current.sensitiveDataCategories, purposes: current.purposes,
          consentPurposes: current.consentPurposes, limitationMeans: current.limitationMeans,
          arcoProcedure: current.arcoProcedure, noticeChanges: current.noticeChanges,
          processorsAndTransfers: current.processorsAndTransfers, effectiveDate: current.effectiveDate,
        });
      }
    }).catch(() => setError("No se pudo consultar el estado del aviso. Recarga la página."));
  }, []);

  function update<K extends keyof FormFields>(key: K, value: FormFields[K]) {
    setFields(current => ({ ...current, [key]: value }));
  }

  async function publish(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/privacy-notice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...fields, approvalConfirmed }),
      });
      const payload = await response.json() as { error?: string; version?: string };
      if (!response.ok) throw new Error(payload.error ?? "No se pudo publicar el aviso.");
      setApprovalConfirmed(false);
      setMessage(`Se publicó la versión ${payload.version}. El aviso anterior permanece en el historial.`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo publicar el aviso.");
    } finally { setBusy(false); }
  }

  return <section className="portal-panel privacy-notice-admin">
    <h2>Aviso de privacidad público</h2>
    {notice ? <p><strong>Versión vigente:</strong> {notice.version} · vigente desde {notice.effectiveDate}. <a href="/aviso-de-privacidad" target="_blank" rel="noreferrer">Abrir página pública</a></p> : <p className="system-status-note">Aún no hay un aviso aprobado publicado. La página pública muestra esta condición.</p>}
    <p className="form-hint">Completa el texto que aprobó la escuela. Al publicar se hará visible para cualquiera, se conservará la versión anterior y la acción quedará en auditoría. El portal no redacta ni valida jurídicamente el contenido.</p>
    <form className="school-form privacy-notice-form" onSubmit={publish}>
      {(Object.keys(fieldLabels) as (keyof FormFields)[]).map(key => <div className="privacy-notice-field" key={key}>
        <label htmlFor={`notice-${key}`}>{fieldLabels[key]}</label>
        {multiline.has(key)
          ? <textarea id={`notice-${key}`} value={fields[key]} onChange={event => update(key, event.target.value)} minLength={10} maxLength={key === "processorsAndTransfers" ? 4000 : 3000} required disabled={busy} />
          : <input id={`notice-${key}`} type={key === "contactEmail" ? "email" : key === "effectiveDate" ? "date" : "text"} value={fields[key]} onChange={event => update(key, event.target.value)} maxLength={key === "responsibleName" ? 180 : key === "contactEmail" ? 254 : 120} required disabled={busy} />}
      </div>)}
      <label className="check-label"><input type="checkbox" checked={approvalConfirmed} onChange={event => setApprovalConfirmed(event.target.checked)} required disabled={busy} /> Confirmo que la escuela revisó y aprobó esta versión para publicación.</label>
      {error && <p role="alert" className="form-error">{error}</p>}
      {message && <p role="status" className="form-success">{message}</p>}
      <button disabled={busy}>{busy ? "Publicando…" : "Publicar nueva versión"}</button>
    </form>
  </section>;
}
