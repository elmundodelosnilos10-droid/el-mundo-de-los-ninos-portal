import Image from "next/image";
import Link from "next/link";
import { desc } from "drizzle-orm";
import { getDb } from "@/db";
import { privacyNotices } from "@/db/schema";
import { env } from "@/lib/runtime/env";
import { readPublicPrivacyNotice, type PublicPrivacyNotice } from "@/lib/supabase/public-privacy-notice";

export const dynamic = "force-dynamic";

const sections = [
  ["Datos personales tratados", "personalDataCategories"],
  ["Datos personales sensibles", "sensitiveDataCategories"],
  ["Finalidades", "purposes"],
  ["Finalidades que requieren consentimiento", "consentPurposes"],
  ["Opciones para limitar el uso o divulgación", "limitationMeans"],
  ["Solicitudes ARCO", "arcoProcedure"],
  ["Cambios a este aviso", "noticeChanges"],
  ["Proveedores y transferencias", "processorsAndTransfers"],
] as const;

export default async function AvisoDePrivacidad() {
  let notice: PublicPrivacyNotice | null | undefined;
  let unavailable = false;
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    try { notice = await readPublicPrivacyNotice(env); }
    catch { unavailable = true; }
  } else {
  [notice] = await getDb().select({
    version: privacyNotices.version,
    responsibleName: privacyNotices.responsibleName,
    address: privacyNotices.address,
    contactName: privacyNotices.contactName,
    contactEmail: privacyNotices.contactEmail,
    personalDataCategories: privacyNotices.personalDataCategories,
    sensitiveDataCategories: privacyNotices.sensitiveDataCategories,
    purposes: privacyNotices.purposes,
    consentPurposes: privacyNotices.consentPurposes,
    limitationMeans: privacyNotices.limitationMeans,
    arcoProcedure: privacyNotices.arcoProcedure,
    noticeChanges: privacyNotices.noticeChanges,
    processorsAndTransfers: privacyNotices.processorsAndTransfers,
    effectiveDate: privacyNotices.effectiveDate,
  }).from(privacyNotices).orderBy(desc(privacyNotices.publishedAt)).limit(1);
  }

  return <main className="auth-page">
    <article className="auth-card privacy-notice-page" aria-labelledby="privacy-title">
      <Image src="/logo-escuela.jpg" width={92} height={92} alt="Logotipo El Mundo de los Niños" className="auth-logo" priority />
      <p className="eyebrow">DATOS PERSONALES</p>
      <h1 id="privacy-title">Aviso de privacidad escolar</h1>
      {unavailable ? <p className="form-error" role="alert">No fue posible consultar el aviso de privacidad. Inténtalo más tarde o comunícate con Dirección.</p> : notice ? <>
        <p className="auth-intro">Versión {notice.version} · vigente desde {new Date(`${notice.effectiveDate}T12:00:00Z`).toLocaleDateString("es-MX", { timeZone: "UTC", dateStyle: "long" })}</p>
        <section className="privacy-notice-block"><h2>Responsable del tratamiento</h2><p className="privacy-notice-copy">{notice.responsibleName}</p><p className="privacy-notice-copy">{notice.address}</p><p>Contacto: {notice.contactName} · <a href={`mailto:${notice.contactEmail}`}>{notice.contactEmail}</a></p></section>
        {sections.map(([title, key]) => <section className="privacy-notice-block" key={key}><h2>{title}</h2><p className="privacy-notice-copy">{notice[key]}</p></section>)}
      </> : <>
        <p className="auth-intro">La escuela todavía no ha proporcionado un aviso de privacidad aprobado para esta plataforma.</p>
        <p>Esta página informa el estado de preparación; no es el aviso legal de la escuela ni sustituye la información que debe entregar a las familias.</p>
        <p>No ingreses ni envíes datos reales de alumnos hasta que Dirección publique el aviso aprobado y confirme los procesos de privacidad.</p>
        <p>Para consultar sobre privacidad, comunícate con Dirección por el medio que te proporcionó la escuela.</p>
      </>}
      <Link href="/ingresar">Volver al inicio de sesión</Link>
    </article>
  </main>;
}
