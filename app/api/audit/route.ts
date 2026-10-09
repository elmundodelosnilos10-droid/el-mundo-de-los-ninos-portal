import { env } from "@/lib/runtime/env";
import { createSchoolDatabaseClient } from "@/lib/supabase/database";
import { readSchoolAudit } from "@/lib/supabase/operations";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLog, user } from "@/db/schema";
import { actorFromRequest, errorResponse, hasRole } from "@/lib/access";

export async function GET(request: Request) {
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin", "direccion")) return errorResponse(403, "No tienes permiso para consultar la auditoría.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth || actor.supabaseAuth.userId !== actor.id) return errorResponse(401, "Inicia sesión.");
    try {
      const items = await readSchoolAudit(createSchoolDatabaseClient(env), actor.supabaseAuth.accessToken);
      return Response.json({ items }, { headers: { "Cache-Control": "no-store" } });
    } catch { return errorResponse(503, "No se pudo cargar la auditoría. Vuelve a intentar en unos minutos."); }
  }
  const rows = await getDb().select({
    id: auditLog.id,
    actorName: user.name,
    action: auditLog.action,
    entityType: auditLog.entityType,
    entityId: auditLog.entityId,
    createdAt: auditLog.createdAt,
  }).from(auditLog).leftJoin(user, eq(user.id, auditLog.actorId)).orderBy(desc(auditLog.createdAt)).limit(100);
  return Response.json({ items: rows }, { headers: { "Cache-Control": "no-store" } });
}
