import { env } from "@/lib/runtime/env";
import { createSchoolDatabaseClient } from "@/lib/supabase/database";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, asc, countDistinct, eq, isNull } from "drizzle-orm";
import { getSchoolPageActor } from "@/lib/supabase/page-actor";
import { hasRole } from "@/lib/access";
import { getDb } from "@/db";
import { enrollments, groups, students } from "@/db/schema";
import { StudentManager } from "./student-manager";
import { PortalShell } from "@/components/portal-shell";

export const dynamic = "force-dynamic";

type StudentRow = {
  id: string;
  givenName: string;
  familyName: string;
  birthDate: string | null;
  active: boolean;
  groupId: string | null;
  groupName: string | null;
};

export default async function Alumnos() {
  const actor = await getSchoolPageActor(await headers());
  if (!actor) redirect("/ingresar");
  const role = actor.roles[0];
  if (!role) redirect("/");
  if (!hasRole(actor, "superadmin", "direccion")) redirect("/");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) redirect("/ingresar");
    let schoolData: { groups: { id: string; name: string }[]; students: StudentRow[]; total: number } | null = null;
    try {
      const client = createSchoolDatabaseClient(env);
      const jwt = actor.supabaseAuth.accessToken;
      const [groupResult, studentResult] = await Promise.all([
        client.select<{ id: string; name: string }>(jwt, "groups", {
          columns: ["id", "name"], filters: [{ column: "active", operator: "eq", value: true }],
          orderBy: [{ column: "name" }, { column: "id" }], limit: 500,
        }),
        client.rpc<{ items: StudentRow[]; total: number }>(jwt, "school_list_students", {
          p_query: null, p_group_id: null, p_status: "activos", p_limit: 10, p_offset: 0,
        }),
      ]);
      const list = studentResult.data[0];
      if (!list || !Array.isArray(list.items) || !Number.isSafeInteger(list.total) || list.total < 0) throw new Error("invalid_student_directory");
      schoolData = { groups: groupResult.data, students: list.items, total: list.total };
    } catch { /* Render the unavailable state outside the data-loading block. */ }
    if (!schoolData) return <PortalShell name={actor.name} role={role} active="/alumnos"><p className="eyebrow">ADMINISTRACIÓN ESCOLAR</p><h1>Alumnos</h1><p className="form-error" role="alert">No se pudo cargar el directorio escolar. Vuelve a intentarlo en unos minutos.</p></PortalShell>;
    return <PortalShell name={actor.name} role={role} active="/alumnos"><p className="eyebrow">ADMINISTRACIÓN ESCOLAR</p><h1>Alumnos</h1><p className="page-intro">Registra a cada niño en su grupo. Estos datos solo serán visibles para las personas autorizadas.</p><StudentManager initialStudents={schoolData.students} initialTotal={schoolData.total} groups={schoolData.groups} /></PortalShell>;
  }
  const db = getDb();
  const [groupRecords, studentRecords, totals] = await Promise.all([
    db.select({ id: groups.id, name: groups.name }).from(groups).where(eq(groups.active, true)).orderBy(asc(groups.name)),
    db.select({ id: students.id, givenName: students.givenName, familyName: students.familyName, birthDate: students.birthDate, active: students.active, groupId: groups.id, groupName: groups.name }).from(students).leftJoin(enrollments, and(eq(enrollments.studentId, students.id), isNull(enrollments.endedAt))).leftJoin(groups, eq(groups.id, enrollments.groupId)).where(eq(students.active, true)).orderBy(asc(students.familyName), asc(students.givenName), asc(students.id)).limit(10),
    db.select({ total: countDistinct(students.id) }).from(students).where(eq(students.active, true)),
  ]);
  return <PortalShell name={actor.name} role={role} active="/alumnos"><p className="eyebrow">ADMINISTRACIÓN ESCOLAR</p><h1>Alumnos</h1><p className="page-intro">Registra a cada niño en su grupo. Estos datos solo serán visibles para las personas autorizadas.</p><StudentManager initialStudents={studentRecords} initialTotal={totals[0]?.total ?? 0} groups={groupRecords} /></PortalShell>;
}
