import { env } from "@/lib/runtime/env";
import { and, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { files, groups, materials } from "@/db/schema";
import { accessibleGroupIds, actorFromRequest, errorResponse, hasRole } from "@/lib/access";
import { createSchoolDatabaseClient, SupabaseDatabaseError } from "@/lib/supabase/database";
import { readSchoolLibrary } from "@/lib/supabase/library";
import { parseLibraryQuery } from "@/lib/library-query";

export async function GET(request: Request) {
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin", "direccion", "docente", "tutor")) return errorResponse(403, "No tienes permiso para consultar los materiales.");
  const query = parseLibraryQuery(new URL(request.url).searchParams);
  if (!query) return errorResponse(400, "Revisa la búsqueda, los filtros y la página solicitada.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth || actor.supabaseAuth.userId !== actor.id) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    try {
      const feed = await readSchoolLibrary(createSchoolDatabaseClient(env), actor.supabaseAuth.accessToken, query);
      return Response.json(feed, { headers: { "Cache-Control": "no-store" } });
    } catch (cause) {
      if (cause instanceof SupabaseDatabaseError && cause.status === 403) return errorResponse(403, "No tienes permiso para consultar los materiales.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 404) return errorResponse(404, "Grupo no disponible.");
      return errorResponse(503, "No se pudieron consultar los materiales.");
    }
  }
  const groupIds = await accessibleGroupIds(actor);
  if (query.groupId && !groupIds.includes(query.groupId)) return errorResponse(404, "Grupo no disponible.");
  if (!groupIds.length) return Response.json({ items: [], total: 0, categories: [], page: query.page, pageSize: query.pageSize }, { headers: { "Cache-Control": "no-store" } });
  const db = getDb();
  const scope = and(inArray(materials.groupId, groupIds), eq(groups.active, true), isNull(files.deletedAt), eq(files.purpose, "material"),
    query.groupId ? eq(materials.groupId, query.groupId) : undefined);
  const filtered = and(scope, query.category ? eq(materials.category, query.category) : undefined,
    query.query ? or(sql`instr(lower(${materials.title}), lower(${query.query})) > 0`, sql`instr(lower(${files.originalName}), lower(${query.query})) > 0`) : undefined);
  const [rows, totals, categories] = await Promise.all([
    db.select({ id: materials.id, fileId: materials.fileId, groupId: materials.groupId, groupName: groups.name, title: materials.title, category: materials.category, publishedAt: materials.publishedAt, fileName: files.originalName, mimeType: files.mimeType, sizeBytes: files.sizeBytes })
      .from(materials).innerJoin(groups, eq(groups.id, materials.groupId)).innerJoin(files, eq(files.id, materials.fileId)).where(filtered)
      .orderBy(desc(materials.publishedAt), desc(materials.id)).limit(query.pageSize).offset((query.page - 1) * query.pageSize),
    db.select({ value: count() }).from(materials).innerJoin(groups, eq(groups.id, materials.groupId)).innerJoin(files, eq(files.id, materials.fileId)).where(filtered),
    db.selectDistinct({ category: materials.category }).from(materials).innerJoin(groups, eq(groups.id, materials.groupId)).innerJoin(files, eq(files.id, materials.fileId)).where(scope),
  ]);
  return Response.json({ items: rows, total: totals[0].value, categories: categories.map(row => row.category).sort(), page: query.page, pageSize: query.pageSize }, { headers: { "Cache-Control": "no-store" } });
}
