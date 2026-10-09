import { env } from "@/lib/runtime/env";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { auditLog, privacyNotices } from "@/db/schema";
import { actorFromRequest, errorResponse, hasRole } from "@/lib/access";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";

import { createSchoolDatabaseClient, SupabaseDatabaseError } from "@/lib/supabase/database";
import { publishPrivacyNotice } from "@/lib/supabase/privacy-administration";
import { readPublicPrivacyNotice } from "@/lib/supabase/public-privacy-notice";

const publication = z.object({
  version: z.string().trim().min(1).max(50),
  responsibleName: z.string().trim().min(2).max(180),
  address: z.string().trim().min(5).max(500),
  contactName: z.string().trim().min(2).max(120),
  contactEmail: z.email().max(254),
  personalDataCategories: z.string().trim().min(20).max(4000),
  sensitiveDataCategories: z.string().trim().min(10).max(3000),
  purposes: z.string().trim().min(20).max(4000),
  consentPurposes: z.string().trim().min(10).max(3000),
  limitationMeans: z.string().trim().min(10).max(3000),
  arcoProcedure: z.string().trim().min(20).max(4000),
  noticeChanges: z.string().trim().min(10).max(3000),
  processorsAndTransfers: z.string().trim().min(10).max(4000),
  effectiveDate: z.iso.date(),
  approvalConfirmed: z.literal(true),
});

const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    try { return Response.json({ notice: await readPublicPrivacyNotice(env) }, { headers: noStore }); }
    catch { return errorResponse(503, "No se pudo consultar el aviso aprobado de la escuela."); }
  }
  const [notice] = await getDb().select({
    id: privacyNotices.id,
    version: privacyNotices.version,
    responsibleName: privacyNotices.responsibleName,
    address: privacyNotices.address,
    contactName: privacyNotices.contactName,
    contactEmail: privacyNotices.contactEmail,
    personalDataCategories: privacyNotices.personalDataCategories,
    sensitiveDataCategories: privacyNotices.sensitiveDataCategories,
    purposes: privacyNotices.purposes,
    consentPurposes: privacyNotices.consentPurposes,
    limitationMeans: privacyNotices.limitationMeans,
    arcoProcedure: privacyNotices.arcoProcedure,
    noticeChanges: privacyNotices.noticeChanges,
    processorsAndTransfers: privacyNotices.processorsAndTransfers,
    effectiveDate: privacyNotices.effectiveDate,
    publishedAt: privacyNotices.publishedAt,
  }).from(privacyNotices).orderBy(desc(privacyNotices.publishedAt)).limit(1);
  return Response.json({ notice: notice ?? null }, { headers: noStore });
}

export async function POST(request: Request) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403, "Solicitud no válida.");
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin")) return errorResponse(403, "Solo Superadministración puede publicar el aviso.");

  const parsed = publication.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, "Completa todos los apartados e indica que la escuela aprobó el texto antes de publicarlo.");

  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    try { return Response.json(await publishPrivacyNotice(createSchoolDatabaseClient(env), actor, parsed.data), { status: 201, headers: noStore }); }
    catch (cause) {
      if (cause instanceof SupabaseDatabaseError && cause.status === 403) return errorResponse(403, "No tienes permiso para esta operación.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 404) return errorResponse(404, "El registro o vínculo escolar no está disponible.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 409) return errorResponse(409, "Esa versión ya existe. Publica una versión nueva para conservar el historial.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 400) return errorResponse(400, "Revisa todos los apartados y confirma que la escuela aprobó este texto.");
      return errorResponse(503, "No se pudo confirmar el registro. Revisa el listado antes de intentar otra vez.");
    }
  }
  const db = getDb();
  const [duplicate] = await db.select({ id: privacyNotices.id }).from(privacyNotices).where(eq(privacyNotices.version, parsed.data.version)).limit(1);
  if (duplicate) return errorResponse(409, "Esa versión ya existe. Publica una versión nueva para conservar el historial.");

  const id = crypto.randomUUID();
  const now = new Date();
  const content = {
    version: parsed.data.version,
    responsibleName: parsed.data.responsibleName,
    address: parsed.data.address,
    contactName: parsed.data.contactName,
    contactEmail: parsed.data.contactEmail,
    personalDataCategories: parsed.data.personalDataCategories,
    sensitiveDataCategories: parsed.data.sensitiveDataCategories,
    purposes: parsed.data.purposes,
    consentPurposes: parsed.data.consentPurposes,
    limitationMeans: parsed.data.limitationMeans,
    arcoProcedure: parsed.data.arcoProcedure,
    noticeChanges: parsed.data.noticeChanges,
    processorsAndTransfers: parsed.data.processorsAndTransfers,
    effectiveDate: parsed.data.effectiveDate,
  };
  try {
    await db.batch([
      db.insert(privacyNotices).values({ id, ...content, approvedBy: actor.id, approvedAt: now, publishedAt: now }),
      db.insert(auditLog).values({ id: crypto.randomUUID(), actorId: actor.id, action: "publish_privacy_notice", entityType: "privacy_notice", entityId: id, createdAt: now }),
    ]);
  } catch (cause) {
    if (/unique|constraint/i.test(String(cause))) return errorResponse(409, "Esa versión ya existe. Publica una versión nueva para conservar el historial.");
    return errorResponse(500, "No se pudo publicar el aviso. Inténtalo de nuevo.");
  }
  return Response.json({ id, version: content.version, publishedAt: now }, { status: 201, headers: noStore });
}
