import { env } from "@/lib/runtime/env";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getSchoolPageActor } from "@/lib/supabase/page-actor";
import { getDb } from "@/db";
import { enrollments, guardians, students, studentGuardians, teacherGroups, teachers, user } from "@/db/schema";
import { getCommunicationHours, type CommunicationHours } from "@/lib/communication-hours";
import { hasRole } from "@/lib/access";
import { PortalShell } from "@/components/portal-shell";
import { CommunicationHoursForm } from "./communication-hours-form";
import { MessagingPanel, type Contact } from "./messaging-panel";
import { isFileScannerConfigured } from "@/lib/file-scanner";
import { isFileStorageConfigured } from "@/lib/file-storage";
import { createSchoolDatabaseClient } from "@/lib/supabase/database";

export const dynamic = "force-dynamic";

export default async function Comunicacion() {
  const actor = await getSchoolPageActor(await headers());
  if (!actor) redirect("/ingresar");
  const role = actor.roles[0];
  if (!role) redirect("/");
  const canMessage = hasRole(actor, "docente", "tutor");
  const contacts: Contact[] = [];
  let contactsError = "";
  if (canMessage && env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) contactsError = "La sesión todavía no está vinculada con Supabase. Vuelve a iniciar sesión.";
    else {
      try {
        const { data } = await createSchoolDatabaseClient(env).rpc<{ items?: Contact[] }>(actor.supabaseAuth.accessToken, "school_conversation_contacts", {});
        contacts.push(...(data[0]?.items ?? []));
      } catch { contactsError = "No se pudo cargar la lista de contactos del chat."; }
    }
  } else if (hasRole(actor, "tutor")) {
    const db = getDb();
    const rows = await db.selectDistinct({ studentId: students.id, studentName: students.givenName, teacherId: teachers.id, teacherName: user.name })
      .from(studentGuardians).innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
      .innerJoin(students, eq(students.id, studentGuardians.studentId)).innerJoin(enrollments, eq(enrollments.studentId, students.id))
      .innerJoin(teacherGroups, eq(teacherGroups.groupId, enrollments.groupId)).innerJoin(teachers, eq(teachers.id, teacherGroups.teacherId))
      .innerJoin(user, eq(user.id, teachers.userId))
      .where(and(eq(guardians.userId, actor.id), eq(guardians.active, true), eq(studentGuardians.active, true), eq(students.active, true), eq(teachers.active, true), isNull(enrollments.endedAt)));
    contacts.push(...rows);
  } else if (hasRole(actor, "docente")) {
    const db = getDb();
    const own = await db.select({ id: teachers.id, name: user.name }).from(teachers).innerJoin(user, eq(user.id, teachers.userId))
      .where(and(eq(teachers.userId, actor.id), eq(teachers.active, true))).limit(1);
    if (own.length) {
      const rows = await db.selectDistinct({ studentId: students.id, studentName: students.givenName, teacherId: teachers.id, guardianId: guardians.id, guardianUserId: guardians.userId })
        .from(teacherGroups).innerJoin(enrollments, eq(enrollments.groupId, teacherGroups.groupId))
        .innerJoin(students, eq(students.id, enrollments.studentId)).innerJoin(studentGuardians, eq(studentGuardians.studentId, students.id))
        .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId)).innerJoin(teachers, eq(teachers.id, teacherGroups.teacherId))
        .where(and(eq(teachers.userId, actor.id), eq(teachers.active, true), eq(guardians.active, true), eq(studentGuardians.active, true), eq(students.active, true), isNull(enrollments.endedAt)));
      const guardianIds = [...new Set(rows.map(row => row.guardianUserId))];
      const names = guardianIds.length ? await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, guardianIds)) : [];
      contacts.push(...rows.map(row => ({ studentId: row.studentId, studentName: row.studentName, teacherId: row.teacherId, teacherName: own[0].name, guardianId: row.guardianId, guardianName: names.find(person => person.id === row.guardianUserId)?.name || "Familia" })));
    }
  }

  let communicationHours: CommunicationHours;
  try { communicationHours = await getCommunicationHours(actor); }
  catch {
    return <PortalShell name={actor.name} role={role} active="/comunicacion"><p className="eyebrow">FAMILIA Y ESCUELA</p><h1>Comunicación</h1><p className="form-error" role="alert">No se pudo verificar el horario escolar. Vuelve a intentarlo en unos minutos.</p></PortalShell>;
  }
  const canManageHours = hasRole(actor, "superadmin", "direccion");
  return <PortalShell name={actor.name} role={role} active="/comunicacion">
    <p className="eyebrow">FAMILIA Y ESCUELA</p>
    <h1>Comunicación</h1>
    <p className="page-intro">Chat privado entre docentes y tutores vinculados. Los avisos generales están en <a href="/comunicados">Comunicados</a>.</p>
    {contactsError && <p className="form-error" role="alert">{contactsError}</p>}
    {canManageHours && <CommunicationHoursForm initialSettings={communicationHours} />}
    <MessagingPanel contacts={contacts} canMessage={canMessage} communicationHours={communicationHours} uploadsReady={isFileStorageConfigured(env) && isFileScannerConfigured({ url: env.SCHOOL_FILE_SCAN_URL, token: env.SCHOOL_FILE_SCAN_TOKEN })} />
  </PortalShell>;
}
