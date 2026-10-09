import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { env } from "@/lib/runtime/env";
import { getDb } from "@/db";
import { auditLog, guardians, studentGuardians, students, user } from "@/db/schema";
import { actorFromRequest, errorResponse, hasRole } from "@/lib/access";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";
import { createSchoolDatabaseClient, SupabaseDatabaseError } from "@/lib/supabase/database";
import { readStudentGuardians } from "@/lib/supabase/student-guardians";

const input = z.object({ guardianId: z.uuid(), relationship: z.string().trim().min(2).max(40), mayCollect: z.boolean().default(false) });
const unlinkInput = z.object({ guardianId: z.uuid() });

function supabaseRpcError(error: unknown) {
  if (error instanceof SupabaseDatabaseError) {
    if (error.status === 400) return errorResponse(400, "Revisa los datos del tutor.");
    if (error.status === 401) return errorResponse(401, "Inicia sesión.");
    if (error.status === 403) return errorResponse(403, "No tienes permiso para modificar los tutores.");
    if (error.status === 404) return errorResponse(404, "Alumno o tutor no disponible.");
    if (error.status === 409) return errorResponse(409, "Este tutor ya está vinculado con el alumno.");
  }
  return errorResponse(503, "No se pudo guardar la vinculación. Inténtalo de nuevo.");
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin", "direccion")) return errorResponse(403, "No tienes permiso para consultar tutores.");
  const { id } = await context.params;
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    try {
      const items = await readStudentGuardians(createSchoolDatabaseClient(env), actor.supabaseAuth.accessToken, id);
      return Response.json({ items }, { headers: { "Cache-Control": "no-store" } });
    } catch {
      return errorResponse(503, "No se pudieron consultar los tutores en Supabase.");
    }
  }
  const rows = await getDb().select({ id: guardians.id, name: user.name, relationship: studentGuardians.relationship, active: studentGuardians.active }).from(studentGuardians).innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId)).innerJoin(user, eq(user.id, guardians.userId)).where(eq(studentGuardians.studentId, id));
  return Response.json({ items: rows }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403, "Solicitud no válida.");
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin", "direccion")) return errorResponse(403, "No tienes permiso para vincular tutores.");
  const { id } = await context.params;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, "Revisa los datos del tutor.");

  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    try {
      const result = await createSchoolDatabaseClient(env).rpc<{ linked: boolean }>(actor.supabaseAuth.accessToken, "school_link_guardian", {
        p_student_id: id,
        p_guardian_id: parsed.data.guardianId,
        p_relationship: parsed.data.relationship,
        p_may_collect: parsed.data.mayCollect,
      });
      if (!result.data[0]?.linked) return errorResponse(503, "No se pudo confirmar la vinculación.");
      return Response.json({ linked: true }, { status: 201, headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return supabaseRpcError(error);
    }
  }

  const db = getDb();
  const [student, guardian] = await Promise.all([
    db.select({ id: students.id }).from(students).where(and(eq(students.id, id), eq(students.active, true))).limit(1),
    db.select({ id: guardians.id }).from(guardians).where(and(eq(guardians.id, parsed.data.guardianId), eq(guardians.active, true))).limit(1),
  ]);
  if (!student.length || !guardian.length) return errorResponse(404, "Alumno o tutor no disponible.");
  try {
    await db.batch([
      db.insert(studentGuardians).values({ studentId: id, guardianId: parsed.data.guardianId, relationship: parsed.data.relationship, mayCollect: parsed.data.mayCollect }),
      db.insert(auditLog).values({ id: crypto.randomUUID(), actorId: actor.id, action: "link_guardian", entityType: "student", entityId: id, createdAt: new Date() }),
    ]);
  } catch { return errorResponse(409, "Este tutor ya está vinculado con el alumno."); }
  return Response.json({ linked: true }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403, "Solicitud no válida.");
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin", "direccion")) return errorResponse(403, "No tienes permiso para desvincular tutores.");
  const { id } = await context.params;
  const parsed = unlinkInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, "Revisa los datos del tutor.");

  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    try {
      const result = await createSchoolDatabaseClient(env).rpc<{ unlinked: boolean }>(actor.supabaseAuth.accessToken, "school_unlink_guardian", {
        p_student_id: id,
        p_guardian_id: parsed.data.guardianId,
      });
      if (!result.data[0]?.unlinked) return errorResponse(404, "La vinculación no existe.");
      return Response.json({ unlinked: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return supabaseRpcError(error);
    }
  }

  const db = getDb();
  const existing = await db.select({ studentId: studentGuardians.studentId }).from(studentGuardians)
    .where(and(eq(studentGuardians.studentId, id), eq(studentGuardians.guardianId, parsed.data.guardianId))).limit(1);
  if (!existing.length) return errorResponse(404, "La vinculación no existe.");
  await db.batch([
    db.delete(studentGuardians).where(and(eq(studentGuardians.studentId, id), eq(studentGuardians.guardianId, parsed.data.guardianId))),
    db.insert(auditLog).values({ id: crypto.randomUUID(), actorId: actor.id, action: "unlink_guardian", entityType: "student", entityId: id, createdAt: new Date() }),
  ]);
  return Response.json({ unlinked: true }, { headers: { "Cache-Control": "no-store" } });
}
