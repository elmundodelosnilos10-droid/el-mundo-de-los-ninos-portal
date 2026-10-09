import { env } from "@/lib/runtime/env";
import { createSchoolDatabaseClient } from "@/lib/supabase/database";
import { readStudentGuardians } from "@/lib/supabase/student-guardians";
import { readSchoolDirectory } from "@/lib/supabase/school-directory";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getSchoolPageActor } from "@/lib/supabase/page-actor";
import { getDb } from "@/db";
import { guardians, students, studentGuardians, user } from "@/db/schema";
import { hasRole, maySeeStudent } from "@/lib/access";
import { GuardianLinkManager } from "./guardian-link";
import { PortalShell } from "@/components/portal-shell";

export const dynamic = "force-dynamic";

export default async function Alumno({ params }: { params: Promise<{ id: string }> }) {
  const actor = await getSchoolPageActor(await headers());
  if (!actor) redirect("/ingresar");
  const role = actor.roles[0];
  if (!role) redirect("/");
  const { id } = await params;
  if (!(await maySeeStudent(actor, id))) notFound();
  const admin = hasRole(actor, "superadmin", "direccion");
  let student: { id: string; givenName: string; familyName: string; birthDate: string | null } | null = null;
  let linkedGuardians: { id: string; name: string; relationship: string }[] = [];
  let availableGuardians: { id: string; name: string; email: string }[] = [];
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) redirect("/ingresar");
    try {
      const client = createSchoolDatabaseClient(env);
      const jwt = actor.supabaseAuth.accessToken;
      const result = await client.select<{ id: string; given_name: string; family_name: string; birth_date: string | null }>(jwt, "students", {
        columns: ["id", "given_name", "family_name", "birth_date"],
        filters: [{ column: "id", operator: "eq", value: id }], limit: 1,
      });
      const row = result.data[0];
      if (row) {
        student = { id: row.id, givenName: row.given_name, familyName: row.family_name, birthDate: row.birth_date };
        if (admin) [linkedGuardians, availableGuardians] = await Promise.all([
          readStudentGuardians(client, jwt, id), readSchoolDirectory(client, jwt, "guardians"),
        ]);
      }
    } catch {
      return <PortalShell name={actor.name} role={role} active="/alumnos"><p className="eyebrow">EXPEDIENTE AUTORIZADO</p><h1>Expediente escolar</h1><p className="form-error" role="alert">No se pudo cargar el expediente escolar. Vuelve a intentarlo en unos minutos.</p></PortalShell>;
    }
  } else {
    const db = getDb();
    const record = await db.select({ id: students.id, givenName: students.givenName, familyName: students.familyName, birthDate: students.birthDate }).from(students).where(eq(students.id, id)).limit(1);
    student = record[0] ?? null;
    if (student && admin) [linkedGuardians, availableGuardians] = await Promise.all([
      db.select({ id: guardians.id, name: user.name, relationship: studentGuardians.relationship }).from(studentGuardians).innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId)).innerJoin(user, eq(user.id, guardians.userId)).where(eq(studentGuardians.studentId, id)),
      db.select({ id: guardians.id, name: user.name, email: user.email }).from(guardians).innerJoin(user, eq(user.id, guardians.userId)).where(eq(guardians.active, true)),
    ]);
  }
  if (!student) notFound();
  return <PortalShell name={actor.name} role={role} active="/alumnos"><p className="eyebrow">EXPEDIENTE AUTORIZADO</p><h1>{student.givenName} {student.familyName}</h1><section className="portal-panel"><h2>Datos escolares</h2>{student.birthDate && <p>Fecha de nacimiento: {student.birthDate}</p>}{admin ? <><h3>Tutores vinculados</h3>{linkedGuardians.length ? <ul className="record-list">{linkedGuardians.map(item => <li key={item.id}><strong>{item.name}</strong><span>{item.relationship}</span></li>)}</ul> : <p>Todavía no hay tutores vinculados.</p>}<GuardianLinkManager studentId={id} guardians={availableGuardians} /></> : <p>Tu cuenta solo puede consultar el expediente de este niño. Las observaciones y actividades aparecerán cuando las publique su maestra.</p>}</section></PortalShell>;
}
