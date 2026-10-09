import { env } from "@/lib/runtime/env";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getSchoolPageActor } from "@/lib/supabase/page-actor";
import { getDb } from "@/db";
import { enrollments, guardians, groups, students, studentGuardians } from "@/db/schema";
import { accessibleGroupIds, hasRole } from "@/lib/access";
import { createSchoolDatabaseClient } from "@/lib/supabase/database";
import { PortalShell } from "@/components/portal-shell";
import { ProgressManager } from "./progress-manager";
export const dynamic = "force-dynamic";

export default async function Seguimiento() {
  const actor = await getSchoolPageActor(await headers());
  if (!actor) redirect("/ingresar");
  const role = actor.roles[0];
  if (!role) redirect("/");
  let children: { id: string; name: string; familyName: string; groupName: string }[] = [];
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) redirect("/ingresar");
    try {
      const result = await createSchoolDatabaseClient(env).rpc<{ items: typeof children }>(actor.supabaseAuth.accessToken, "school_progress_students", {});
      if (!Array.isArray(result.data[0]?.items)) throw new Error("invalid_progress_students");
      children = result.data[0].items;
    } catch {
      return <PortalShell name={actor.name} role={role} active="/seguimiento"><p className="eyebrow">DESARROLLO Y APRENDIZAJE</p><h1>Seguimiento</h1><p className="form-error" role="alert">No se pudieron cargar los alumnos autorizados. Vuelve a intentarlo en unos minutos.</p></PortalShell>;
    }
  } else {
    const db = getDb();
    if (hasRole(actor, "tutor")) {
      children = await db.selectDistinct({ id: students.id, name: students.givenName, familyName: students.familyName, groupName: groups.name })
        .from(studentGuardians).innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
        .innerJoin(students, eq(students.id, studentGuardians.studentId)).innerJoin(enrollments, eq(enrollments.studentId, students.id))
        .innerJoin(groups, eq(groups.id, enrollments.groupId))
        .where(and(eq(guardians.userId, actor.id), eq(guardians.active, true), eq(studentGuardians.active, true), eq(students.active, true), isNull(enrollments.endedAt)));
    } else if (hasRole(actor, "superadmin", "direccion", "docente")) {
      const ids = await accessibleGroupIds(actor);
      if (ids.length) children = await db.selectDistinct({ id: students.id, name: students.givenName, familyName: students.familyName, groupName: groups.name })
        .from(enrollments).innerJoin(students, eq(students.id, enrollments.studentId)).innerJoin(groups, eq(groups.id, enrollments.groupId))
        .where(and(inArray(enrollments.groupId, ids), isNull(enrollments.endedAt), eq(students.active, true)));
    }
  }
  return <PortalShell name={actor.name} role={role} active="/seguimiento"><p className="eyebrow">DESARROLLO Y APRENDIZAJE</p><h1>Seguimiento</h1><p className="page-intro">Observaciones del desarrollo y avances, con información visible solo para la familia autorizada y el equipo escolar.</p><ProgressManager students={children} canWrite={hasRole(actor, "superadmin", "direccion", "docente")} /></PortalShell>;
}
