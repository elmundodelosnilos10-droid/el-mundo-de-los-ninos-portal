import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { auditLog, enrollments, groups, students } from "@/db/schema";
import { actorFromRequest, errorResponse, hasRole, maySeeStudent } from "@/lib/access";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";
import { env } from "@/lib/runtime/env";
import { createSchoolDatabaseClient, SupabaseDatabaseError } from "@/lib/supabase/database";

const profileInput = z.object({ givenName: z.string().trim().min(1).max(100), familyName: z.string().trim().min(1).max(100), birthDate: z.union([z.iso.date(), z.null()]).optional() });
const statusInput = z.object({ active: z.boolean(), groupId: z.uuid().optional() });

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  const { id } = await context.params;
  if (!(await maySeeStudent(actor, id))) return errorResponse(404, "Alumno no disponible.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(401, "Inicia sesión.");
    try {
      const result = await createSchoolDatabaseClient(env).select<{ id: string; given_name: string; family_name: string; birth_date: string | null }>(actor.supabaseAuth.accessToken, "students", {
        columns: ["id", "given_name", "family_name", "birth_date"],
        filters: [{ column: "id", operator: "eq", value: id }], limit: 1,
      });
      const student = result.data.find(row => row.id === id);
      if (!student) return errorResponse(404, "Alumno no disponible.");
      return Response.json({ id: student.id, givenName: student.given_name, familyName: student.family_name, birthDate: student.birth_date }, { headers: { "Cache-Control": "no-store" } });
    } catch { return errorResponse(503, "No se pudo consultar al alumno."); }
  }
  const record = await getDb().select({ id: students.id, givenName: students.givenName, familyName: students.familyName, birthDate: students.birthDate }).from(students).where(eq(students.id, id)).limit(1);
  if (!record.length) return errorResponse(404, "Alumno no disponible.");
  return Response.json(record[0], { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403, "Solicitud no válida.");
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin", "direccion")) return errorResponse(403, "Solo dirección puede editar datos del alumno.");
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return errorResponse(400, "Revisa los datos del alumno.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(401, "Inicia sesión.");
    if (!z.uuid().safeParse(id).success) return errorResponse(400, "El alumno seleccionado no es válido.");
    try {
      const client = createSchoolDatabaseClient(env);
      if (Object.hasOwn(body, "active")) {
        const parsed = statusInput.safeParse(body);
        if (!parsed.success || (parsed.data.active && !parsed.data.groupId)) return errorResponse(400, "Selecciona el estado y, para reactivar, un grupo válido.");
        await client.rpc(actor.supabaseAuth.accessToken, "school_set_student_active", {
          p_student_id: id, p_active: parsed.data.active,
          p_group_id: parsed.data.active ? parsed.data.groupId : null,
          p_enrollment_id: parsed.data.active ? crypto.randomUUID() : null,
        });
        return Response.json({ updated: true, active: parsed.data.active }, { headers: { "Cache-Control": "no-store" } });
      }
      const parsed = profileInput.safeParse(body);
      if (!parsed.success) return errorResponse(400, "Revisa el nombre, los apellidos y la fecha de nacimiento.");
      await client.rpc(actor.supabaseAuth.accessToken, "school_update_student", {
        p_student_id: id, p_given_name: parsed.data.givenName, p_family_name: parsed.data.familyName,
        p_birth_date: parsed.data.birthDate ?? null, p_replace_birth_date: Object.hasOwn(parsed.data, "birthDate"),
      });
      return Response.json({ updated: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (cause) {
      if (cause instanceof SupabaseDatabaseError && cause.status === 404) return errorResponse(404, "Alumno o grupo no disponible.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 403) return errorResponse(403, "Solo dirección puede editar datos del alumno.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 400) return errorResponse(400, "Revisa los datos del alumno y el grupo seleccionado.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 409) return errorResponse(409, "El alumno ya tiene ese estado o su matrícula requiere revisión.");
      return errorResponse(503, "No se pudo actualizar al alumno.");
    }
  }
  const db = getDb();
  if (Object.hasOwn(body, "active")) {
    const parsedStatus = statusInput.safeParse(body);
    if (!parsedStatus.success) return errorResponse(400, "Selecciona el estado y, para reactivar, un grupo válido.");
    const existing = await db.select({ active: students.active }).from(students).where(eq(students.id, id)).limit(1);
    if (!existing.length) return errorResponse(404, "Alumno no disponible.");
    if (existing[0].active === parsedStatus.data.active) return errorResponse(409, parsedStatus.data.active ? "El alumno ya está activo." : "El alumno ya tiene baja lógica.");
    const now = new Date();
    if (!parsedStatus.data.active) {
      await db.batch([
        db.update(students).set({ active: false, updatedAt: now }).where(eq(students.id, id)),
        db.update(enrollments).set({ endedAt: now }).where(and(eq(enrollments.studentId, id), isNull(enrollments.endedAt))),
        db.insert(auditLog).values({ id: crypto.randomUUID(), actorId: actor.id, action: "deactivate", entityType: "student", entityId: id, createdAt: now }),
      ]);
    } else {
      if (!parsedStatus.data.groupId) return errorResponse(400, "Selecciona un grupo para reactivar al alumno.");
      const group = await db.select({ id: groups.id }).from(groups).where(and(eq(groups.id, parsedStatus.data.groupId), eq(groups.active, true))).limit(1);
      if (!group.length) return errorResponse(404, "El grupo seleccionado no existe o no está activo.");
      await db.batch([
        db.update(students).set({ active: true, updatedAt: now }).where(eq(students.id, id)),
        db.insert(enrollments).values({ id: crypto.randomUUID(), studentId: id, groupId: parsedStatus.data.groupId, enrolledAt: now }),
        db.insert(auditLog).values({ id: crypto.randomUUID(), actorId: actor.id, action: "reactivate", entityType: "student", entityId: id, createdAt: now }),
      ]);
    }
    return Response.json({ updated: true, active: parsedStatus.data.active }, { headers: { "Cache-Control": "no-store" } });
  }
  const parsed = profileInput.safeParse(body);
  if (!parsed.success) return errorResponse(400, "Revisa el nombre, los apellidos y la fecha de nacimiento.");
  const existing = await db.select({ id: students.id }).from(students).where(eq(students.id, id)).limit(1);
  if (!existing.length) return errorResponse(404, "Alumno no disponible.");
  const now = new Date();
  await db.batch([
    db.update(students).set({ givenName: parsed.data.givenName, familyName: parsed.data.familyName, ...(Object.hasOwn(parsed.data, "birthDate") ? { birthDate: parsed.data.birthDate ?? null } : {}), updatedAt: now }).where(eq(students.id, id)),
    db.insert(auditLog).values({ id: crypto.randomUUID(), actorId: actor.id, action: "update", entityType: "student", entityId: id, createdAt: now }),
  ]);
  return Response.json({ updated: true }, { headers: { "Cache-Control": "no-store" } });
}
