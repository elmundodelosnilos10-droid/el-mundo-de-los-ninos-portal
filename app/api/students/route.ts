import { env } from "@/lib/runtime/env";
import { and, asc, countDistinct, eq, isNull, like, or } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { auditLog, enrollments, groups, guardians, studentGuardians, students, teacherGroups, teachers } from "@/db/schema";
import { actorFromRequest, errorResponse, hasRole } from "@/lib/access";
import { paginationFrom, searchFrom } from "@/lib/pagination";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";
import { createSchoolDatabaseClient, SupabaseDatabaseError } from "@/lib/supabase/database";

const input = z.object({ givenName: z.string().trim().min(1).max(100), familyName: z.string().trim().min(1).max(100), birthDate: z.iso.date().optional(), groupId: z.uuid() });

export async function GET(request: Request) {
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    const client = createSchoolDatabaseClient(env);
    const adminMode = hasRole(actor, "superadmin", "direccion");
    try {
      if (adminMode) {
        const { pageSize, offset } = paginationFrom(request);
        const query = searchFrom(request);
        const params = new URL(request.url).searchParams;
        const groupFilter = params.get("groupId");
        const groupId = groupFilter && groupFilter !== "todos" ? z.uuid().safeParse(groupFilter) : null;
        if (groupId && !groupId.success) return errorResponse(400, "El filtro de grupo no es válido.");
        const statusValue = params.get("status");
        const status = statusValue === "activos" || statusValue === "inactivos" ? statusValue : "todos";
        const result = await client.rpc<{ items: Array<{ id: string; givenName: string; familyName: string; birthDate: string | null; active: boolean; groupId: string | null; groupName: string | null }>; total: number; page: number; pageSize: number }>(actor.supabaseAuth.accessToken, "school_list_students", {
          p_query: query || null, p_group_id: groupId?.success ? groupId.data : null, p_status: status, p_limit: pageSize, p_offset: offset,
        });
        const list = result.data[0];
        if (!list || !Array.isArray(list.items) || !Number.isSafeInteger(list.total)) return errorResponse(503, "No se pudo consultar el directorio de alumnos.");
        return Response.json(list, { headers: { "Cache-Control": "no-store" } });
      }
      if (!hasRole(actor, "tutor", "docente")) return errorResponse(403, "No tienes permiso para consultar alumnos.");
      const { data } = await client.select<{ id: string; given_name: string; family_name: string }>(actor.supabaseAuth.accessToken, "students", {
        columns: ["id", "given_name", "family_name"], filters: [{ column: "active", operator: "eq", value: true }], orderBy: [{ column: "family_name" }, { column: "given_name" }, { column: "id" }], limit: 500,
      });
      return Response.json({ items: data.map(student => ({ id: student.id, givenName: student.given_name, familyName: student.family_name })) }, { headers: { "Cache-Control": "no-store" } });
    } catch { return errorResponse(503, "No se pudo consultar el directorio de alumnos."); }
  }
  const db = getDb();
  const { page, pageSize, offset } = paginationFrom(request);
  const query = searchFrom(request);
  const params = new URL(request.url).searchParams;
  const groupFilter = params.get("groupId");
  const statusFilter = params.get("status");
  const adminMode = hasRole(actor, "superadmin", "direccion");
  let records;
  let total = 0;
  if (adminMode) {
    const where = [];
    if (query) where.push(or(like(students.givenName, `%${query}%`), like(students.familyName, `%${query}%`))!);
    if (groupFilter && groupFilter !== "todos") where.push(eq(groups.id, groupFilter));
    if (statusFilter === "activos") where.push(eq(students.active, true));
    if (statusFilter === "inactivos") where.push(eq(students.active, false));
    const condition = where.length ? and(...where) : undefined;
    const [rows, totals] = await Promise.all([
      db.selectDistinct({ id: students.id, givenName: students.givenName, familyName: students.familyName, birthDate: students.birthDate, active: students.active, groupId: groups.id, groupName: groups.name }).from(students).leftJoin(enrollments, and(eq(enrollments.studentId, students.id), isNull(enrollments.endedAt))).leftJoin(groups, eq(groups.id, enrollments.groupId)).where(condition).orderBy(asc(students.familyName), asc(students.givenName), asc(students.id)).limit(pageSize).offset(offset),
      db.select({ total: countDistinct(students.id) }).from(students).leftJoin(enrollments, and(eq(enrollments.studentId, students.id), isNull(enrollments.endedAt))).leftJoin(groups, eq(groups.id, enrollments.groupId)).where(condition),
    ]);
    records = rows;
    total = totals[0]?.total ?? 0;
  } else if (hasRole(actor, "tutor")) {
    records = await db.selectDistinct({ id: students.id, givenName: students.givenName, familyName: students.familyName }).from(students)
      .innerJoin(studentGuardians, eq(studentGuardians.studentId, students.id))
      .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
      .where(and(eq(guardians.userId, actor.id), eq(guardians.active, true), eq(studentGuardians.active, true), eq(students.active, true)));
  } else if (hasRole(actor, "docente")) {
    records = await db.selectDistinct({ id: students.id, givenName: students.givenName, familyName: students.familyName }).from(students)
      .innerJoin(enrollments, eq(enrollments.studentId, students.id))
      .innerJoin(teacherGroups, eq(teacherGroups.groupId, enrollments.groupId))
      .innerJoin(teachers, eq(teachers.id, teacherGroups.teacherId))
      .where(and(eq(teachers.userId, actor.id), eq(teachers.active, true), isNull(enrollments.endedAt), eq(students.active, true)));
  } else return errorResponse(403, "No tienes permiso para consultar alumnos.");
  if (!adminMode) return Response.json({ items: records }, { headers: { "Cache-Control": "no-store" } });
  return Response.json({ items: records, total, page, pageSize }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403, "Solicitud no válida.");
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin", "direccion")) return errorResponse(403, "No tienes permiso para registrar alumnos.");
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, "Revisa el nombre, la fecha y el grupo.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    try {
      const id = crypto.randomUUID();
      await createSchoolDatabaseClient(env).rpc(actor.supabaseAuth.accessToken, "school_create_student", {
        p_id: id, p_enrollment_id: crypto.randomUUID(), p_given_name: parsed.data.givenName,
        p_family_name: parsed.data.familyName, p_birth_date: parsed.data.birthDate ?? null, p_group_id: parsed.data.groupId,
      });
      return Response.json({ id }, { status: 201, headers: { "Cache-Control": "no-store" } });
    } catch (cause) {
      if (cause instanceof SupabaseDatabaseError && cause.status === 404) return errorResponse(404, "El grupo seleccionado no existe o no está activo.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 403) return errorResponse(403, "No tienes permiso para registrar alumnos.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 400) return errorResponse(400, "Revisa el nombre, la fecha y el grupo.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 409) return errorResponse(409, "No se pudo registrar el alumno en el grupo seleccionado.");
      return errorResponse(503, "No se pudo registrar al alumno.");
    }
  }
  const db = getDb();
  const group = await db.select({ id: groups.id }).from(groups).where(and(eq(groups.id, parsed.data.groupId), eq(groups.active, true))).limit(1);
  if (!group.length) return errorResponse(404, "El grupo seleccionado no existe o no está activo.");
  const id = crypto.randomUUID();
  const now = new Date();
  await db.batch([
    db.insert(students).values({ id, givenName: parsed.data.givenName, familyName: parsed.data.familyName, birthDate: parsed.data.birthDate, createdAt: now, updatedAt: now }),
    db.insert(enrollments).values({ id: crypto.randomUUID(), studentId: id, groupId: parsed.data.groupId, enrolledAt: now }),
    db.insert(auditLog).values({ id: crypto.randomUUID(), actorId: actor.id, action: "create", entityType: "student", entityId: id, createdAt: now }),
  ]);
  return Response.json({ id }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
