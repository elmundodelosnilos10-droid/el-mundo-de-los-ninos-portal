import { env } from "@/lib/runtime/env";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { teachers, user } from "@/db/schema";
import { actorFromRequest, errorResponse, hasRole } from "@/lib/access";
import { createSchoolDatabaseClient } from "@/lib/supabase/database";
import { readSchoolDirectory } from "@/lib/supabase/school-directory";

export async function GET(request: Request) {
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin", "direccion")) return errorResponse(403, "No tienes permiso para consultar docentes.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    try {
      const items = await readSchoolDirectory(createSchoolDatabaseClient(env), actor.supabaseAuth.accessToken, "teachers");
      return Response.json({ items }, { headers: { "Cache-Control": "no-store" } });
    } catch { return errorResponse(503, "No se pudieron consultar las docentes."); }
  }
  const rows = await getDb().select({ id: teachers.id, name: user.name, email: user.email }).from(teachers).innerJoin(user, eq(teachers.userId, user.id)).where(eq(teachers.active, true));
  return Response.json({ items: rows }, { headers: { "Cache-Control": "no-store" } });
}
