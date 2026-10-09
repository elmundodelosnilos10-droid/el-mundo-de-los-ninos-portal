import { env } from "@/lib/runtime/env";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { files, messages } from "@/db/schema";
import { actorFromRequest, errorResponse, hasRole, maySeeGroup, maySeeStudent } from "@/lib/access";
import { authorizedConversation } from "@/lib/conversation-access";
import { getSchoolFile, isFileStorageConfigured } from "@/lib/file-storage";
import { createSchoolDatabaseClient } from "@/lib/supabase/database";

type SchoolFileRow = {
  id: string;
  object_key: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  purpose: string;
  group_id: string | null;
  student_id: string | null;
  deleted_at: string | null;
};

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  const { id } = await context.params;
  let file: {
    id: string; objectKey: string; originalName: string; mimeType: string; sizeBytes: number;
    purpose: string; groupId: string | null; studentId: string | null; deletedAt: Date | null;
  } | null = null;
  let fileFromSupabase = false;
  const useSupabase = env.SCHOOL_DATA_PROVIDER === "supabase";
  if (useSupabase) {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    try {
      const result = await createSchoolDatabaseClient(env).select<SchoolFileRow>(actor.supabaseAuth.accessToken, "files", {
        columns: ["id", "object_key", "original_name", "mime_type", "size_bytes", "purpose", "group_id", "student_id", "deleted_at"],
        filters: [{ column: "id", operator: "eq", value: id }, { column: "deleted_at", operator: "is", value: null }], limit: 1,
      });
      const row = result.data[0];
      if (row) file = {
        id: row.id, objectKey: row.object_key, originalName: row.original_name, mimeType: row.mime_type,
        sizeBytes: row.size_bytes, purpose: row.purpose, groupId: row.group_id, studentId: row.student_id, deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
      };
      fileFromSupabase = Boolean(row);
    } catch { return errorResponse(503, "No se pudo verificar el acceso al archivo."); }
  }
  if (!useSupabase) {
    const rows = await getDb().select().from(files).where(eq(files.id, id)).limit(1);
    if (rows.length && !rows[0].deletedAt) file = rows[0];
  }
  if (!file) return errorResponse(404, "Archivo no disponible.");
  // Recordings remain disabled, including existing or imported private files.
  if (file.purpose === "recording") return errorResponse(404, "Archivo no disponible.");
  if (!isFileStorageConfigured(env, file.objectKey)) return errorResponse(503, "El almacenamiento privado no está configurado.");
  if (file.purpose === "message") {
    if (fileFromSupabase) {
      if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
      try {
        const message = await createSchoolDatabaseClient(env).select<{ conversation_id: string }>(actor.supabaseAuth.accessToken, "messages", {
          columns: ["conversation_id"], filters: [{ column: "file_id", operator: "eq", value: file.id }], limit: 1,
        });
        if (!message.data.length) return errorResponse(404, "Archivo no disponible.");
      } catch { return errorResponse(503, "No se pudo verificar el acceso al archivo."); }
    } else {
      const message = await getDb().select({ conversationId: messages.conversationId }).from(messages).where(eq(messages.fileId, file.id)).limit(1);
      if (!message.length || !(await authorizedConversation(message[0].conversationId, actor.id, actor.roles))) return errorResponse(404, "Archivo no disponible.");
    }
  } else {
    if (!fileFromSupabase) {
      if (file.studentId && !(await maySeeStudent(actor, file.studentId))) return errorResponse(404, "Archivo no disponible.");
      if (file.groupId && !(await maySeeGroup(actor, file.groupId))) return errorResponse(404, "Archivo no disponible.");
      if (!file.studentId && !file.groupId && !hasRole(actor, "superadmin", "direccion")) return errorResponse(404, "Archivo no disponible.");
    } else if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
  }
  const object = await getSchoolFile(env, file.objectKey);
  if (!object) return errorResponse(404, "Archivo no disponible.");
  const encodedName = encodeURIComponent(file.originalName).replace(/[()]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  const playable = new URL(request.url).searchParams.get("play") === "1" && file.purpose === "material" && file.mimeType.startsWith("audio/");
  return new Response(object.body, { headers: {
    "Content-Type": file.mimeType,
    ...(object.sizeBytes === null ? {} : { "Content-Length": String(object.sizeBytes) }),
    "Content-Disposition": `${playable ? "inline" : "attachment"}; filename*=UTF-8''${encodedName}`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox",
  } });
}
