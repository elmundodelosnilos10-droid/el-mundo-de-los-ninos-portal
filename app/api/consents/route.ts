import { env } from "@/lib/runtime/env";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { auditLog, consents, guardians, studentGuardians, students, user } from "@/db/schema";
import { actorFromRequest, errorResponse, hasRole } from "@/lib/access";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";

import { createSchoolDatabaseClient, SupabaseDatabaseError } from "@/lib/supabase/database";
import { readConsentDirectory, recordConsent } from "@/lib/supabase/privacy-administration";

const input = z.object({
  studentId: z.uuid(),
  guardianId: z.uuid(),
  purpose: z.enum(["school_activity_image", "public_image", "class_recording"]),
  granted: z.boolean(),
  noticeVersion: z.string().trim().min(1).max(50),
  evidenceReference: z.string().trim().min(1).max(100),
  expiresAt: z.iso.datetime().nullable().optional(),
});

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin", "direccion")) return errorResponse(403, "Solo Dirección puede consultar este registro.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    try { return Response.json(await readConsentDirectory(createSchoolDatabaseClient(env), actor), { headers: noStore }); }
    catch { return errorResponse(503, "No se pudo consultar el registro escolar."); }
  }
  const db = getDb();
  const [records, studentsList, guardiansList] = await Promise.all([
    db.select({ id: consents.id, studentId: consents.studentId, studentName: students.givenName, studentFamilyName: students.familyName, guardianId: consents.guardianId, guardianName: user.name, purpose: consents.purpose, granted: consents.granted, recordedAt: consents.recordedAt, expiresAt: consents.expiresAt, noticeVersion: consents.noticeVersion, evidenceReference: consents.evidenceReference })
      .from(consents).innerJoin(students, eq(students.id, consents.studentId)).innerJoin(guardians, eq(guardians.id, consents.guardianId)).innerJoin(user, eq(user.id, guardians.userId)).orderBy(desc(consents.recordedAt)).limit(200),
    db.select({ id: students.id, givenName: students.givenName, familyName: students.familyName }).from(students).where(eq(students.active, true)).orderBy(asc(students.familyName), asc(students.givenName)),
    db.select({ id: guardians.id, name: user.name, studentId: studentGuardians.studentId }).from(guardians).innerJoin(user, eq(user.id, guardians.userId)).innerJoin(studentGuardians, eq(studentGuardians.guardianId, guardians.id)).where(and(eq(guardians.active, true), eq(studentGuardians.active, true))).orderBy(asc(user.name)),
  ]);
  return Response.json({ items: records, students: studentsList, guardians: guardiansList }, { headers: noStore });
}

export async function POST(request: Request) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403, "Solicitud no válida.");
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin", "direccion")) return errorResponse(403, "Solo Dirección puede registrar un comprobante.");
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, "Completa los datos y la referencia del comprobante escolar.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    try { return Response.json(await recordConsent(createSchoolDatabaseClient(env), actor, parsed.data), { status: 201, headers: noStore }); }
    catch (cause) {
      if (cause instanceof SupabaseDatabaseError && cause.status === 403) return errorResponse(403, "No tienes permiso para esta operación.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 404) return errorResponse(404, "El registro o vínculo escolar no está disponible.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 409) return errorResponse(409, "No se pudo registrar el comprobante. Recarga el historial antes de continuar.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 400) return errorResponse(400, "Utiliza una versión del aviso aprobado, publicado y vigente. La fecha de vencimiento debe ser futura.");
      return errorResponse(503, "No se pudo confirmar el registro. Revisa el listado antes de intentar otra vez.");
    }
  }
  const db = getDb();
  const linked = await db.select({ studentId: studentGuardians.studentId }).from(studentGuardians)
    .innerJoin(students, eq(students.id, studentGuardians.studentId)).innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
    .where(and(eq(studentGuardians.studentId, parsed.data.studentId), eq(studentGuardians.guardianId, parsed.data.guardianId), eq(studentGuardians.active, true), eq(students.active, true), eq(guardians.active, true))).limit(1);
  if (!linked.length) return errorResponse(404, "El alumno y tutor deben estar activos y vinculados.");
  const id = crypto.randomUUID();
  const now = new Date();
  try {
    await db.batch([
      db.insert(consents).values({ id, studentId: parsed.data.studentId, guardianId: parsed.data.guardianId, purpose: parsed.data.purpose, granted: parsed.data.granted, recordedAt: now, expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null, noticeVersion: parsed.data.noticeVersion, evidenceReference: parsed.data.evidenceReference, recordedBy: actor.id }),
      db.insert(auditLog).values({ id: crypto.randomUUID(), actorId: actor.id, action: "record_consent_evidence", entityType: "consent", entityId: id, createdAt: now }),
    ]);
  } catch { return errorResponse(500, "No se pudo guardar el registro. Inténtalo de nuevo."); }
  return Response.json({ id, saved: true }, { status: 201, headers: noStore });
}
