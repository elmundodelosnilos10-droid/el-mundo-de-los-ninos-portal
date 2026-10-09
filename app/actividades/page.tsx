import { env } from "@/lib/runtime/env";
import { createSchoolDatabaseClient } from "@/lib/supabase/database";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { getSchoolPageActor } from "@/lib/supabase/page-actor";
import { getDb } from "@/db";
import { enrollments, guardians, groups, students, studentGuardians } from "@/db/schema";
import { accessibleGroupIds, hasRole } from "@/lib/access";
import { PortalShell } from "@/components/portal-shell";
import { ActivityLibrary } from "./activity-library";

export const dynamic = "force-dynamic";

export default async function Actividades() {
  const actor = await getSchoolPageActor(await headers());
  if (!actor) redirect("/ingresar");
  const role = actor.roles[0];
  if (!role) redirect("/");
  let children: { id: string; name: string; groupName: string; stage: "lactantes" | "maternal" | "prekinder" | "preescolar" }[] = [];
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) redirect("/ingresar");
    try {
      const result = await createSchoolDatabaseClient(env).rpc<{ items: typeof children }>(actor.supabaseAuth.accessToken, "school_progress_students", {});
      if (!Array.isArray(result.data[0]?.items)) throw new Error("invalid_activity_students");
      children = result.data[0].items;
    } catch {
      return <PortalShell name={actor.name} role={role} active="/actividades"><p className="eyebrow">APRENDER JUGANDO</p><h1>Juegos y retos</h1><p className="form-error" role="alert">No se pudieron cargar los alumnos autorizados. Vuelve a intentarlo en unos minutos.</p></PortalShell>;
    }
  } else {
    const db = getDb();
    if (hasRole(actor, "tutor")) {
      children = await db.selectDistinct({ id: students.id, name: students.givenName, groupId: groups.id, groupName: groups.name, stage: groups.stage })
        .from(studentGuardians).innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
        .innerJoin(students, eq(students.id, studentGuardians.studentId)).innerJoin(enrollments, eq(enrollments.studentId, students.id))
        .innerJoin(groups, eq(groups.id, enrollments.groupId))
        .where(and(eq(guardians.userId, actor.id), eq(guardians.active, true), eq(studentGuardians.active, true), eq(students.active, true), isNull(enrollments.endedAt), eq(groups.active, true)));
    } else if (hasRole(actor, "superadmin", "direccion", "docente")) {
      // maySeeStudent remains the authoritative access check for the API; this list is limited to active enrollments.
      const all = await db.selectDistinct({ id: students.id, name: students.givenName, groupId: groups.id, groupName: groups.name, stage: groups.stage })
        .from(enrollments).innerJoin(students, eq(students.id, enrollments.studentId)).innerJoin(groups, eq(groups.id, enrollments.groupId))
        .where(and(isNull(enrollments.endedAt), eq(students.active, true), eq(groups.active, true)));
      if (hasRole(actor, "superadmin", "direccion")) children = all;
      else {
        const accessible = new Set(await accessibleGroupIds(actor));
        children = all.filter(child => accessible.has(child.groupId));
      }
    }
  }
  return <PortalShell name={actor.name} role={role} active="/actividades">
    <p className="eyebrow">APRENDER JUGANDO</p>
    <h1>Juegos y retos</h1>
    <p className="page-intro">Actividades cortas para explorar, crear y aprender en familia. Elige al niño para guardar sus logros.</p>
    <ActivityLibrary students={children} canPlay={hasRole(actor, "tutor")} />
  </PortalShell>;
}
