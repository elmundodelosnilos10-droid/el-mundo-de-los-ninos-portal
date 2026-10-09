import { env } from "@/lib/runtime/env";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { notifications } from "@/db/schema";
import { actorFromRequest, errorResponse } from "@/lib/access";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";
import { createSchoolDatabaseClient, SupabaseDatabaseError } from "@/lib/supabase/database";

export async function GET(request: Request) {
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    try {
      const result = await createSchoolDatabaseClient(env).select<{
        id: string; kind: string; title: string; href: string | null; created_at: string; read_at: string | null;
      }>(actor.supabaseAuth.accessToken, "notifications", {
        columns: ["id", "kind", "title", "href", "created_at", "read_at"],
        filters: [{ column: "user_id", operator: "eq", value: actor.supabaseAuth.userId }],
        orderBy: [{ column: "created_at", ascending: false }], limit: 100,
      });
      const items = result.data.map(row => ({ id: row.id, kind: row.kind, title: row.title, href: row.href, createdAt: row.created_at, readAt: row.read_at }));
      return Response.json({ items }, { headers: { "Cache-Control": "no-store" } });
    } catch {
      return errorResponse(503, "No se pudieron cargar los avisos.");
    }
  }
  const rows = await getDb().select().from(notifications).where(eq(notifications.userId, actor.id)).orderBy(desc(notifications.createdAt)).limit(100);
  return Response.json({ items: rows.map(row => ({ id: row.id, kind: row.kind, title: row.title, href: row.href, createdAt: row.createdAt.toISOString(), readAt: row.readAt?.toISOString() ?? null })) }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403, "Solicitud no válida.");
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  const body = await request.json().catch(() => null) as { id?: unknown } | null;
  const parsed = z.object({ id: z.uuid() }).safeParse(body);
  if (!parsed.success) return errorResponse(400, "Indica un aviso válido.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    try {
      const result = await createSchoolDatabaseClient(env).update(actor.supabaseAuth.accessToken, "notifications", { read_at: new Date().toISOString() }, [
        { column: "id", operator: "eq", value: parsed.data.id },
        { column: "user_id", operator: "eq", value: actor.supabaseAuth.userId },
        { column: "read_at", operator: "is", value: null },
      ], { returning: ["id"] });
      if (!result.data.length) {
        const existing = await createSchoolDatabaseClient(env).select(actor.supabaseAuth.accessToken, "notifications", {
          columns: ["id", "read_at"], filters: [
            { column: "id", operator: "eq", value: parsed.data.id },
            { column: "user_id", operator: "eq", value: actor.supabaseAuth.userId },
          ], limit: 1,
        });
        if (!existing.data[0]?.read_at) return errorResponse(404, "Aviso no disponible.");
      }
      return Response.json({ read: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (cause) {
      if (cause instanceof SupabaseDatabaseError && cause.status === 403) return errorResponse(403, "No tienes permiso para ese aviso.");
      return errorResponse(503, "No se pudo actualizar el aviso.");
    }
  }
  const db = getDb();
  await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, parsed.data.id), eq(notifications.userId, actor.id), isNull(notifications.readAt)));
  return Response.json({ read: true }, { headers: { "Cache-Control": "no-store" } });
}
