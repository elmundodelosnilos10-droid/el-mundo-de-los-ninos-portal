import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { getSchoolPageActor } from "@/lib/supabase/page-actor";
import { getDb } from "@/db";
import { consents, guardians, students, studentGuardians } from "@/db/schema";
import { PortalShell } from "@/components/portal-shell";
import { PasswordChangeForm } from "./password-change-form";
import { env } from "@/lib/runtime/env";
import { createSchoolDatabaseClient } from "@/lib/supabase/database";
import { readFamilyConsents, type FamilyConsentRecord } from "@/lib/supabase/family-consents";

export const dynamic = "force-dynamic";

export default async function MiCuenta() {
  const actor = await getSchoolPageActor(await headers());
  if (!actor) redirect("/ingresar");
  const role = actor.roles[0];
  if (!role) redirect("/");
  const isTutor = actor.roles.includes("tutor");
  let consentRecords: FamilyConsentRecord[] = [];
  let consentLoadFailed = false;
  if (isTutor) {
    if (env.SCHOOL_DATA_PROVIDER === "supabase") {
      if (!actor.supabaseAuth) redirect("/ingresar");
      try { consentRecords = await readFamilyConsents(createSchoolDatabaseClient(env), actor.supabaseAuth.accessToken, actor.id); }
      catch { consentLoadFailed = true; }
    } else {
      consentRecords = await getDb().select({ studentId: students.id, studentName: students.givenName, studentFamilyName: students.familyName, purpose: consents.purpose, granted: consents.granted, recordedAt: consents.recordedAt, expiresAt: consents.expiresAt, noticeVersion: consents.noticeVersion }).from(studentGuardians).innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId)).innerJoin(students, eq(students.id, studentGuardians.studentId)).leftJoin(consents, and(eq(consents.studentId, students.id), eq(consents.guardianId, guardians.id))).where(and(eq(guardians.userId, actor.id), eq(guardians.active, true), eq(studentGuardians.active, true), eq(students.active, true))).orderBy(desc(consents.recordedAt)).limit(300);
    }
  }
  const latestConsent = new Map<string, (typeof consentRecords)[number]>();
  for (const row of consentRecords) if (row.purpose && !latestConsent.has(`${row.studentId}:${row.purpose}`)) latestConsent.set(`${row.studentId}:${row.purpose}`, row);
  const children = [...new Map(consentRecords.map(row => [row.studentId, row])).values()];
  const purposeLabels: Record<string, string> = { school_activity_image: "Imagen en actividades escolares", public_image: "Publicación de imagen", class_recording: "Grabación de clase" };

  return <PortalShell name={actor.name} role={role} active="/mi-cuenta">
    <p className="eyebrow">SEGURIDAD DE ACCESO</p>
    <h1>Mi cuenta</h1>
    <p className="page-intro">Actualiza la contraseña que te entregó la escuela. Usa una contraseña larga que no compartas con otras personas.</p>
    <section className="portal-panel account-security-panel">
      <h2>Cambiar contraseña</h2>
      <p>Se te pedirá tu contraseña actual para confirmar el cambio. La nueva contraseña debe tener al menos 12 caracteres.</p>
      <PasswordChangeForm />
    </section>
    <section className="portal-panel account-details-panel">
      <h2>Datos de acceso</h2>
      <p><strong>Nombre:</strong> {actor.name}</p>
      <p><strong>Correo escolar:</strong> {actor.email}</p>
      <p>Si necesitas corregir estos datos, comunícate con dirección.</p>
    </section>
    {isTutor && <section className="portal-panel account-details-panel">
      <h2>Autorizaciones documentadas</h2>
      <p>Consulta las decisiones que Dirección registró con el aviso de la escuela. Esta pantalla no solicita ni modifica autorizaciones.</p>
      {consentLoadFailed ? <p className="form-error" role="alert">No se pudieron cargar las autorizaciones de Supabase. Vuelve a intentarlo en unos minutos.</p> : children.length ? children.map(child => <div key={child.studentId} className="consent-family-child"><h3>{child.studentName} {child.studentFamilyName}</h3><ul>{Object.entries(purposeLabels).map(([purpose, label]) => { const record = latestConsent.get(`${child.studentId}:${purpose}`); return <li key={purpose}><strong>{label}:</strong> {record ? <>{record.granted ? "Autorizado" : "No autorizado o retirado"} · aviso {record.noticeVersion ?? "sin referencia"} · registrado {record.recordedAt?.toLocaleDateString("es-MX", { timeZone: "America/Mexico_City", dateStyle: "medium" }) ?? "sin fecha"}{record.expiresAt && <> · vence {record.expiresAt.toLocaleDateString("es-MX", { timeZone: "America/Mexico_City", dateStyle: "medium" })}</>}</> : "Sin registro"}</li>; })}</ul></div>) : <p className="empty-state">No hay alumnos vinculados a esta cuenta. Comunícate con dirección para revisar el acceso familiar.</p>}
      <p className="form-hint">Si el estado no coincide con el comprobante que entregaste, contacta a Dirección para solicitar una revisión.</p>
    </section>}
  </PortalShell>;
}
