import { env } from "@/lib/runtime/env";
import { z } from "zod";
import { actorFromRequest,errorResponse,hasRole } from "@/lib/access";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";
import { createSchoolDatabaseClient,SupabaseDatabaseError } from "@/lib/supabase/database";
import { storeExternalPushSubscription,removeExternalPushSubscription } from "@/lib/supabase/notification-delivery-preferences";
import { externalNoticeConfiguration,validatePushDestination,type ExternalNoticeEnvironment } from "@/lib/school-notification-delivery";
function failed(cause:unknown) {
  if(cause instanceof SupabaseDatabaseError && [400,403,404].includes(cause.status??0))return errorResponse(cause.status as 400 | 403 | 404,"La suscripción o autorización no está disponible para esta cuenta.");
  return errorResponse(503,"No se pudo confirmar la suscripción. Consulta su estado antes de reintentar.");
}
async function handle(request:Request,remove:boolean) {
  if(!isSameOriginAuthRequest(request))return errorResponse(403,"Solicitud no válida.");
  const actor=await actorFromRequest(request);
  if(!actor)return errorResponse(401,"Inicia sesión.");
  if(!hasRole(actor,"superadmin","direccion","docente","tutor"))return errorResponse(403,"Esta configuración es para las cuentas adultas autorizadas.");
  if(env.SCHOOL_DATA_PROVIDER!=="supabase"||!actor.supabaseAuth)return errorResponse(503,"La configuración escolar no está disponible.");
  const body=await request.json().catch(()=>null);
  if(remove){
    const parsed=z.object({id:z.uuid()}).safeParse(body);if(!parsed.success)return errorResponse(400,"Selecciona una suscripción válida.");
    try{return Response.json(await removeExternalPushSubscription(createSchoolDatabaseClient(env),actor,parsed.data.id),{headers:{"Cache-Control":"private, no-store"}});}catch(cause){return failed(cause);}
  }
  if(!externalNoticeConfiguration(env as unknown as ExternalNoticeEnvironment).webpush)return errorResponse(409,"Los avisos push todavía no están habilitados por la escuela.");
  let destination;try{destination=validatePushDestination(body);}catch{return errorResponse(400,"La suscripción push no es válida.");}
  try{return Response.json(await storeExternalPushSubscription(createSchoolDatabaseClient(env),actor,destination),{status:201,headers:{"Cache-Control":"private, no-store"}});}catch(cause){return failed(cause);}
}
export async function POST(request:Request){return handle(request,false);}
export async function DELETE(request:Request){return handle(request,true);}
