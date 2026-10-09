import { env } from "@/lib/runtime/env";
import { and, eq, isNull, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { messages } from "@/db/schema";
import { actorFromRequest, errorResponse, hasRole } from "@/lib/access";
import { authorizedConversation } from "@/lib/conversation-access";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";
import { createSchoolDatabaseClient, SupabaseDatabaseError } from "@/lib/supabase/database";

const supabaseOrder = z.string().max(100).regex(/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z)\|([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403, "Solicitud no válida.");
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "docente", "tutor")) return errorResponse(403, "El chat está disponible para familias y docentes.");
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as { throughOrder?: unknown } | null;
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    const parsed = supabaseOrder.safeParse(body?.throughOrder);
    if (!parsed.success) return errorResponse(400, "Indica el último mensaje visible.");
    const [throughSentAt, throughId] = parsed.data.split("|");
    try {
      const { data } = await createSchoolDatabaseClient(env).rpc<{ readAt?: string }>(actor.supabaseAuth.accessToken, "school_mark_conversation_read", {
        p_conversation_id: id, p_through_sent_at: throughSentAt, p_through_id: throughId,
      });
      if (!data[0]?.readAt) return errorResponse(503, "No se pudo registrar la lectura del chat.");
      return Response.json({ readAt: data[0].readAt }, { headers: { "Cache-Control": "no-store" } });
    } catch (cause) {
      if (cause instanceof SupabaseDatabaseError && (cause.status === 400 || cause.status === 403 || cause.status === 404)) return errorResponse(404, "Conversación no disponible.");
      return errorResponse(503, "No se pudo registrar la lectura del chat.");
    }
  }
  if (!body || !Number.isSafeInteger(body.throughOrder) || Number(body?.throughOrder) <= 0) return errorResponse(400, "Indica el último mensaje visible.");
  if (!(await authorizedConversation(id, actor.id, actor.roles))) return errorResponse(404, "Conversación no disponible.");

  const readAt = new Date();
  const messageOrder = sql<number>`messages.rowid`;
  await getDb().update(messages).set({ readAt }).where(and(
    eq(messages.conversationId, id),
    ne(messages.authorId, actor.id),
    isNull(messages.readAt),
    lte(messageOrder, Number(body.throughOrder)),
  ));
  return Response.json({ readAt }, { headers: { "Cache-Control": "no-store" } });
}
