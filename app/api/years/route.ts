import { env } from "@/lib/runtime/env";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { auditLog, schoolYears } from "@/db/schema";
import { actorFromRequest, errorResponse, hasRole } from "@/lib/access";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";
import { createSchoolDatabaseClient, SupabaseDatabaseError } from "@/lib/supabase/database";

const input = z.object({ name: z.string().trim().min(4).max(40), startsOn: z.iso.date(), endsOn: z.iso.date() });

export async function GET(request: Request) {
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin", "direccion")) return errorResponse(403, "No tienes permiso para consultar ciclos.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    try {
      const { data } = await createSchoolDatabaseClient(env).select(actor.supabaseAuth.accessToken, "school_years", {
        columns: ["id", "name", "starts_on", "ends_on", "active"], orderBy: [{ column: "active", ascending: false }, { column: "starts_on" }], limit: 500,
      });
      return Response.json({ items: data.map(row => ({ id: row.id, name: row.name, startsOn: row.starts_on, endsOn: row.ends_on, active: row.active })) }, { headers: { "Cache-Control": "no-store" } });
    } catch { return errorResponse(503, "No se pudieron consultar los ciclos escolares."); }
  }
  const records = await getDb().select().from(schoolYears);
  return Response.json({ items: records }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403, "Solicitud no válida.");
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin", "direccion")) return errorResponse(403, "No tienes permiso para crear ciclos.");
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.startsOn >= parsed.data.endsOn) return errorResponse(400, "Revisa el nombre y las fechas del ciclo.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    try {
      const id = crypto.randomUUID();
      await createSchoolDatabaseClient(env).rpc(actor.supabaseAuth.accessToken, "school_create_year", {
        p_id: id, p_name: parsed.data.name, p_starts_on: parsed.data.startsOn, p_ends_on: parsed.data.endsOn,
      });
      return Response.json({ id }, { status: 201, headers: { "Cache-Control": "no-store" } });
    } catch (cause) {
      if (cause instanceof SupabaseDatabaseError && cause.status === 409) return errorResponse(409, "Ya existe un ciclo con ese nombre.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 403) return errorResponse(403, "No tienes permiso para crear ciclos.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 400) return errorResponse(400, "Revisa el nombre y las fechas del ciclo.");
      return errorResponse(503, "No se pudo guardar el ciclo escolar.");
    }
  }
  const db = getDb();
  const duplicate = await db.select({ id: schoolYears.id }).from(schoolYears).where(eq(schoolYears.name, parsed.data.name)).limit(1);
  if (duplicate.length) return errorResponse(409, "Ya existe un ciclo con ese nombre.");
  const id = crypto.randomUUID();
  await db.batch([
    db.update(schoolYears).set({ active: false }),
    db.insert(schoolYears).values({ id, ...parsed.data, active: true }),
    db.insert(auditLog).values({ id: crypto.randomUUID(), actorId: actor.id, action: "create", entityType: "school_year", entityId: id, createdAt: new Date() }),
  ]);
  return Response.json({ id }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
