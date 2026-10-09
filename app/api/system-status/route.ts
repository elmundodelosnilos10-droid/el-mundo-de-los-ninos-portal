import { env } from "@/lib/runtime/env";
import { getDb } from "@/db";
import { auditLog } from "@/db/schema";
import { actorFromRequest, errorResponse, hasRole } from "@/lib/access";
import { createSchoolDatabaseClient } from "@/lib/supabase/database";
import { describeSchoolServiceConfiguration, readSchoolDatabaseStatus } from "@/lib/supabase/operations";
import { isRecoveryEmailConfigured } from "@/lib/recovery-email";
import { isFileScannerConfigured } from "@/lib/file-scanner";

export async function GET(request: Request) {
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin")) return errorResponse(403, "Solo Superadministración puede consultar el estado del sistema.");
  try {
    let database;
    if (env.SCHOOL_DATA_PROVIDER === "supabase") {
      if (!actor.supabaseAuth || actor.supabaseAuth.userId !== actor.id) return errorResponse(401, "Inicia sesión.");
      database = { verified: true, provider: "supabase", ...await readSchoolDatabaseStatus(createSchoolDatabaseClient(env), actor.supabaseAuth.accessToken) };
    } else {
      await getDb().select({ id: auditLog.id }).from(auditLog).limit(1);
      database = { verified: true, provider: "d1", checkedAt: new Date().toISOString() };
    }
    const configuration = describeSchoolServiceConfiguration(env, {
      recoveryConfigured: isRecoveryEmailConfigured(env),
      scannerConfigured: isFileScannerConfigured({ url: env.SCHOOL_FILE_SCAN_URL, token: env.SCHOOL_FILE_SCAN_TOKEN }),
    });
    return Response.json({ database, configuration }, { headers: { "Cache-Control": "no-store" } });
  } catch { return errorResponse(503, "No se pudo verificar la base de datos escolar. Vuelve a intentar en unos minutos."); }
}
