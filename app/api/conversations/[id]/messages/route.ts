import { env } from "@/lib/runtime/env";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { auditLog, files, messages, notifications, user } from "@/db/schema";
import { actorFromRequest, errorResponse, hasRole } from "@/lib/access";
import { authorizedConversation } from "@/lib/conversation-access";
import { getCommunicationHours, isWithinCommunicationHours } from "@/lib/communication-hours";
import { stripImageMetadata } from "@/lib/image-metadata";
import { scanUploadedFile } from "@/lib/file-scanner";
import { checkDeclaredRequestSize, readMultipartFormDataLimited } from "@/lib/upload-request-guard";
import { SCHOOL_UPLOAD_MAX_BODY_BYTES, SCHOOL_UPLOAD_MAX_FILE_BYTES, SCHOOL_UPLOAD_SIZE_MESSAGE } from "@/lib/school-upload-limits";
import { deleteSchoolFile, isFileStorageConfigured, newFileObjectKey, putSchoolFile } from "@/lib/file-storage";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";
import { createSchoolDatabaseClient, SupabaseDatabaseError } from "@/lib/supabase/database";

const input = z.object({ body: z.string().trim().min(1).max(3000) });
const attachedInput = z.object({ body: z.string().trim().max(3000).optional() });
const supabaseCursor = z.string().max(100).regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z\|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const cursorInput = z.object({ beforeOrder: z.union([z.coerce.number().int().positive(), supabaseCursor]).optional() });
const MESSAGE_PAGE_SIZE = 50;
const safeName = (name: string) => name.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[\\/]/g, "_").slice(0, 160) || "archivo";

