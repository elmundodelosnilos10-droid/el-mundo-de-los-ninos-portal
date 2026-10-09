import { env } from "@/lib/runtime/env";
import { z } from "zod";
import { actorFromRequest, errorResponse, hasRole } from "@/lib/access";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";
import { createSchoolDatabaseClient, SupabaseDatabaseError } from "@/lib/supabase/database";
import { readExternalNoticePreferences, setExternalNoticePreference } from "@/lib/supabase/notification-delivery-preferences";
import { externalNoticeConfiguration, type ExternalNoticeEnvironment } from "@/lib/school-notification-delivery";
const noStore = { "Cache-Control": "private, no-store" };
const input = z.object({ channel: z.enum(["email", "webpush"]), enabled: z.boolean(), consentConfirmed: z.boolean().optional() });
function config() { return externalNoticeConfiguration(env as unknown as ExternalNoticeEnvironment); }
function failed(cause: unknown) {
  if (cause instanceof SupabaseDatabaseError && [400,403,404].includes(cause.status ?? 0)) return errorResponse(cause.status as 400 | 403 | 404, cause.status === 400 ? "Confirma tu autorización y usa el correo verificado de tu cuenta." : "No tienes acceso a esta configuración.");
  return errorResponse(503, "No se pudo confirmar la configuración de avisos. Consulta su estado antes de reintentar.");
}
export async function GET(request: Request) {
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor,"superadmin","direccion","docente","tutor")) return errorResponse(403,"Esta configuración es para las cuentas adultas autorizadas.");
  if (env.SCHOOL_DATA_PROVIDER !== "supabase" || !actor.supabaseAuth) return errorResponse(503,"Los avisos externos requieren la configuración escolar de Supabase.");
  try { return Response.json({ ...(await readExternalNoticePreferences(createSchoolDatabaseClient(env),actor)), capabilities: config(), deliveryGuaranteed: false }, { headers: noStore }); }
  catch (cause) { return failed(cause); }
}
export async function PATCH(request: Request) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403,"Solicitud no válida.");
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401,"Inicia sesión.");
  if (!hasRole(actor,"superadmin","direccion","docente","tutor")) return errorResponse(403,"Esta configuración es para las cuentas adultas autorizadas.");
  const body = input.safeParse(await request.json().catch(()=>null));
  if (!body.success || (body.data.enabled && body.data.consentConfirmed !== true)) return errorResponse(400,"Debes autorizar expresamente el canal de avisos.");
  if (env.SCHOOL_DATA_PROVIDER !== "supabase" || !actor.supabaseAuth) return errorResponse(503,"La configuración escolar no está disponible.");
  if (body.data.enabled && !config()[body.data.channel]) return errorResponse(409,"Este canal todavía no está habilitado por la escuela.");
  try { return Response.json(await setExternalNoticePreference(createSchoolDatabaseClient(env),actor,body.data.channel,body.data.enabled,body.data.consentConfirmed===true),{headers:noStore}); }
  catch(cause) { return failed(cause); }
}
