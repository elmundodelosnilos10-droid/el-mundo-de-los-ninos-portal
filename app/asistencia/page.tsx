import { env } from "@/lib/runtime/env";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getSchoolPageActor } from "@/lib/supabase/page-actor";
import { getDb } from "@/db";
import { enrollments, guardians, groups, students, studentGuardians } from "@/db/schema";
import { accessibleGroupIds, hasRole } from "@/lib/access";
import { PortalShell } from "@/components/portal-shell";
import { AttendanceManager } from "./attendance-manager";
import { createSchoolDatabaseClient } from "@/lib/supabase/database";

export const dynamic = "force-dynamic";

type GroupRow = { id: string; name: string };
type EnrollmentRow = { student_id: string; group_id: string };
type StudentRow = { id: string; given_name: string; family_name: string };
type GuardianLinkRow = { student_id: string };

export default async function Asistencia() {
  const actor = await getSchoolPageActor(await headers());
  if (!actor) redirect("/ingresar");
  const role = actor.roles[0];
  if (!role) redirect("/");
  const canEdit = hasRole(actor, "superadmin", "direccion", "docente");

  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) redirect("/ingresar");
    let supabaseData: { groups: GroupRow[]; historyStudents: { id: string; name: string; familyName: string; groupId: string | null }[] } | null = null;
    try {
      const client = createSchoolDatabaseClient(env);
      const jwt = actor.supabaseAuth.accessToken;
      const groupsResult = await client.select<{ id: string; name: string }>(jwt, "groups", {
        columns: ["id", "name"], filters: [{ column: "active", operator: "eq", value: true }], orderBy: [{ column: "name" }, { column: "id" }], limit: 500,
      });
      const groupRows: GroupRow[] = groupsResult.data;
      const enrollmentRows: EnrollmentRow[] = [];
      const guardianLinks: GuardianLinkRow[] = [];

      if (canEdit && groupRows.length) {
        for (const groupIds of chunk(groupRows.map(group => group.id), 100)) {
          let offset = 0;
          while (offset < 100_000) {
            const result = await client.select<EnrollmentRow>(jwt, "enrollments", {
              columns: ["student_id", "group_id"],
              filters: [
                { column: "group_id", operator: "in", value: groupIds },
                { column: "ended_at", operator: "is", value: null },
              ],
              orderBy: [{ column: "student_id" }, { column: "group_id" }], limit: 500, offset,
            });
            enrollmentRows.push(...result.data);
            if (result.data.length < 500) break;
            offset += 500;
          }
        }
      } else if (hasRole(actor, "tutor")) {
        const guardianResult = await client.select<{ id: string }>(jwt, "guardians", {
          columns: ["id"], filters: [
            { column: "user_id", operator: "eq", value: actor.supabaseAuth.userId },
            { column: "active", operator: "eq", value: true },
          ], limit: 50,
        });
        for (const guardianIds of chunk(guardianResult.data.map(row => row.id), 100)) {
          let offset = 0;
          while (offset < 100_000) {
            const result = await client.select<GuardianLinkRow>(jwt, "student_guardians", {
              columns: ["student_id"], filters: [
                { column: "guardian_id", operator: "in", value: guardianIds },
                { column: "active", operator: "eq", value: true },
              ], orderBy: [{ column: "student_id" }], limit: 500, offset,
            });
            guardianLinks.push(...result.data);
            if (result.data.length < 500) break;
            offset += 500;
          }
        }
      }

      const studentIds = [...new Set((canEdit ? enrollmentRows.map(row => row.student_id) : guardianLinks.map(row => row.student_id)))];
      const studentRows: StudentRow[] = [];
      for (const ids of chunk(studentIds, 100)) {
        const result = await client.select<StudentRow>(jwt, "students", {
          columns: ["id", "given_name", "family_name"], filters: [
            { column: "id", operator: "in", value: ids },
            { column: "active", operator: "eq", value: true },
          ], orderBy: [{ column: "family_name" }, { column: "given_name" }, { column: "id" }], limit: 500,
        });
        studentRows.push(...result.data);
      }
      const studentsById = new Map(studentRows.map(student => [student.id, student]));
      const historyStudents = canEdit
        ? enrollmentRows.flatMap(enrollment => {
            const student = studentsById.get(enrollment.student_id);
            return student ? [{ id: student.id, name: student.given_name, familyName: student.family_name, groupId: enrollment.group_id }] : [];
          })
        : [...new Set(guardianLinks.map(link => link.student_id))].flatMap(id => {
            const student = studentsById.get(id);
            return student ? [{ id: student.id, name: student.given_name, familyName: student.family_name, groupId: null }] : [];
          });
      supabaseData = { groups: groupRows, historyStudents };
    } catch {
      // Render the error state below, outside the data-loading try/catch.
    }
    if (!supabaseData) {
      return <PortalShell name={actor.name} role={role} active="/asistencia"><p className="eyebrow">CONTROL ESCOLAR</p><h1>Asistencia</h1><p className="form-error" role="alert">No se pudieron cargar los grupos y alumnos desde Supabase. Vuelve a intentarlo en unos minutos.</p></PortalShell>;
    }
    return <PortalShell name={actor.name} role={role} active="/asistencia"><p className="eyebrow">CONTROL ESCOLAR</p><h1>Asistencia</h1><p className="page-intro">Registro diario, historial individual y consulta familiar.</p><AttendanceManager groups={supabaseData.groups} historyStudents={supabaseData.historyStudents.map(student => ({ ...student, displayName: `${student.name} ${student.familyName}` }))} canEdit={canEdit} canReportAll={hasRole(actor, "superadmin", "direccion")} /></PortalShell>;
  }

  const db = getDb();
  const groupIds = await accessibleGroupIds(actor);
  const groupRows = groupIds.length ? await db.select({ id: groups.id, name: groups.name }).from(groups).where(inArray(groups.id, groupIds)) : [];
  const historyStudents = canEdit
    ? groupIds.length ? await db.selectDistinct({ id: students.id, name: students.givenName, familyName: students.familyName, groupId: enrollments.groupId }).from(enrollments).innerJoin(students, eq(students.id, enrollments.studentId)).where(and(inArray(enrollments.groupId, groupIds), isNull(enrollments.endedAt), eq(students.active, true))) : []
    : hasRole(actor, "tutor") ? await db.selectDistinct({ id: students.id, name: students.givenName, familyName: students.familyName, groupId: enrollments.groupId }).from(studentGuardians).innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId)).innerJoin(students, eq(students.id, studentGuardians.studentId)).leftJoin(enrollments, and(eq(enrollments.studentId, students.id), isNull(enrollments.endedAt))).where(and(eq(guardians.userId, actor.id), eq(guardians.active, true), eq(studentGuardians.active, true), eq(students.active, true))) : [];

  return <PortalShell name={actor.name} role={role} active="/asistencia"><p className="eyebrow">CONTROL ESCOLAR</p><h1>Asistencia</h1><p className="page-intro">Registro diario, historial individual y consulta familiar.</p><AttendanceManager groups={groupRows} historyStudents={historyStudents.map(student => ({ ...student, displayName: `${student.name} ${student.familyName}` }))} canEdit={canEdit} canReportAll={hasRole(actor, "superadmin", "direccion")} /></PortalShell>;
}

function chunk<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}