function isAllowedAttachment(file: File, bytes: Uint8Array) {
  if (file.type === "application/pdf") return new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
  if (file.type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (file.type === "image/png") return bytes.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10";
  if (file.type === "image/webp") return new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
  return false;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  const { id } = await context.params;
  const params = new URL(request.url).searchParams;
  const cursor = cursorInput.safeParse({ beforeOrder: params.get("beforeOrder") ?? undefined });
  if (!cursor.success) return errorResponse(400, "El cursor del historial no es válido.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    if (!z.uuid().safeParse(id).success) return errorResponse(404, "Conversación no disponible.");
    if (cursor.data.beforeOrder !== undefined && typeof cursor.data.beforeOrder !== "string") return errorResponse(400, "El cursor del historial no es válido.");
    const [beforeSentAt, beforeId] = typeof cursor.data.beforeOrder === "string" ? cursor.data.beforeOrder.split("|") : [null, null];
    try {
      const { data } = await createSchoolDatabaseClient(env).rpc<{ items?: unknown[]; hasOlder?: boolean }>(actor.supabaseAuth.accessToken, "school_message_page", {
        p_conversation_id: id, p_before_sent_at: beforeSentAt, p_before_id: beforeId, p_limit: MESSAGE_PAGE_SIZE,
      });
      const page = data[0];
      const items = page?.items ?? [];
      const hasOlder = page?.hasOlder === true;
      const firstItem = items[0] as { order?: unknown } | undefined;
      return Response.json({ items, hasOlder, nextCursor: hasOlder && typeof firstItem?.order === "string" ? { beforeOrder: firstItem.order } : null }, { headers: { "Cache-Control": "no-store" } });
    } catch (cause) {
      if (cause instanceof SupabaseDatabaseError && (cause.status === 400 || cause.status === 403 || cause.status === 404)) return errorResponse(404, "Conversación no disponible.");
      return errorResponse(503, "No se pudieron consultar los mensajes.");
    }
  }
  if (cursor.data.beforeOrder !== undefined && typeof cursor.data.beforeOrder !== "number") return errorResponse(400, "El cursor del historial no es válido.");
  if (!(await authorizedConversation(id, actor.id, actor.roles))) return errorResponse(404, "Conversación no disponible.");
  const db = getDb();
  const messageOrder = sql<number>`messages.rowid`;
  const cursorWhere = cursor.data.beforeOrder
    ? lt(messageOrder, cursor.data.beforeOrder)
    : undefined;
  const selected = await db.select({ id: messages.id, body: messages.body, sentAt: messages.sentAt, authorId: messages.authorId, authorName: user.name, readAt: messages.readAt, isMine: eq(messages.authorId, actor.id), fileId: files.id, fileName: files.originalName, fileDeletedAt: files.deletedAt, order: messageOrder })
    .from(messages).innerJoin(user, eq(user.id, messages.authorId)).leftJoin(files, eq(files.id, messages.fileId))
    .where(cursorWhere ? and(eq(messages.conversationId, id), cursorWhere) : eq(messages.conversationId, id))
    .orderBy(desc(messageOrder)).limit(MESSAGE_PAGE_SIZE + 1);
  const hasOlder = selected.length > MESSAGE_PAGE_SIZE;
  const page = selected.slice(0, MESSAGE_PAGE_SIZE);
  const items = page.reverse().map(row => ({
    ...row,
    file: row.fileId && row.fileName && !row.fileDeletedAt ? { id: row.fileId, name: row.fileName, url: `/api/files/${row.fileId}` } : null,
  }));
  const oldest = items[0];
  return Response.json({ items, hasOlder, nextCursor: hasOlder && oldest ? { beforeOrder: oldest.order } : null }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403, "Solicitud no válida.");
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "docente", "tutor")) return errorResponse(403, "El chat está disponible para familias y docentes.");
  const { id } = await context.params;
  let conversation: Awaited<ReturnType<typeof authorizedConversation>> = null;
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    if (!z.uuid().safeParse(id).success) return errorResponse(404, "Conversación no disponible.");
    try {
      const result = await createSchoolDatabaseClient(env).select<{ id: string }>(actor.supabaseAuth.accessToken, "conversations", {
        columns: ["id"], filters: [{ column: "id", operator: "eq", value: id }], limit: 1,
      });
      if (!result.data.length) return errorResponse(404, "Conversación no disponible.");
    } catch { return errorResponse(503, "No se pudo verificar la conversación."); }
  } else {
    conversation = await authorizedConversation(id, actor.id, actor.roles);
    if (!conversation) return errorResponse(404, "Conversación no disponible.");
  }
  let communicationHours: Awaited<ReturnType<typeof getCommunicationHours>>;
  try { communicationHours = await getCommunicationHours(actor); }
  catch { return errorResponse(503, "No se pudo verificar el horario de comunicación. Inténtalo más tarde."); }
  if (!isWithinCommunicationHours(communicationHours, new Date())) return errorResponse(409, "El horario de envío de mensajes está cerrado. Inténtalo durante el horario escolar indicado en Comunicación.");
  if (request.headers.get("content-type")?.includes("multipart/form-data")) {
    const sizeCheck = checkDeclaredRequestSize(request.headers.get("content-length"), SCHOOL_UPLOAD_MAX_BODY_BYTES);
    if (sizeCheck) {
      await request.body?.cancel().catch(() => undefined);
      return sizeCheck === "invalid"
        ? errorResponse(400, "El tamaño de la solicitud no es válido.")
        : errorResponse(413, "El archivo supera el límite de carga permitido.");
    }
  }

  let body = "";
  let attachment: File | null = null;
  let bytes: Uint8Array | null = null;
  if (request.headers.get("content-type")?.includes("multipart/form-data")) {
    const parsedBody = await readMultipartFormDataLimited(request, SCHOOL_UPLOAD_MAX_BODY_BYTES);
    if (parsedBody.tooLarge) return errorResponse(413, "El archivo supera el límite de carga permitido.");
    const form = parsedBody.form;
    if (!form) return errorResponse(400, "No se recibió un mensaje válido.");
    const parsed = attachedInput.safeParse({ body: form.get("body") ?? "" });
    if (!parsed.success) return errorResponse(400, "El mensaje no puede superar 3000 caracteres.");
    body = parsed.data.body ?? "";
    const candidate = form.get("file");
    attachment = candidate instanceof File && candidate.size > 0 ? candidate : null;
    if (!body && !attachment) return errorResponse(400, "Escribe un mensaje o adjunta un archivo.");
    if (attachment) {
      if (!isFileStorageConfigured(env)) return errorResponse(503, "El almacenamiento privado no está configurado.");
      if (attachment.size > SCHOOL_UPLOAD_MAX_FILE_BYTES) return errorResponse(400, SCHOOL_UPLOAD_SIZE_MESSAGE);
      if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(attachment.type)) return errorResponse(400, "Adjunta un PDF o una imagen JPG, PNG o WebP.");
      bytes = new Uint8Array(await attachment.arrayBuffer());
      if (!isAllowedAttachment(attachment, bytes)) return errorResponse(400, "El contenido del archivo no coincide con su tipo.");
      if (attachment.type.startsWith("image/")) {
        const sanitized = stripImageMetadata(attachment.type, bytes);
        if (!sanitized) return errorResponse(400, "La imagen está dañada o no se pudo quitar su información privada.");
        bytes = sanitized;
      }
      const scan = await scanUploadedFile({ url: env.SCHOOL_FILE_SCAN_URL, token: env.SCHOOL_FILE_SCAN_TOKEN, applicationUrl: env.BETTER_AUTH_URL, localTestMode: env.SCHOOL_FILE_SCAN_LOCAL_MOCK === "true" }, attachment.type, bytes);
      if (scan === "infected") return errorResponse(400, "El archivo no superó la revisión de seguridad.");
      if (scan !== "clean") return errorResponse(503, "No se pudo revisar el archivo. Inténtalo más tarde o contacta a Dirección.");
    }
  } else {
    const parsed = input.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return errorResponse(400, "Escribe un mensaje de hasta 3000 caracteres.");
    body = parsed.data.body;
  }

  const messageId = crypto.randomUUID();
  const now = new Date();
  const fileId = attachment ? crypto.randomUUID() : null;
  const objectKey = attachment ? newFileObjectKey(env, "message") : null;
  try {
    if (env.SCHOOL_DATA_PROVIDER === "supabase" && objectKey && !objectKey.startsWith("supabase:private/message/")) return errorResponse(503, "Configura el almacenamiento privado de Supabase para los adjuntos del chat.");
    if (attachment && bytes && objectKey) await putSchoolFile(env, objectKey, bytes, attachment.type, fileId!);
    if (env.SCHOOL_DATA_PROVIDER === "supabase") {
      const { data } = await createSchoolDatabaseClient(env).rpc<{ id?: string; sentAt?: string }>(actor.supabaseAuth!.accessToken, "school_send_message", {
        p_id: messageId,
        p_conversation_id: id,
        p_body: body,
        p_file_id: fileId,
        p_object_key: attachment ? objectKey : null,
        p_original_name: attachment ? safeName(attachment.name) : null,
        p_mime_type: attachment?.type ?? null,
        p_size_bytes: attachment ? (bytes?.length ?? attachment.size) : null,
      });
      const result = data[0];
      if (!result?.id) throw new Error("Supabase did not return the new message.");
      return Response.json({ id: result.id, sentAt: result.sentAt ?? now }, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    const db = getDb();
    const messageWrite = db.insert(messages).values({ id: messageId, conversationId: id, authorId: actor.id, body, fileId, sentAt: now });
    const notificationWrite = db.insert(notifications).values({ id: crypto.randomUUID(), userId: conversation!.recipientId, kind: "mensaje", title: "Tienes un mensaje nuevo", href: "/comunicacion", dedupeKey: `message:${messageId}`, createdAt: now });
    const auditWrite = db.insert(auditLog).values({ id: crypto.randomUUID(), actorId: actor.id, action: attachment ? "send_message_attachment" : "send_message", entityType: "conversation", entityId: id, createdAt: now });
    if (attachment && fileId && objectKey) {
      const fileWrite = db.insert(files).values({ id: fileId, objectKey, originalName: safeName(attachment.name), mimeType: attachment.type, sizeBytes: bytes?.length ?? attachment.size, purpose: "message", uploadedBy: actor.id, studentId: conversation!.studentId, createdAt: now });
      await db.batch([fileWrite, messageWrite, notificationWrite, auditWrite]);
    } else await db.batch([messageWrite, notificationWrite, auditWrite]);
  } catch {
    if (objectKey) await deleteSchoolFile(env, objectKey).catch(() => undefined);
    return errorResponse(500, "No se pudo guardar el mensaje.");
  }
  return Response.json({ id: messageId, sentAt: now }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
