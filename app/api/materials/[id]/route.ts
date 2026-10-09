import { env } from "@/lib/runtime/env";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLog, files, materials } from "@/db/schema";
import { actorFromRequest, errorResponse, hasRole, mayTeachGroup } from "@/lib/access";
import { deleteSchoolFile, isFileStorageConfigured, putSchoolFile, readSchoolFile } from "@/lib/file-storage";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";
import { createSchoolDatabaseClient, SupabaseDatabaseError } from "@/lib/supabase/database";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403, "Solicitud no válida.");
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin", "direccion", "docente")) return errorResponse(403, "Solo el equipo escolar puede retirar recursos.");
  const { id } = await context.params;
  const useSupabase = env.SCHOOL_DATA_PROVIDER === "supabase";
  let material: { materialId: string; groupId: string; fileId: string; objectKey: string; originalName: string; mimeType: string; sizeBytes: number; deletedAt: Date | null } | undefined;
  if (useSupabase) {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    try {
      const client = createSchoolDatabaseClient(env);
      const materialsResult = await client.select<{ id: string; group_id: string; file_id: string }>(actor.supabaseAuth.accessToken, "materials", {
        columns: ["id", "group_id", "file_id"], filters: [{ column: "id", operator: "eq", value: id }], limit: 1,
      });
      const row = materialsResult.data[0];
      if (!row) return errorResponse(404, "Recurso no disponible.");
      const filesResult = await client.select<{ id: string; object_key: string; original_name: string; mime_type: string; size_bytes: number; deleted_at: string | null }>(actor.supabaseAuth.accessToken, "files", {
        columns: ["id", "object_key", "original_name", "mime_type", "size_bytes", "deleted_at"], filters: [
          { column: "id", operator: "eq", value: row.file_id }, { column: "deleted_at", operator: "is", value: null },
        ], limit: 1,
      });
      const file = filesResult.data[0];
      if (!file) return errorResponse(404, "Recurso no disponible.");
      material = { materialId: row.id, groupId: row.group_id, fileId: file.id, objectKey: file.object_key, originalName: file.original_name, mimeType: file.mime_type, sizeBytes: file.size_bytes, deletedAt: file.deleted_at ? new Date(file.deleted_at) : null };
    } catch { return errorResponse(503, "No se pudo verificar el recurso."); }
  } else {
    const db = getDb();
    const [row] = await db.select({ materialId: materials.id, groupId: materials.groupId, fileId: files.id, objectKey: files.objectKey, originalName: files.originalName, mimeType: files.mimeType, sizeBytes: files.sizeBytes, deletedAt: files.deletedAt })
      .from(materials).innerJoin(files, eq(files.id, materials.fileId)).where(eq(materials.id, id)).limit(1);
    material = row;
  }
  if (!material || material.deletedAt) return errorResponse(404, "Recurso no disponible.");
  if (!isFileStorageConfigured(env, material.objectKey)) return errorResponse(503, "El almacenamiento privado no está configurado.");
  if (!useSupabase && !(await mayTeachGroup(actor, material.groupId))) return errorResponse(403, "No tienes permiso para ese grupo.");

  if (useSupabase) {
    try {
      if (!actor.supabaseAuth) throw new SupabaseDatabaseError("not_configured", "rpc");
      const result = await createSchoolDatabaseClient(env).rpc<{ removed: boolean; fileId: string; objectKey: string }>(actor.supabaseAuth.accessToken, "school_remove_material", {
        p_material_id: material.materialId,
      });
      const payload = result.data[0];
      if (payload?.removed !== true || payload.fileId !== material.fileId || typeof payload.objectKey !== "string" || !isFileStorageConfigured(env, payload.objectKey)) {
        throw new SupabaseDatabaseError("rejected", "rpc", 502);
      }
      await deleteSchoolFile(env, payload.objectKey).catch(() => undefined);
    } catch (cause) {
      if (cause instanceof SupabaseDatabaseError && cause.status === 403) return errorResponse(403, "No tienes permiso para ese grupo.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 404) return errorResponse(404, "Recurso no disponible.");
      return errorResponse(500, "No se pudo retirar el recurso. Intenta de nuevo.");
    }
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  }
  const object = await readSchoolFile(env, material.objectKey);
  try {
    if (object) await deleteSchoolFile(env, material.objectKey);
    const now = new Date();
    const db = getDb();
    await db.batch([
      db.update(files).set({ deletedAt: now }).where(and(eq(files.id, material.fileId), isNull(files.deletedAt))),
      db.delete(materials).where(eq(materials.id, material.materialId)),
      db.insert(auditLog).values({ id: crypto.randomUUID(), actorId: actor.id, action: "delete_material", entityType: "file", entityId: material.fileId, createdAt: now }),
    ]);
  } catch {
    if (object) await putSchoolFile(env, material.objectKey, object.bytes, object.contentType || material.mimeType, material.fileId).catch(() => undefined);
    return errorResponse(500, "No se pudo retirar el recurso. Intenta de nuevo.");
  }
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
