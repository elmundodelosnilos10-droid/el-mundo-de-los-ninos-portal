import { env } from "@/lib/runtime/env";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLog, files, materials } from "@/db/schema";
import { actorFromRequest, errorResponse, hasRole, mayTeachGroup } from "@/lib/access";
import { stripImageMetadata } from "@/lib/image-metadata";
import { scanUploadedFile } from "@/lib/file-scanner";
import { checkDeclaredRequestSize, readMultipartFormDataLimited } from "@/lib/upload-request-guard";
import { SCHOOL_UPLOAD_MAX_BODY_BYTES, SCHOOL_UPLOAD_MAX_FILE_BYTES, SCHOOL_UPLOAD_SIZE_MESSAGE } from "@/lib/school-upload-limits";
import { deleteSchoolFile, isFileStorageConfigured, newFileObjectKey, putSchoolFile } from "@/lib/file-storage";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";
import { createSchoolDatabaseClient, SupabaseDatabaseError } from "@/lib/supabase/database";

const allowedTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "audio/mpeg", "audio/ogg", "audio/wav"]);
const safeName = (name: string) => name.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[\\/]/g, "_").slice(0, 160) || "archivo";

function matchesMagic(type: string, bytes: Uint8Array) {
  if (type === "application/pdf") return new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
  if (type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") return bytes.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10";
  if (type === "image/webp") return new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
  if (type === "audio/mpeg") return new TextDecoder().decode(bytes.slice(0, 3)) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  if (type === "audio/ogg") return new TextDecoder().decode(bytes.slice(0, 4)) === "OggS";
  if (type === "audio/wav") return new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WAVE";
  return false;
}

async function rejectUpload(request: Request, status: 400 | 401 | 403 | 413 | 503, message: string) {
  await request.body?.cancel().catch(() => undefined);
  return errorResponse(status, message);
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403, "Solicitud no válida.");
  const actor = await actorFromRequest(request);
  if (!actor) return rejectUpload(request, 401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin", "direccion", "docente")) return rejectUpload(request, 403, "Solo el equipo escolar puede reemplazar recursos.");
  if (!isFileStorageConfigured(env)) return rejectUpload(request, 503, "El almacenamiento privado no está configurado.");
  const sizeCheck = checkDeclaredRequestSize(request.headers.get("content-length"), SCHOOL_UPLOAD_MAX_BODY_BYTES);
  if (sizeCheck === "invalid") return rejectUpload(request, 400, "El tamaño de la solicitud no es válido.");
  if (sizeCheck === "too_large") return rejectUpload(request, 413, "La solicitud supera el límite de carga permitido.");
  const { id } = await context.params;
  const parsedBody = await readMultipartFormDataLimited(request, SCHOOL_UPLOAD_MAX_BODY_BYTES);
  if (parsedBody.tooLarge) return errorResponse(413, "La solicitud supera el límite de carga permitido.");
  const form = parsedBody.form;
  const candidate = form?.get("file");
  if (!(candidate instanceof File)) return errorResponse(400, "Selecciona el archivo nuevo.");
  const maxBytes = SCHOOL_UPLOAD_MAX_FILE_BYTES;
  if (candidate.size < 1 || candidate.size > maxBytes) return errorResponse(400, SCHOOL_UPLOAD_SIZE_MESSAGE);
  if (!allowedTypes.has(candidate.type)) return errorResponse(400, "Se permiten imágenes JPG, PNG, WebP, PDF y audios MP3, OGG o WAV.");

  const useSupabase = env.SCHOOL_DATA_PROVIDER === "supabase";
  let material: { materialId: string; groupId: string; fileId: string; objectKey: string; originalName: string; mimeType: string; sizeBytes: number; deletedAt: Date | null } | null = null;
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
    material = row ?? null;
  }
  if (!material || material.deletedAt) return errorResponse(404, "Recurso no disponible.");
  if (!useSupabase && !(await mayTeachGroup(actor, material.groupId))) return errorResponse(403, "No tienes permiso para ese grupo.");

  let bytes: Uint8Array = new Uint8Array(await candidate.arrayBuffer());
  if (!matchesMagic(candidate.type, bytes)) return errorResponse(400, "El contenido del archivo no coincide con su tipo.");
  if (candidate.type.startsWith("image/")) {
    const sanitized = stripImageMetadata(candidate.type, bytes);
    if (!sanitized) return errorResponse(400, "La imagen está dañada o no se pudo quitar su información privada.");
    bytes = sanitized;
  }
  const scan = await scanUploadedFile({ url: env.SCHOOL_FILE_SCAN_URL, token: env.SCHOOL_FILE_SCAN_TOKEN, applicationUrl: env.BETTER_AUTH_URL, localTestMode: env.SCHOOL_FILE_SCAN_LOCAL_MOCK === "true" }, candidate.type, bytes);
  if (scan === "infected") return errorResponse(400, "El archivo no superó la revisión de seguridad.");
  if (scan !== "clean") return errorResponse(503, "No se pudo revisar el archivo. Inténtalo más tarde o contacta a Dirección.");

  const newObjectKey = newFileObjectKey(env, "material");
  const newName = safeName(candidate.name);
  try {
    await putSchoolFile(env, newObjectKey, bytes, candidate.type, material.fileId);
    const now = new Date();
    if (useSupabase) {
      if (!actor.supabaseAuth) throw new SupabaseDatabaseError("not_configured", "rpc");
      const result = await createSchoolDatabaseClient(env).rpc<{ replaced: boolean; fileId: string; oldObjectKey: string }>(actor.supabaseAuth.accessToken, "school_replace_material_file", {
        p_material_id: material.materialId, p_object_key: newObjectKey, p_original_name: newName,
        p_mime_type: candidate.type, p_size_bytes: bytes.length,
      });
      const payload = result.data[0];
      if (payload?.replaced !== true || payload.fileId !== material.fileId || typeof payload.oldObjectKey !== "string") throw new SupabaseDatabaseError("rejected", "rpc", 502);
      await deleteSchoolFile(env, payload.oldObjectKey).catch(() => undefined);
      return Response.json({ id: material.materialId, fileId: material.fileId, name: newName, mimeType: candidate.type, sizeBytes: bytes.length }, { headers: { "Cache-Control": "no-store" } });
    }
    const db = getDb();
    await db.batch([
      db.update(files).set({ objectKey: newObjectKey, originalName: newName, mimeType: candidate.type, sizeBytes: bytes.length, uploadedBy: actor.id, createdAt: now }).where(and(eq(files.id, material.fileId), isNull(files.deletedAt))),
      db.insert(auditLog).values({ id: crypto.randomUUID(), actorId: actor.id, action: "replace_material_file", entityType: "file", entityId: material.fileId, createdAt: now }),
    ]);
  } catch (cause) {
    await deleteSchoolFile(env, newObjectKey).catch(() => undefined);
    if (cause instanceof SupabaseDatabaseError && cause.status === 403) return errorResponse(403, "No tienes permiso para ese grupo.");
    if (cause instanceof SupabaseDatabaseError && cause.status === 404) return errorResponse(404, "Recurso no disponible.");
    if (cause instanceof SupabaseDatabaseError && cause.status === 400) return errorResponse(400, "El archivo nuevo no cumple los requisitos.");
    return errorResponse(500, "No se pudo reemplazar el archivo.");
  }
  await deleteSchoolFile(env, material.objectKey).catch(() => undefined);
  return Response.json({ id: material.materialId, fileId: material.fileId, name: newName, mimeType: candidate.type, sizeBytes: bytes.length }, { headers: { "Cache-Control": "no-store" } });
}
