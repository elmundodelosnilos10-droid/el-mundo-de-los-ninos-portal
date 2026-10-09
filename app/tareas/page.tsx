import { env } from "@/lib/runtime/env";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getSchoolPageActor } from "@/lib/supabase/page-actor";
import { getDb } from "@/db";
import { enrollments, groups, guardians, students, studentGuardians } from "@/db/schema";
import { accessibleGroupIds, hasRole } from "@/lib/access";
import { createSchoolDatabaseClient } from "@/lib/supabase/database";
import { PortalShell } from "@/components/portal-shell";
import { TaskManager } from "./task-manager";
import { isFileScannerConfigured } from "@/lib/file-scanner";
import { isFileStorageConfigured } from "@/lib/file-storage";

export const dynamic = "force-dynamic";

type SupabaseGroup = { id: string; name: string };
type SupabaseStudent = { id: string; given_name: string; family_name: string };

export default async function Tareas() {
  const actor = await getSchoolPageActor(await headers());
  if (!actor) redirect("/ingresar");
  const role = actor.roles[0];
  if (!role) redirect("/");
  let groupsForUser: { id: string; name: string }[];
  let children: { id: string; name: string; familyName: string }[];
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) redirect("/ingresar");
    try {
      const client = createSchoolDatabaseClient(env);
      const groupResult = await client.select<SupabaseGroup>(actor.supabaseAuth.accessToken, "groups", {
        columns: ["id", "name"], filters: [{ column: "active", operator: "eq", value: true }], orderBy: [{ column: "name" }, { column: "id" }], limit: 500,
      });
      groupsForUser = groupResult.data;
      children = [];
      if (hasRole(actor, "tutor")) {
        const guardianResult = await client.select<{ id: string }>(actor.supabaseAuth.accessToken, "guardians", {
          columns: ["id"], filters: [
            { column: "user_id", operator: "eq", value: actor.supabaseAuth.userId },
            { column: "active", operator: "eq", value: true },
          ], limit: 50,
        });
        const guardianIds = guardianResult.data.map(row => row.id);
        const links: { student_id: string }[] = [];
        for (const ids of chunk(guardianIds, 100)) {
          const result = await client.select<{ student_id: string }>(actor.supabaseAuth.accessToken, "student_guardians", {
            columns: ["student_id"], filters: [
              { column: "guardian_id", operator: "in", value: ids },
              { column: "active", operator: "eq", value: true },
            ], orderBy: [{ column: "student_id" }], limit: 500,
          });
          links.push(...result.data);
        }
        const studentIds = [...new Set(links.map(row => row.student_id))];
        const activeEnrollmentIds = new Set<string>();
        for (const ids of chunk(studentIds, 100)) {
          const result = await client.select<{ student_id: string }>(actor.supabaseAuth.accessToken, "enrollments", {
            columns: ["student_id"], filters: [
              { column: "student_id", operator: "in", value: ids },
              { column: "ended_at", operator: "is", value: null },
            ], limit: 500,
          });
          for (const row of result.data) activeEnrollmentIds.add(row.student_id);
        }
        const activeStudentIds = studentIds.filter(id => activeEnrollmentIds.has(id));
        const students: SupabaseStudent[] = [];
        for (const ids of chunk(activeStudentIds, 100)) {
          const result = await client.select<SupabaseStudent>(actor.supabaseAuth.accessToken, "students", {
            columns: ["id", "given_name", "family_name"], filters: [
              { column: "id", operator: "in", value: ids },
              { column: "active", operator: "eq", value: true },
            ], orderBy: [{ column: "family_name" }, { column: "given_name" }], limit: 500,
          });
          students.push(...result.data);
        }
        children = students.map(student => ({ id: student.id, name: student.given_name, familyName: student.family_name }));
      }
    } catch {
      return <PortalShell name={actor.name} role={role} active="/tareas"><p className="eyebrow">APRENDER Y PRACTICAR</p><h1>Tareas y entregas</h1><p className="form-error" role="alert">No se pudieron cargar los grupos y alumnos desde Supabase. Inténtalo de nuevo en unos minutos.</p></PortalShell>;
    }
  } else {
    const db = getDb();
    const groupIds = await accessibleGroupIds(actor);
    groupsForUser = groupIds.length ? await db.select({ id: groups.id, name: groups.name }).from(groups).where(inArray(groups.id, groupIds)) : [];
    children = hasRole(actor, "tutor") ? await db.select({ id: students.id, name: students.givenName, familyName: students.familyName }).from(students).innerJoin(studentGuardians, eq(studentGuardians.studentId, students.id)).innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId)).innerJoin(enrollments, eq(enrollments.studentId, students.id)).where(and(eq(guardians.userId, actor.id), eq(guardians.active, true), eq(studentGuardians.active, true), eq(students.active, true), isNull(enrollments.endedAt))) : [];
  }
  return <PortalShell name={actor.name} role={role} active="/tareas"><p className="eyebrow">APRENDER Y PRACTICAR</p><h1>Tareas y entregas</h1><p className="page-intro">Instrucciones, fechas de entrega y evidencias para cada grupo.</p><TaskManager groups={groupsForUser} familyChildren={children} canCreate={hasRole(actor, "superadmin", "direccion", "docente")} canReview={hasRole(actor, "superadmin", "direccion", "docente")} uploadsReady={isFileStorageConfigured(env) && isFileScannerConfigured({ url: env.SCHOOL_FILE_SCAN_URL, token: env.SCHOOL_FILE_SCAN_TOKEN })} /></PortalShell>;
}

function chunk<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}
