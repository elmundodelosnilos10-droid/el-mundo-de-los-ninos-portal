import { env } from "@/lib/runtime/env";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { auditLog, guardians, notifications, privacyRequests, studentGuardians, students, user, userRoles } from "@/db/schema";
import { actorFromRequest, errorResponse, hasRole } from "@/lib/access";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";

import { createSchoolDatabaseClient, SupabaseDatabaseError } from "@/lib/supabase/database";
import { readPrivacyDirectory, submitPrivacyRequest } from "@/lib/supabase/privacy-administration";

const input = z.object({ studentId: z.uuid(), kind: z.enum(["acceso", "correccion", "eliminacion"]), details: z.string().trim().min(10).max(1200) });
const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin", "direccion", "tutor")) return errorResponse(403, "Esta sección es para las familias y Dirección.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    try { return Response.json(await readPrivacyDirectory(createSchoolDatabaseClient(env), actor), { headers: noStore }); }
    catch (cause) {
      if (cause instanceof SupabaseDatabaseError && cause.status === 403) return errorResponse(403, "No tienes permiso para esta operación.");
      return errorResponse(503, "No se pudo consultar el registro escolar.");
    }
  }
  const db = getDb();
  if (hasRole(actor, "superadmin", "direccion")) {
    const items = await db.select({ id: privacyRequests.id, studentId: students.id, studentName: students.givenName, studentFamilyName: students.familyName, requesterId: privacyRequests.requesterId, requesterName: user.name, kind: privacyRequests.kind, details: privacyRequests.details, status: privacyRequests.status, responseNote: privacyRequests.responseNote, createdAt: privacyRequests.createdAt, updatedAt: privacyRequests.updatedAt, respondedAt: privacyRequests.respondedAt })
      .from(privacyRequests).innerJoin(students, eq(students.id, privacyRequests.studentId)).innerJoin(user, eq(user.id, privacyRequests.requesterId)).orderBy(desc(privacyRequests.updatedAt)).limit(200);
    return Response.json({ items }, { headers: noStore });
  }
  const [items, linkedStudents] = await Promise.all([
    db.select({ id: privacyRequests.id, studentId: students.id, studentName: students.givenName, studentFamilyName: students.familyName, kind: privacyRequests.kind, details: privacyRequests.details, status: privacyRequests.status, responseNote: privacyRequests.responseNote, createdAt: privacyRequests.createdAt, updatedAt: privacyRequests.updatedAt, respondedAt: privacyRequests.respondedAt })
      .from(privacyRequests).innerJoin(students, eq(students.id, privacyRequests.studentId)).where(eq(privacyRequests.requesterId, actor.id)).orderBy(desc(privacyRequests.updatedAt)).limit(100),
    db.selectDistinct({ id: students.id, givenName: students.givenName, familyName: students.familyName }).from(studentGuardians).innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId)).innerJoin(students, eq(students.id, studentGuardians.studentId))
      .where(and(eq(guardians.userId, actor.id), eq(guardians.active, true), eq(studentGuardians.active, true), eq(students.active, true))),
  ]);
  return Response.json({ items, students: linkedStudents }, { headers: noStore });
}

export async function POST(request: Request) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403, "Solicitud no válida.");
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "tutor")) return errorResponse(403, "Solo una familia autorizada puede enviar una solicitud.");
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, "Selecciona a tu hijo y describe la solicitud (10 a 1200 caracteres).");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    try { return Response.json(await submitPrivacyRequest(createSchoolDatabaseClient(env), actor, parsed.data), { status: 201, headers: noStore }); }
    catch (cause) {
      if (cause instanceof SupabaseDatabaseError && cause.status === 403) return errorResponse(403, "No tienes permiso para esta operación.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 404) return errorResponse(404, "El registro o vínculo escolar no está disponible.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 409) return errorResponse(409, "Ya existe una solicitud pendiente de ese tipo para ese alumno.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 400) return errorResponse(400, "Selecciona a tu hijo y describe la solicitud (10 a 1200 caracteres).");
      return errorResponse(503, "No se pudo confirmar el registro. Revisa el listado antes de intentar otra vez.");
    }
  }
  const db = getDb();
  const linked = await db.select({ id: students.id }).from(studentGuardians).innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId)).innerJoin(students, eq(students.id, studentGuardians.studentId))
    .where(and(eq(guardians.userId, actor.id), eq(guardians.active, true), eq(studentGuardians.studentId, parsed.data.studentId), eq(studentGuardians.active, true), eq(students.active, true))).limit(1);
  if (!linked.length) return errorResponse(404, "Alumno no disponible para esta cuenta.");
  const pending = await db.select({ id: privacyRequests.id }).from(privacyRequests).where(and(eq(privacyRequests.studentId, parsed.data.studentId), eq(privacyRequests.requesterId, actor.id), eq(privacyRequests.kind, parsed.data.kind), inArray(privacyRequests.status, ["recibida", "en_revision"]))).limit(1);
  if (pending.length) return errorResponse(409, "Ya hay una solicitud de este tipo pendiente de revisión para ese alumno.");
  const now = new Date(); const id = crypto.randomUUID();
  const schoolLeaders = await db.selectDistinct({ id: user.id }).from(userRoles).innerJoin(user, eq(user.id, userRoles.userId)).where(and(inArray(userRoles.role, ["superadmin", "direccion"]), eq(user.active, true)));
  try {
    await db.batch([
      db.insert(privacyRequests).values({ id, studentId: parsed.data.studentId, requesterId: actor.id, kind: parsed.data.kind, details: parsed.data.details, status: "recibida", openKey: `${parsed.data.studentId}:${actor.id}:${parsed.data.kind}`, createdAt: now, updatedAt: now }),
      db.insert(auditLog).values({ id: crypto.randomUUID(), actorId: actor.id, action: "submit_privacy_request", entityType: "privacy_request", entityId: id, createdAt: now }),
      ...schoolLeaders.map(recipient => db.insert(notifications).values({ id: crypto.randomUUID(), userId: recipient.id, kind: "privacy_request", title: "Nueva solicitud familiar de privacidad", href: "/privacidad", dedupeKey: `privacy-request:${id}:received:${recipient.id}`, createdAt: now }).onConflictDoNothing()),
    ]);
  } catch (cause) {
    if (/unique|constraint/i.test(String(cause))) return errorResponse(409, "Ya existe una solicitud pendiente de ese tipo para ese alumno.");
    return errorResponse(500, "No se pudo guardar la solicitud. Inténtalo de nuevo.");
  }
  return Response.json({ id, status: "recibida" }, { status: 201, headers: noStore });
}
