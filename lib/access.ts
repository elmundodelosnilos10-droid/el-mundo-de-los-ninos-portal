import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { enrollments, groups, guardians, studentGuardians, students, teacherGroups, teachers, user, userRoles } from "@/db/schema";
import { getSchoolSession, readVerifiedSupabaseSchoolAccount } from "@/lib/supabase/session";
import { env } from "@/lib/runtime/env";
import { createSchoolDatabaseClient } from "@/lib/supabase/database";
import { createSupabaseSchoolAccess } from "@/lib/supabase/access";

export type SchoolRole = "superadmin" | "direccion" | "docente" | "tutor" | "alumno";
export type Actor = {
  id: string;
  name: string;
  email: string;
  roles: SchoolRole[];
  supabaseAuth?: { userId: string; accessToken: string } | null;
};

export async function actorFromRequest(request: Request): Promise<Actor | null> {
  const session = await getSchoolSession(request.headers);
  if (!session?.user) return null;
  const sessionContext = session.session as typeof session.session & { supabaseAuthUserId?: unknown; supabaseAccessToken?: unknown };
  const supabaseAuth = typeof sessionContext.supabaseAuthUserId === "string" && typeof sessionContext.supabaseAccessToken === "string"
    ? { userId: sessionContext.supabaseAuthUserId, accessToken: sessionContext.supabaseAccessToken }
    : null;
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!supabaseAuth || supabaseAuth.userId !== session.user.id) return null;
    try {
      const account = readVerifiedSupabaseSchoolAccount(session);
      return account && account.id === supabaseAuth.userId ? { id: account.id, name: account.name, email: account.email, roles: [...account.roles], supabaseAuth } : null;
    } catch {
      return null;
    }
  }
  const db = getDb();
  const account = await db.select({ active: user.active }).from(user).where(eq(user.id, session.user.id)).limit(1);
  if (!account[0]?.active) return null;
  const roles = await db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, session.user.id));
  return { id: session.user.id, name: session.user.name, email: session.user.email, roles: roles.map((r) => r.role), supabaseAuth };
}

export function hasRole(actor: Actor, ...roles: SchoolRole[]) {
  return roles.some((role) => actor.roles.includes(role));
}

export async function maySeeStudent(actor: Actor, studentId: string) {
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    return createSupabaseSchoolAccess(createSchoolDatabaseClient(env)).maySeeStudent(actor, studentId);
  }
  if (hasRole(actor, "superadmin", "direccion")) return true;
  const db = getDb();
  const activeStudent = await db.select({ id: students.id }).from(students).where(and(eq(students.id, studentId), eq(students.active, true))).limit(1);
  if (!activeStudent.length) return false;
  if (hasRole(actor, "tutor")) {
    const guardian = await db.select({ id: guardians.id }).from(guardians).where(and(eq(guardians.userId, actor.id), eq(guardians.active, true))).limit(1);
    if (guardian.length) {
      const link = await db.select({ studentId: studentGuardians.studentId }).from(studentGuardians).where(and(eq(studentGuardians.guardianId, guardian[0].id), eq(studentGuardians.studentId, studentId), eq(studentGuardians.active, true))).limit(1);
      if (link.length) return true;
    }
  }
  if (hasRole(actor, "docente")) {
    const teacher = await db.select({ id: teachers.id }).from(teachers).where(and(eq(teachers.userId, actor.id), eq(teachers.active, true))).limit(1);
    if (teacher.length) {
      const group = await db.select({ groupId: teacherGroups.groupId }).from(teacherGroups)
        .innerJoin(enrollments, eq(enrollments.groupId, teacherGroups.groupId))
        .where(and(eq(teacherGroups.teacherId, teacher[0].id), eq(enrollments.studentId, studentId), isNull(enrollments.endedAt))).limit(1);
      if (group.length) return true;
    }
  }
  return false;
}

export async function maySeeGroup(actor: Actor, groupId: string) {
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    return createSupabaseSchoolAccess(createSchoolDatabaseClient(env)).maySeeGroup(actor, groupId);
  }
  if (hasRole(actor, "superadmin", "direccion")) return true;
  const db = getDb();
  if (hasRole(actor, "docente")) {
    const rows = await db.select({ id: teacherGroups.groupId }).from(teacherGroups).innerJoin(teachers, eq(teachers.id, teacherGroups.teacherId))
      .where(and(eq(teacherGroups.groupId, groupId), eq(teachers.userId, actor.id), eq(teachers.active, true))).limit(1);
    if (rows.length) return true;
  }
  if (hasRole(actor, "tutor")) {
    const rows = await db.select({ id: enrollments.groupId }).from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .innerJoin(studentGuardians, eq(studentGuardians.studentId, students.id))
      .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
      .where(and(eq(enrollments.groupId, groupId), isNull(enrollments.endedAt), eq(students.active, true), eq(studentGuardians.active, true), eq(guardians.userId, actor.id), eq(guardians.active, true))).limit(1);
    if (rows.length) return true;
  }
  return false;
}

export async function mayTeachGroup(actor: Actor, groupId: string) {
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    return createSupabaseSchoolAccess(createSchoolDatabaseClient(env)).mayTeachGroup(actor, groupId);
  }
  if (hasRole(actor, "superadmin", "direccion")) return true;
  if (!hasRole(actor, "docente")) return false;
  const rows = await getDb().select({ id: teacherGroups.groupId }).from(teacherGroups).innerJoin(teachers, eq(teachers.id, teacherGroups.teacherId))
    .where(and(eq(teacherGroups.groupId, groupId), eq(teachers.userId, actor.id), eq(teachers.active, true))).limit(1);
  return rows.length > 0;
}

export async function accessibleGroupIds(actor: Actor) {
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    return createSupabaseSchoolAccess(createSchoolDatabaseClient(env)).accessibleGroupIds(actor);
  }
  const db = getDb();
  if (hasRole(actor, "superadmin", "direccion")) return (await db.select({ id: groups.id }).from(groups).where(eq(groups.active, true))).map(row => row.id);
  if (hasRole(actor, "docente")) return (await db.selectDistinct({ id: groups.id }).from(teacherGroups).innerJoin(groups, eq(groups.id, teacherGroups.groupId)).innerJoin(teachers, eq(teachers.id, teacherGroups.teacherId)).where(and(eq(groups.active, true), eq(teachers.userId, actor.id), eq(teachers.active, true)))).map(row => row.id);
  if (hasRole(actor, "tutor")) return (await db.selectDistinct({ id: groups.id }).from(enrollments).innerJoin(groups, eq(groups.id, enrollments.groupId)).innerJoin(students, eq(students.id, enrollments.studentId)).innerJoin(studentGuardians, eq(studentGuardians.studentId, students.id)).innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId)).where(and(eq(groups.active, true), isNull(enrollments.endedAt), eq(students.active, true), eq(studentGuardians.active, true), eq(guardians.userId, actor.id), eq(guardians.active, true)))).map(row => row.id);
  return [];
}

export function errorResponse(status: 400 | 401 | 403 | 404 | 409 | 413 | 500 | 503, message: string) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}
