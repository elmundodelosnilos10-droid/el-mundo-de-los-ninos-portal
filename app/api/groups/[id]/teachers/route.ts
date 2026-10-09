import { env } from "@/lib/runtime/env";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { auditLog, groups, teacherGroups, teachers } from "@/db/schema";
import { actorFromRequest, errorResponse, hasRole } from "@/lib/access";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";
import { createSchoolDatabaseClient, SupabaseDatabaseError } from "@/lib/supabase/database";

const input = z.object({ teacherId: z.uuid() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403, "Solicitud no válida.");
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin", "direccion")) return errorResponse(403, "No tienes permiso para asignar docentes.");
  const { id: groupId } = await context.params;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, "Selecciona una maestra.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    try {
      const result = await createSchoolDatabaseClient(env).rpc<Record<string, unknown>>(actor.supabaseAuth.accessToken, "school_assign_teacher_to_group", {
        p_group_id: groupId, p_teacher_id: parsed.data.teacherId,
      });
      if (!result.data[0]?.assigned) return errorResponse(503, "No se pudo confirmar la asignación.");
      return Response.json({ assigned: true }, { status: 201, headers: { "Cache-Control": "no-store" } });
    } catch (cause) {
      if (cause instanceof SupabaseDatabaseError && cause.status === 403) return errorResponse(403, "No tienes permiso para asignar docentes.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 404) return errorResponse(404, "Grupo o docente no disponible.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 400) return errorResponse(400, "Selecciona una maestra.");
      return errorResponse(503, "No se pudo asignar la maestra.");
    }
  }
  const db = getDb();
  const [group, teacher] = await Promise.all([
    db.select({ id: groups.id }).from(groups).where(and(eq(groups.id, groupId), eq(groups.active, true))).limit(1),
    db.select({ id: teachers.id }).from(teachers).where(and(eq(teachers.id, parsed.data.teacherId), eq(teachers.active, true))).limit(1),
  ]);
  if (!group.length || !teacher.length) return errorResponse(404, "Grupo o docente no disponible.");
  await db.batch([
    db.insert(teacherGroups).values({ teacherId: parsed.data.teacherId, groupId }).onConflictDoNothing(),
    db.insert(auditLog).values({ id: crypto.randomUUID(), actorId: actor.id, action: "assign_teacher", entityType: "group", entityId: groupId, createdAt: new Date() }),
  ]);
  return Response.json({ assigned: true }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
