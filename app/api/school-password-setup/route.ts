import { env } from "@/lib/runtime/env";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { auditLog, user, userRoles } from "@/db/schema";
import { errorResponse } from "@/lib/access";
import { getAuth } from "@/lib/auth";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";

const schoolEmail = "elmundodelosnilos10@gmail.com";
const oneUseKey = "temporary_school_password_setup_20261008";
const input = z.object({ password: z.string().min(12).max(128) });

async function sameSecret(a: string, b: string) {
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  const left = await digest(a); const right = await digest(b); let different = 0;
  for (let index = 0; index < left.length; index++) different |= left[index] ^ right[index];
  return different === 0;
}

export async function POST(request: Request) {
  if (env.SCHOOL_AUTH_PROVIDER === "supabase" || env.SCHOOL_DATA_PROVIDER === "supabase") {
    return errorResponse(409, "Para tu cuenta escolar de Supabase, usa Recuperar contraseña desde la página de acceso.");
  }
  const configured = env.SCHOOL_PASSWORD_SET_TOKEN;
  if (!configured || configured.length < 48 || !isSameOriginAuthRequest(request)) return errorResponse(404, "Configuración no disponible.");
  if (!(await sameSecret(request.headers.get("x-school-password-set-token") ?? "", configured))) return errorResponse(404, "Configuración no disponible.");
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, "La contraseña debe tener al menos 12 caracteres.");

  const db = getDb(); const auth = getAuth();
  const schoolAccount = await (await auth.$context).internalAdapter.findUserByEmail(schoolEmail, { includeAccounts: true });
  if (!schoolAccount) return errorResponse(404, "La cuenta escolar no está disponible.");
  const [active, adminRole] = await Promise.all([
    db.select({ active: user.active }).from(user).where(eq(user.id, schoolAccount.user.id)).limit(1),
    db.select({ role: userRoles.role }).from(userRoles).where(and(eq(userRoles.userId, schoolAccount.user.id), eq(userRoles.role, "superadmin"))).limit(1),
  ]);
  if (!active[0]?.active || !adminRole.length) return errorResponse(404, "La cuenta escolar no está disponible.");

  const now = new Date();
  const lock = await env.DB!.prepare("INSERT OR IGNORE INTO setup_state (key, completed_at) VALUES (?, ?)").bind(oneUseKey, Math.floor(now.getTime() / 1000)).run();
  if (lock.meta.changes !== 1) return errorResponse(409, "La configuración de contraseña ya se realizó.");
  try {
    const context = await auth.$context;
    const hashedPassword = await context.password.hash(parsed.data.password);
    const credential = await context.internalAdapter.findCredentialAccount(schoolAccount.user.id);
    if (credential) await context.internalAdapter.updatePassword(schoolAccount.user.id, hashedPassword);
    else await context.internalAdapter.createAccount({ userId: schoolAccount.user.id, providerId: "credential", accountId: schoolAccount.user.id, password: hashedPassword });
    await context.internalAdapter.deleteUserSessions(schoolAccount.user.id);
    await db.insert(auditLog).values({ id: crypto.randomUUID(), actorId: null, action: "school_password_set_one_use", entityType: "user", entityId: schoolAccount.user.id, createdAt: now });
    return Response.json({ updated: true }, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch {
    return errorResponse(500, "No se pudo aplicar la contraseña. Contacta a Dirección.");
  }
}
