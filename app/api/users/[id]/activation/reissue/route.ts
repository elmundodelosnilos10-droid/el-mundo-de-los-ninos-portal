import { env } from "@/lib/runtime/env";
import { actorFromRequest, errorResponse, hasRole } from "@/lib/access";
import { createSchoolAuthClient } from "@/lib/supabase/auth";
import { createSchoolDatabaseClient } from "@/lib/supabase/database";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";
import { isInternalActivationSecret } from "@/lib/supabase/internal-activation";
import { reissueInternalActivation, InternalActivationReissueError } from "@/lib/supabase/internal-activation-reissue";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403, "Solicitud no válida.");
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin", "direccion")) return errorResponse(403, "No tienes permiso para renovar este acceso.");
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return errorResponse(400, "Revisa la cuenta.");
  if (env.SCHOOL_AUTH_PROVIDER !== "supabase" || env.SCHOOL_DATA_PROVIDER !== "supabase" || env.SCHOOL_ACCOUNT_ACTIVATION_MODE !== "internal" || !isInternalActivationSecret(env.SCHOOL_ACCOUNT_ACTIVATION_SECRET)) return errorResponse(503, "La renovación del primer acceso está pendiente de configuración por la escuela.");
  const deadline = AbortSignal.timeout(50_000);
  const boundedFetch: typeof fetch = (url, init) => fetch(url, { ...init,
    signal: AbortSignal.any([deadline, AbortSignal.timeout(15_000), ...(init?.signal ? [init.signal] : [])]),
  });
  try {
    const result = await reissueInternalActivation(() => createSchoolAuthClient(env, boundedFetch), createSchoolDatabaseClient(env, boundedFetch), actor, id, env.SCHOOL_ACCOUNT_ACTIVATION_SECRET);
    return Response.json(result, { status: 201, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  } catch (cause) {
    if (cause instanceof InternalActivationReissueError && cause.code === "forbidden") return errorResponse(403, "No tienes permiso para renovar este acceso.");
    if (cause instanceof InternalActivationReissueError && cause.code === "not_pending") return errorResponse(409, "Solo se pueden renovar invitaciones internas que todavía no se han verificado. Para una cuenta activada o un proceso interrumpido, solicita recuperación de acceso.");
    return Response.json({ error: "No se pudo confirmar la renovación. No repitas la solicitud: la escuela debe revisar el estado del acceso.", code: "reissue_uncertain" }, { status: 503, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  }
}
