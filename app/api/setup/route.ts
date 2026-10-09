import { env } from "@/lib/runtime/env";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { auditLog, setupState, user, userRoles } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { errorResponse } from "@/lib/access";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";

const input = z.object({ email: z.email(), name: z.string().trim().min(2).max(100), password: z.string().min(12).max(128) });

async function sameSecret(a: string, b: string) {
  const hash = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const left = await hash(a);
  const right = await hash(b);
  let different = 0;
  for (let i = 0; i < left.length; i++) different |= left[i] ^ right[i];
  return different === 0;
}

export async function POST(request: Request) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403, "Configuración inicial no disponible.");
  if (env.SCHOOL_AUTH_PROVIDER === "supabase" || env.SCHOOL_DATA_PROVIDER === "supabase") {
    return errorResponse(409, "La configuración inicial de Supabase se administra mediante las cuentas escolares autorizadas.");
  }
  if (!env.SCHOOL_SETUP_TOKEN || env.SCHOOL_SETUP_TOKEN.length < 32) return errorResponse(403, "Configuración inicial no disponible.");
  const token = request.headers.get("x-school-setup-token") ?? "";
  if (!(await sameSecret(token, env.SCHOOL_SETUP_TOKEN))) return errorResponse(403, "Configuración inicial no disponible.");
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, "Revisa el correo, el nombre y la contraseña.");
  const db = getDb();
  const [existingUser, completed] = await Promise.all([
    db.select({ id: user.id }).from(user).limit(1),
    db.select({ key: setupState.key }).from(setupState).where(eq(setupState.key, "first_account")).limit(1),
  ]);
  if (existingUser.length || completed.length) return errorResponse(403, "La configuración inicial ya se realizó.");
  const lock = await env.DB!.prepare("INSERT OR IGNORE INTO setup_state (key, completed_at) VALUES ('first_account', ?)").bind(Math.floor(Date.now() / 1000)).run();
  if (lock.meta.changes !== 1) return errorResponse(403, "La configuración inicial ya se realizó.");
  try {
    const created = await getAuth().api.signUpEmail({ body: { email: parsed.data.email.toLowerCase(), name: parsed.data.name, password: parsed.data.password } });
    if (!created?.user?.id) return errorResponse(500, "No se pudo crear la cuenta inicial.");
    await db.batch([
      db.insert(userRoles).values({ userId: created.user.id, role: "superadmin", assignedAt: new Date() }),
      db.insert(auditLog).values({ id: crypto.randomUUID(), actorId: created.user.id, action: "bootstrap", entityType: "user", entityId: created.user.id, createdAt: new Date() }),
    ]);
    return Response.json({ created: true }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch {
    // Keep the one-use lock to prevent repeated attempts. An operator must
    // inspect the database before any explicit recovery procedure.
    return errorResponse(500, "No se pudo completar la configuración. Dirección debe revisar el estado antes de reintentar.");
  }
}
