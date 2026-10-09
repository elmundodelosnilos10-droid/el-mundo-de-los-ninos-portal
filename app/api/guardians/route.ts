import { env } from "@/lib/runtime/env";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { guardians, user } from "@/db/schema";
import { actorFromRequest, errorResponse, hasRole } from "@/lib/access";
import { createSchoolDatabaseClient } from "@/lib/supabase/database";
import { readSchoolDirectory } from "@/lib/supabase/school-directory";

export async function GET(request: Request) {
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin", "direccion")) return errorResponse(403, "No tienes permiso para consultar tutores.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    try {
      const items = await readSchoolDirectory(createSchoolDatabaseClient(env), actor.supabaseAuth.accessToken, "guardians");
      return Response.json({ items }, { headers: { "Cache-Control": "no-store" } });
    } catch { return errorResponse(503, "No se pudieron consultar las familias."); }
  }
  const rows = await getDb().select({ id: guardians.id, name: user.name, email: user.email }).from(guardians).innerJoin(user, eq(guardians.userId, user.id)).where(eq(guardians.active, true));
  return Response.json({ items: rows }, { headers: { "Cache-Control": "no-store" } });
}
