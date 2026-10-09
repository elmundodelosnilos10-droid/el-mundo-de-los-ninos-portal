import { env } from "@/lib/runtime/env";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { auditLog, notifications, privacyRequests } from "@/db/schema";
import { actorFromRequest, errorResponse, hasRole } from "@/lib/access";
import { canTransitionPrivacyRequest } from "@/lib/privacy-request-policy";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";

import { createSchoolDatabaseClient, SupabaseDatabaseError } from "@/lib/supabase/database";
import { updatePrivacyRequest } from "@/lib/supabase/privacy-administration";

const input = z.object({ status: z.enum(["en_revision", "respondida", "cerrada"]), responseNote: z.string().trim().min(5).max(1200).optional() });
const noStore = { "Cache-Control": "no-store" };

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403, "Solicitud no válida.");
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin", "direccion")) return errorResponse(403, "Solo Dirección puede actualizar una solicitud.");
  const { id } = await context.params;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success || ((parsed.data.status === "respondida" || parsed.data.status === "cerrada") && !parsed.data.responseNote)) return errorResponse(400, "Al responder o cerrar, escribe una nota breve para la familia.");
  if (!z.uuid().safeParse(id).success) return errorResponse(400, "La solicitud no es válida.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    try { return Response.json(await updatePrivacyRequest(createSchoolDatabaseClient(env), actor, id, parsed.data), { status: 200, headers: noStore }); }
    catch (cause) {
      if (cause instanceof SupabaseDatabaseError && cause.status === 403) return errorResponse(403, "No tienes permiso para esta operación.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 404) return errorResponse(404, "El registro o vínculo escolar no está disponible.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 409) return errorResponse(409, "Ese cambio no es válido para el estado actual. Recarga la solicitud para continuar.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 400) return errorResponse(400, "Al responder o cerrar, escribe una nota de 5 a 1200 caracteres para la familia.");
      return errorResponse(503, "No se pudo confirmar el registro. Revisa el listado antes de intentar otra vez.");
    }
  }
  const db = getDb();
  const [item] = await db.select({ id: privacyRequests.id, requesterId: privacyRequests.requesterId, studentId: privacyRequests.studentId, kind: privacyRequests.kind, status: privacyRequests.status }).from(privacyRequests).where(eq(privacyRequests.id, id)).limit(1);
  if (!item) return errorResponse(404, "Solicitud no disponible.");
  if (!canTransitionPrivacyRequest(item.status as "recibida" | "en_revision" | "respondida" | "cerrada", parsed.data.status)) return errorResponse(409, "Ese cambio no es válido para el estado actual de la solicitud.");
  const now = new Date();
  const changed = await db.update(privacyRequests).set({ status: parsed.data.status, openKey: parsed.data.status === "en_revision" ? `${item.studentId}:${item.requesterId}:${item.kind}` : null, responseNote: parsed.data.responseNote ?? null, updatedAt: now, respondedAt: parsed.data.status === "en_revision" ? null : now, resolvedBy: parsed.data.status === "en_revision" ? null : actor.id }).where(and(eq(privacyRequests.id, id), eq(privacyRequests.status, item.status))).returning({ id: privacyRequests.id });
  if (!changed.length) return errorResponse(409, "Otra actualización se guardó primero. Recarga la solicitud para continuar.");
  await db.batch([
    db.insert(auditLog).values({ id: crypto.randomUUID(), actorId: actor.id, action: "update_privacy_request_status", entityType: "privacy_request", entityId: id, createdAt: now }),
    db.insert(notifications).values({ id: crypto.randomUUID(), userId: item.requesterId, kind: `privacy_request_${parsed.data.status}`, title: parsed.data.status === "en_revision" ? "Dirección está revisando tu solicitud" : parsed.data.status === "respondida" ? "Dirección respondió a tu solicitud" : "Dirección actualizó tu solicitud", href: "/privacidad", dedupeKey: `privacy-request:${id}:${parsed.data.status}:${now.getTime()}:${item.requesterId}`, createdAt: now }).onConflictDoNothing(),
  ]);
  return Response.json({ status: parsed.data.status }, { headers: noStore });
}
