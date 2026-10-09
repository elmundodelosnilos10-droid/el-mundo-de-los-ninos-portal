import { env } from "@/lib/runtime/env";
import { and, asc, count, eq, isNull, like } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { auditLog, enrollments, groups, guardians, schoolYears, studentGuardians, students, teachers, teacherGroups } from "@/db/schema";
import { actorFromRequest, errorResponse, hasRole } from "@/lib/access";
import { paginationFrom, searchFrom } from "@/lib/pagination";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";
import { createSchoolDatabaseClient, SupabaseDatabaseError, type PostgrestFilter } from "@/lib/supabase/database";

const input = z.object({ yearId: z.uuid(), name: z.string().trim().min(1).max(60), stage: z.enum(["lactantes", "maternal", "prekinder", "preescolar"]) });

export async function GET(request: Request) {
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin", "direccion", "docente", "tutor")) return errorResponse(403, "No tienes permiso para consultar grupos.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    try {
      const client = createSchoolDatabaseClient(env);
      const isLeader = hasRole(actor, "superadmin", "direccion");
      const filters: PostgrestFilter[] = [];
      if (isLeader) {
        const { page, pageSize, offset } = paginationFrom(request);
        const params = new URL(request.url).searchParams;
        const query = searchFrom(request);
        const yearId = params.get("yearId");
        const stage = params.get("stage");
        const status = params.get("status");
        if (query) filters.push({ column: "name", operator: "ilike", value: `%${query.replace(/[\\%_]/g, "\\$&")}%` });
        if (yearId && yearId !== "todos") filters.push({ column: "year_id", operator: "eq", value: yearId });
        if (stage && stage !== "todas" && ["lactantes", "maternal", "prekinder", "preescolar"].includes(stage)) filters.push({ column: "stage", operator: "eq", value: stage });
        if (status === "activos") filters.push({ column: "active", operator: "eq", value: true });
        if (status === "inactivos") filters.push({ column: "active", operator: "eq", value: false });
        const { data, count: total } = await client.select(actor.supabaseAuth.accessToken, "groups", {
          columns: ["id", "year_id", "name", "stage", "active"], filters, orderBy: [{ column: "name" }, { column: "id" }], limit: pageSize, offset, count: "exact",
        });
        return Response.json({ items: data.map(mapSupabaseGroup), total: total ?? 0, page, pageSize }, { headers: { "Cache-Control": "no-store" } });
      }
      filters.push({ column: "active", operator: "eq", value: true });
      const { data } = await client.select(actor.supabaseAuth.accessToken, "groups", {
        columns: ["id", "year_id", "name", "stage", "active"], filters, orderBy: [{ column: "name" }], limit: 500,
      });
      return Response.json({ items: data.map(mapSupabaseGroup) }, { headers: { "Cache-Control": "no-store" } });
    } catch { return errorResponse(503, "No se pudieron consultar los grupos."); }
  }
  const db = getDb();
  let records;
  if (hasRole(actor, "superadmin", "direccion")) {
    const { page, pageSize, offset } = paginationFrom(request);
    const query = searchFrom(request);
    const params = new URL(request.url).searchParams;
    const where = [];
    if (query) where.push(like(groups.name, `%${query}%`));
    const yearId = params.get("yearId");
    const stage = params.get("stage");
    const status = params.get("status");
    if (yearId && yearId !== "todos") where.push(eq(groups.yearId, yearId));
    if (stage && stage !== "todas" && ["lactantes", "maternal", "prekinder", "preescolar"].includes(stage)) where.push(eq(groups.stage, stage as "lactantes" | "maternal" | "prekinder" | "preescolar"));
    if (status === "activos") where.push(eq(groups.active, true));
    if (status === "inactivos") where.push(eq(groups.active, false));
    const condition = where.length ? and(...where) : undefined;
    const [rows, totals] = await Promise.all([
      db.select().from(groups).where(condition).orderBy(asc(groups.name), asc(groups.id)).limit(pageSize).offset(offset),
      db.select({ total: count() }).from(groups).where(condition),
    ]);
    records = { items: rows, total: totals[0]?.total ?? 0, page, pageSize };
  }
  else if (hasRole(actor, "docente")) records = await db.selectDistinct({ id: groups.id, yearId: groups.yearId, name: groups.name, stage: groups.stage, active: groups.active }).from(groups).innerJoin(teacherGroups, eq(teacherGroups.groupId, groups.id)).innerJoin(teachers, eq(teachers.id, teacherGroups.teacherId)).where(and(eq(groups.active, true), eq(teachers.userId, actor.id), eq(teachers.active, true)));
  else records = await db.selectDistinct({ id: groups.id, yearId: groups.yearId, name: groups.name, stage: groups.stage, active: groups.active }).from(groups).innerJoin(enrollments, eq(enrollments.groupId, groups.id)).innerJoin(students, eq(students.id, enrollments.studentId)).innerJoin(studentGuardians, eq(studentGuardians.studentId, enrollments.studentId)).innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId)).where(and(eq(groups.active, true), eq(students.active, true), eq(guardians.userId, actor.id), eq(guardians.active, true), eq(studentGuardians.active, true), isNull(enrollments.endedAt)));
  if (records && !Array.isArray(records)) return Response.json(records, { headers: { "Cache-Control": "no-store" } });
  return Response.json({ items: records }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403, "Solicitud no válida.");
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin", "direccion")) return errorResponse(403, "No tienes permiso para crear grupos.");
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, "Revisa los datos del grupo.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    const id = crypto.randomUUID();
    try {
      await createSchoolDatabaseClient(env).rpc(actor.supabaseAuth.accessToken, "school_create_group", {
        p_id: id, p_year_id: parsed.data.yearId, p_name: parsed.data.name, p_stage: parsed.data.stage,
      });
      return Response.json({ id }, { status: 201, headers: { "Cache-Control": "no-store" } });
    } catch (cause) {
      if (cause instanceof SupabaseDatabaseError && cause.status === 409) return errorResponse(409, "Ya existe un grupo con ese nombre en el ciclo.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 404) return errorResponse(404, "El ciclo seleccionado no existe.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 403) return errorResponse(403, "No tienes permiso para crear grupos.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 400) return errorResponse(400, "Revisa los datos del grupo.");
      return errorResponse(503, "No se pudo guardar el grupo.");
    }
  }
  const db = getDb();
  const year = await db.select({ id: schoolYears.id }).from(schoolYears).where(eq(schoolYears.id, parsed.data.yearId)).limit(1);
  if (!year.length) return errorResponse(404, "El ciclo seleccionado no existe.");
  const id = crypto.randomUUID();
  try {
    await db.batch([
      db.insert(groups).values({ id, ...parsed.data }),
      db.insert(auditLog).values({ id: crypto.randomUUID(), actorId: actor.id, action: "create", entityType: "group", entityId: id, createdAt: new Date() }),
    ]);
  } catch { return errorResponse(409, "Ya existe un grupo con ese nombre en el ciclo."); }
  return Response.json({ id }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

function mapSupabaseGroup(row: Record<string, unknown>) {
  return { id: row.id, yearId: row.year_id, name: row.name, stage: row.stage, active: row.active };
}
