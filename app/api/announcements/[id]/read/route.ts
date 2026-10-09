import { env } from "@/lib/runtime/env";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { announcementReads, announcements } from "@/db/schema";
import { accessibleGroupIds, actorFromRequest, errorResponse, hasRole } from "@/lib/access";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";
import { createSchoolDatabaseClient, SupabaseDatabaseError } from "@/lib/supabase/database";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403, "Solicitud no válida.");
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  const { id } = await context.params;
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    if (!z.uuid().safeParse(id).success) return errorResponse(404, "Comunicado no disponible.");
    try {
      const result = await createSchoolDatabaseClient(env).rpc<{ read: boolean }>(actor.supabaseAuth.accessToken, "school_mark_announcement_read", { p_announcement_id: id });
      if (result.data[0]?.read !== true) return errorResponse(404, "Comunicado no disponible.");
      return Response.json({ read: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (cause) {
      if (cause instanceof SupabaseDatabaseError && (cause.status === 403 || cause.status === 404)) return errorResponse(404, "Comunicado no disponible.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 400) return errorResponse(400, "Comunicado no disponible.");
      return errorResponse(503, "No se pudo confirmar la lectura.");
    }
  }
  const rows = await getDb().select({ id: announcements.id, groupId: announcements.groupId }).from(announcements).where(eq(announcements.id, id)).limit(1);
  if (!rows.length) return errorResponse(404, "Comunicado no disponible.");
  if (rows[0].groupId && !hasRole(actor, "superadmin", "direccion")) {
    const accessible = await accessibleGroupIds(actor);
    if (!accessible.includes(rows[0].groupId)) return errorResponse(404, "Comunicado no disponible.");
  }
  await getDb().insert(announcementReads).values({ announcementId: id, userId: actor.id, readAt: new Date() }).onConflictDoNothing();
  return Response.json({ read: true }, { headers: { "Cache-Control": "no-store" } });
}
