import { env } from "@/lib/runtime/env";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { auditLog, enrollments, files, guardians, materials, students, studentGuardians, submissionFiles, submissions, taskFiles, tasks } from "@/db/schema";
import { actorFromRequest, errorResponse, hasRole, mayTeachGroup } from "@/lib/access";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";
import { stripImageMetadata } from "@/lib/image-metadata";
import { scanUploadedFile } from "@/lib/file-scanner";
import { checkDeclaredRequestSize, readMultipartFormDataLimited } from "@/lib/upload-request-guard";
import { SCHOOL_UPLOAD_MAX_BODY_BYTES, SCHOOL_UPLOAD_MAX_FILE_BYTES, SCHOOL_UPLOAD_SIZE_MESSAGE } from "@/lib/school-upload-limits";
import { deleteSchoolFile, isFileStorageConfigured, newFileObjectKey, putSchoolFile } from "@/lib/file-storage";
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

export async function POST(request: Request) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403, "Solicitud no válida.");
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!isFileStorageConfigured(env)) return errorResponse(503, "El almacenamiento privado no está configurado.");
  const sizeCheck = checkDeclaredRequestSize(request.headers.get("content-length"), SCHOOL_UPLOAD_MAX_BODY_BYTES);
  if (sizeCheck) {
    await request.body?.cancel().catch(() => undefined);
    return sizeCheck === "invalid"
      ? errorResponse(400, "El tamaño de la solicitud no es válido.")
      : errorResponse(413, "La solicitud supera el límite de carga permitido.");
  }
  const parsedBody = await readMultipartFormDataLimited(request, SCHOOL_UPLOAD_MAX_BODY_BYTES);
  if (parsedBody.tooLarge) return errorResponse(413, "La solicitud supera el límite de carga permitido.");
  const form = parsedBody.form;
  if (!form) return errorResponse(400, "No se recibió un archivo válido.");
  const file = form.get("file");
  if (!(file instanceof File)) return errorResponse(400, "Selecciona un archivo.");
  const maxBytes = SCHOOL_UPLOAD_MAX_FILE_BYTES;
  if (file.size < 1 || file.size > maxBytes) return errorResponse(400, SCHOOL_UPLOAD_SIZE_MESSAGE);
  if (!allowedTypes.has(file.type)) return errorResponse(400, "Se permiten imágenes JPG, PNG, WebP, documentos PDF y audios MP3, OGG o WAV.");

  const purpose = form.get("purpose");
  let groupId: string | null = null; let studentId: string | null = null; let taskId: string | null = null;
  let purposeForStorage: "material" | "submission" = "material";
  let materialTitle = ""; let category = "";
  if (purpose === "material") {
    const parsed = z.object({ groupId: z.uuid(), title: z.string().trim().min(2).max(120), category: z.string().trim().min(2).max(60) }).safeParse({ groupId: form.get("groupId"), title: form.get("title"), category: form.get("category") });
    if (!parsed.success || !hasRole(actor, "superadmin", "direccion", "docente")) return errorResponse(400, "Revisa el grupo, el título y la categoría.");
    if (env.SCHOOL_DATA_PROVIDER === "supabase") {
      if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
      try {
        const result = await createSchoolDatabaseClient(env).select<{ id: string }>(actor.supabaseAuth.accessToken, "groups", {
          columns: ["id"], filters: [{ column: "id", operator: "eq", value: parsed.data.groupId }, { column: "active", operator: "eq", value: true }], limit: 1,
        });
        if (!result.data.length) return errorResponse(403, "No tienes permiso para ese grupo.");
      } catch { return errorResponse(503, "No se pudo verificar el grupo."); }
    } else if (!(await mayTeachGroup(actor, parsed.data.groupId))) return errorResponse(403, "No tienes permiso para ese grupo.");
    groupId = parsed.data.groupId; materialTitle = parsed.data.title; category = parsed.data.category;
  } else if (purpose === "submission") {
    const parsed = z.object({ taskId: z.uuid(), studentId: z.uuid() }).safeParse({ taskId: form.get("taskId"), studentId: form.get("studentId") });
    if (!parsed.success || !hasRole(actor, "tutor")) return errorResponse(403, "Las evidencias las envía un tutor autorizado.");
    if (env.SCHOOL_DATA_PROVIDER === "supabase") {
      if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
      try {
        const result = await createSchoolDatabaseClient(env).select<{ group_id: string }>(actor.supabaseAuth.accessToken, "tasks", {
          columns: ["group_id"], filters: [
            { column: "id", operator: "eq", value: parsed.data.taskId },
            { column: "archived_at", operator: "is", value: null },
          ], limit: 1,
        });
        if (!result.data.length) return errorResponse(404, "Actividad no disponible.");
        taskId = parsed.data.taskId; studentId = parsed.data.studentId; groupId = result.data[0].group_id;
      } catch { return errorResponse(503, "No se pudo verificar la actividad."); }
    } else {
      const db = getDb();
      const task = await db.select({ groupId: tasks.groupId }).from(tasks).where(and(eq(tasks.id, parsed.data.taskId), isNull(tasks.archivedAt))).limit(1);
      const owned = task.length ? await db.select({ id: students.id }).from(studentGuardians).innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId)).innerJoin(students, eq(students.id, studentGuardians.studentId)).innerJoin(enrollments, eq(enrollments.studentId, students.id)).where(and(eq(guardians.userId, actor.id), eq(guardians.active, true), eq(studentGuardians.active, true), eq(students.id, parsed.data.studentId), eq(students.active, true), eq(enrollments.groupId, task[0].groupId), isNull(enrollments.endedAt))).limit(1) : [];
      if (!owned.length) return errorResponse(404, "Actividad no disponible.");
      taskId = parsed.data.taskId; studentId = parsed.data.studentId; groupId = task[0].groupId;
    }
    purposeForStorage = "submission";
  } else if (purpose === "task") {
    const parsed = z.object({ taskId: z.uuid() }).safeParse({ taskId: form.get("taskId") });
    if (!parsed.success || !hasRole(actor, "superadmin", "direccion", "docente")) return errorResponse(403, "Solo el equipo escolar puede adjuntar materiales a una tarea.");
    if (env.SCHOOL_DATA_PROVIDER === "supabase") {
      if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
      try {
        const result = await createSchoolDatabaseClient(env).select<{ group_id: string }>(actor.supabaseAuth.accessToken, "tasks", {
          columns: ["group_id"], filters: [
            { column: "id", operator: "eq", value: parsed.data.taskId },
            { column: "archived_at", operator: "is", value: null },
          ], limit: 1,
        });
        if (!result.data.length) return errorResponse(404, "Tarea no disponible.");
        taskId = parsed.data.taskId; groupId = result.data[0].group_id;
      } catch { return errorResponse(503, "No se pudo verificar la tarea."); }
    } else {
      const db = getDb();
      const task = await db.select({ groupId: tasks.groupId }).from(tasks).where(and(eq(tasks.id, parsed.data.taskId), isNull(tasks.archivedAt))).limit(1);
      if (!task.length) return errorResponse(404, "Tarea no disponible.");
      if (!(await mayTeachGroup(actor, task[0].groupId))) return errorResponse(403, "No tienes permiso para adjuntar materiales a ese grupo.");
      taskId = parsed.data.taskId; groupId = task[0].groupId;
    }
  } else return errorResponse(400, "El tipo de archivo no está habilitado.");

  let bytes: Uint8Array = new Uint8Array(await file.arrayBuffer());
  if (!matchesMagic(file.type, bytes)) return errorResponse(400, "El contenido del archivo no coincide con su tipo.");
  if (file.type.startsWith("image/")) {
    const sanitized = stripImageMetadata(file.type, bytes);
    if (!sanitized) return errorResponse(400, "La imagen está dañada o no se pudo quitar su información privada.");
    bytes = sanitized;
  }
  const scan = await scanUploadedFile({ url: env.SCHOOL_FILE_SCAN_URL, token: env.SCHOOL_FILE_SCAN_TOKEN, applicationUrl: env.BETTER_AUTH_URL, localTestMode: env.SCHOOL_FILE_SCAN_LOCAL_MOCK === "true" }, file.type, bytes);
  if (scan === "infected") return errorResponse(400, "El archivo no superó la revisión de seguridad.");
  if (scan !== "clean") return errorResponse(503, "No se pudo revisar el archivo. Inténtalo más tarde o contacta a Dirección.");

  const fileId = crypto.randomUUID(); const objectKey = newFileObjectKey(env, purposeForStorage === "submission" ? "submission" : "material"); const now = new Date();
  const name = safeName(file.name);
  try {
    await putSchoolFile(env, objectKey, bytes, file.type, fileId);
    if (purpose === "material" && env.SCHOOL_DATA_PROVIDER === "supabase") {
      if (!actor.supabaseAuth) throw new SupabaseDatabaseError("not_configured", "rpc");
      const result = await createSchoolDatabaseClient(env).rpc<{ published: boolean; fileId: string }>(actor.supabaseAuth.accessToken, "school_publish_material_file", {
        p_material_id: crypto.randomUUID(), p_file_id: fileId, p_object_key: objectKey, p_original_name: name,
        p_mime_type: file.type, p_size_bytes: bytes.length, p_group_id: groupId, p_title: materialTitle, p_category: category,
      });
      if (result.data[0]?.published !== true || result.data[0].fileId !== fileId) throw new SupabaseDatabaseError("rejected", "rpc", 502);
    } else if (purpose === "material") {
      const db = getDb();
      await db.batch([
        db.insert(files).values({ id: fileId, objectKey, originalName: name, mimeType: file.type, sizeBytes: bytes.length, purpose: "material", uploadedBy: actor.id, groupId, createdAt: now }),
        db.insert(materials).values({ id: crypto.randomUUID(), fileId, groupId: groupId!, title: materialTitle, category, publishedBy: actor.id, publishedAt: now }),
        db.insert(auditLog).values({ id: crypto.randomUUID(), actorId: actor.id, action: "upload_material", entityType: "file", entityId: fileId, createdAt: now }),
      ]);
    } else if (purpose === "task" && env.SCHOOL_DATA_PROVIDER === "supabase") {
      if (!actor.supabaseAuth) throw new SupabaseDatabaseError("not_configured", "rpc");
      const result = await createSchoolDatabaseClient(env).rpc<{ attached: boolean; fileId: string }>(actor.supabaseAuth.accessToken, "school_attach_task_file", {
        p_file_id: fileId, p_object_key: objectKey, p_original_name: name, p_mime_type: file.type,
        p_size_bytes: bytes.length, p_task_id: taskId,
      });
      if (result.data[0]?.attached !== true || result.data[0].fileId !== fileId) throw new SupabaseDatabaseError("rejected", "rpc", 502);
    } else if (purpose === "task") {
      const db = getDb();
      await db.batch([
        db.insert(files).values({ id: fileId, objectKey, originalName: name, mimeType: file.type, sizeBytes: bytes.length, purpose: "material", uploadedBy: actor.id, groupId, createdAt: now }),
        db.insert(taskFiles).values({ taskId: taskId!, fileId }),
        db.insert(auditLog).values({ id: crypto.randomUUID(), actorId: actor.id, action: "attach_task_material", entityType: "task", entityId: taskId!, createdAt: now }),
      ]);
    } else if (purpose === "submission" && env.SCHOOL_DATA_PROVIDER === "supabase") {
      if (!actor.supabaseAuth) throw new SupabaseDatabaseError("not_configured", "rpc");
      const result = await createSchoolDatabaseClient(env).rpc<{ submissionId: string; fileId: string; status: string }>(actor.supabaseAuth.accessToken, "school_submit_task_file", {
        p_file_id: fileId, p_object_key: objectKey, p_original_name: name, p_mime_type: file.type,
        p_size_bytes: bytes.length, p_task_id: taskId, p_student_id: studentId, p_note: null,
      });
      if (!result.data[0] || !z.uuid().safeParse(result.data[0].submissionId).success || result.data[0].fileId !== fileId || result.data[0].status !== "entregada") {
        throw new SupabaseDatabaseError("rejected", "rpc", 502);
      }
    } else {
      const db = getDb();
      const submissionId = crypto.randomUUID();
      const current = await db.select({ id: submissions.id }).from(submissions).where(and(eq(submissions.taskId, taskId!), eq(submissions.studentId, studentId!))).limit(1);
      const actualSubmissionId = current[0]?.id ?? submissionId;
      if (current.length) await db.batch([
        db.insert(files).values({ id: fileId, objectKey, originalName: name, mimeType: file.type, sizeBytes: bytes.length, purpose: purposeForStorage, uploadedBy: actor.id, groupId, studentId, createdAt: now }),
        db.insert(submissionFiles).values({ submissionId: actualSubmissionId, fileId }),
        db.update(submissions).set({ submittedBy: actor.id, status: "entregada", reviewedBy: null, reviewNote: null, reviewedAt: null, submittedAt: now }).where(eq(submissions.id, actualSubmissionId)),
        db.insert(auditLog).values({ id: crypto.randomUUID(), actorId: actor.id, action: "upload_evidence", entityType: "submission", entityId: actualSubmissionId, createdAt: now }),
      ]);
      else await db.batch([
        db.insert(files).values({ id: fileId, objectKey, originalName: name, mimeType: file.type, sizeBytes: bytes.length, purpose: purposeForStorage, uploadedBy: actor.id, groupId, studentId, createdAt: now }),
        db.insert(submissions).values({ id: actualSubmissionId, taskId: taskId!, studentId: studentId!, submittedBy: actor.id, status: "entregada", submittedAt: now }),
        db.insert(submissionFiles).values({ submissionId: actualSubmissionId, fileId }),
        db.insert(auditLog).values({ id: crypto.randomUUID(), actorId: actor.id, action: "upload_evidence", entityType: "submission", entityId: actualSubmissionId, createdAt: now }),
      ]);
    }
  } catch (cause) {
    await deleteSchoolFile(env, objectKey).catch(() => undefined);
    if (cause instanceof SupabaseDatabaseError && cause.status === 403) return errorResponse(403, "No tienes permiso para adjuntar ese archivo.");
    if (cause instanceof SupabaseDatabaseError && cause.status === 404) return errorResponse(404, "La tarea o el alumno ya no están disponibles.");
    if (cause instanceof SupabaseDatabaseError && cause.status === 400) return errorResponse(400, "El archivo no cumple los requisitos de la tarea.");
    return errorResponse(500, "No se pudo guardar el archivo.");
  }
  return Response.json({ id: fileId, name, sizeBytes: bytes.length }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
