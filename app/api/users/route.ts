import type { BatchItem } from "drizzle-orm/batch";
import { and, asc, count, eq, like, or } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { env } from "@/lib/runtime/env";
import { auditLog, guardians, teachers, user, userRoles } from "@/db/schema";
import { actorFromRequest, errorResponse, hasRole } from "@/lib/access";
import { getAuth } from "@/lib/auth";
import { createSchoolAuthClient, SupabaseAuthError } from "@/lib/supabase/auth";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";
import { checkInvitationIdentity } from "@/lib/supabase/invitation-recovery";
import { paginationFrom, searchFrom } from "@/lib/pagination";
import { createSchoolDatabaseClient } from "@/lib/supabase/database";
import { readSchoolAccounts } from "@/lib/supabase/account-feed";
import { inviteSchoolAccount, SchoolAccountAdministrationError } from "@/lib/supabase/account-administration";
import { createInternalActivationCode, isInternalActivationSecret } from "@/lib/supabase/internal-activation";
import { isInternalActivationDatabaseReady } from "@/lib/supabase/internal-activation-database";

const input = z.object({
  email: z.email(),
  name: z.string().trim().min(2).max(100),
  password: z.string().min(12).max(128).optional(),
  role: z.enum(["direccion", "docente", "tutor"]),
});

export async function GET(request: Request) {
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin", "direccion")) return errorResponse(403, "No tienes permiso para consultar cuentas.");
  const { page, pageSize, offset } = paginationFrom(request);
  const query = searchFrom(request);
  const url = new URL(request.url);
  const role = url.searchParams.get("role");
  const status = url.searchParams.get("status");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(401, "Inicia sesión.");
    try {
      const feed = await readSchoolAccounts(createSchoolDatabaseClient(env), actor.supabaseAuth.accessToken, {
        query, role: role && ["superadmin", "direccion", "docente", "tutor", "alumno"].includes(role) ? role : null,
        status: status === "activas" || status === "desactivadas" ? status : null, page, pageSize,
      });
      return Response.json(feed, { headers: { "Cache-Control": "no-store" } });
    } catch { return errorResponse(503, "No se pudieron cargar las cuentas escolares."); }
  }
  const db = getDb();
  const where = [];
  if (query) where.push(or(like(user.name, `%${query}%`), like(user.email, `%${query}%`))!);
  if (role && ["superadmin", "direccion", "docente", "tutor"].includes(role)) where.push(eq(userRoles.role, role as "superadmin" | "direccion" | "docente" | "tutor"));
  if (status === "activas") where.push(eq(user.active, true));
  if (status === "desactivadas") where.push(eq(user.active, false));
  const condition = where.length ? and(...where) : undefined;
  const [rows, totals] = await Promise.all([
    db.select({ id: user.id, name: user.name, email: user.email, active: user.active, role: userRoles.role }).from(user).innerJoin(userRoles, eq(userRoles.userId, user.id)).where(condition).orderBy(asc(user.name), asc(user.id)).limit(pageSize).offset(offset),
    db.select({ total: count() }).from(user).innerJoin(userRoles, eq(userRoles.userId, user.id)).where(condition),
  ]);
  return Response.json({ items: rows, total: totals[0]?.total ?? 0, page, pageSize }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403, "Solicitud no válida.");
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin", "direccion")) return errorResponse(403, "No tienes permiso para crear cuentas.");
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, "Revisa los datos de la cuenta.");
  const useSupabase = env.SCHOOL_AUTH_PROVIDER === "supabase";
  if (!useSupabase && !parsed.data.password) return errorResponse(400, "La contraseña inicial es obligatoria.");
  if (parsed.data.role === "direccion" && !hasRole(actor, "superadmin")) return errorResponse(403, "Solo la administración general puede asignar dirección.");
  const email = parsed.data.email.trim().toLowerCase();
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (env.SCHOOL_AUTH_PROVIDER !== "supabase") return errorResponse(503, "Configura Supabase Auth para administrar las cuentas de la escuela.");
    const internal = env.SCHOOL_ACCOUNT_ACTIVATION_MODE === "internal";
    if (internal && !isInternalActivationSecret(env.SCHOOL_ACCOUNT_ACTIVATION_SECRET)) return errorResponse(503, "El primer acceso está pendiente de configuración por la escuela.");
    try {
      if (internal && (!actor.supabaseAuth || !await isInternalActivationDatabaseReady(env, actor.supabaseAuth.accessToken))) return errorResponse(503, "El primer acceso está pendiente de configuración por la escuela.");
      const created = await inviteSchoolAccount(createSchoolAuthClient(env), createSchoolDatabaseClient(env), actor, {
        email, name: parsed.data.name, role: parsed.data.role,
      }, env.APP_ORIGIN, { delivery: internal ? "internal" : "email" });
      if (created.activationIdentity) {
        const activation = await createInternalActivationCode(created.activationIdentity, env.SCHOOL_ACCOUNT_ACTIVATION_SECRET!);
        return Response.json({ id: created.id, invited: false, activation: { ...activation, activationPath: "/activar-cuenta" } }, { status: 201, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
      }
      return Response.json(created, { status: 201, headers: { "Cache-Control": "no-store" } });
    } catch (cause) {
      if (cause instanceof SchoolAccountAdministrationError) {
        if (cause.code === "forbidden") return errorResponse(403, "No tienes permiso para asignar ese tipo de acceso.");
        if (cause.code === "already_exists") return errorResponse(409, "Ese correo ya tiene una identidad en Supabase Auth. No se asignaron permisos; contacta a soporte para revisarla.");
        if (cause.code === "invitation_uncertain") return errorResponse(503, "No se pudo confirmar la invitación. Esta solicitud no asignó permisos escolares; revisa el estado con soporte antes de reintentar.");
        if (cause.code === "provisioning_blocked") return errorResponse(503, "La invitación se creó, pero no se pudo habilitar el acceso. El perfil quedó sin permisos escolares; contacta a soporte.");
        if (cause.code === "provisioning_uncertain") return errorResponse(503, "No se pudo confirmar ni bloquear el acceso tras un fallo de conexión. Su estado es incierto; contacta a soporte antes de reintentar.");
      }
      return errorResponse(503, "No se pudo comprobar o configurar la invitación. Inténtalo más tarde o contacta a soporte.");
    }
  }
  const db = getDb();
  const existing = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
  if (existing.length) return errorResponse(409, "Ya existe una cuenta con ese correo.");

  if (useSupabase) {
    const auth = createSchoolAuthClient(env);
    let users;
    try {
      users = await auth.admin.listUsers({ perPage: 1000, maxPages: 100 });
    } catch {
      return errorResponse(503, "No se pudo comprobar la cuenta en Supabase Auth. Inténtalo más tarde.");
    }
    if (users.some(candidate => candidate.email?.trim().toLowerCase() === email)) {
      return errorResponse(409, "Ese correo ya tiene una identidad en Supabase Auth. Contacta a soporte para vincularla.");
    }

    const id = crypto.randomUUID();
    const auditId = crypto.randomUUID();
    const now = new Date();
    const writes: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
      db.insert(user).values({ id, name: parsed.data.name, email, emailVerified: false, active: true, image: null, createdAt: now, updatedAt: now }),
      db.insert(userRoles).values({ userId: id, role: parsed.data.role, assignedBy: actor.id, assignedAt: now }),
      db.insert(auditLog).values({ id: auditId, actorId: actor.id, action: "invite", entityType: "user", entityId: id, createdAt: now }),
    ];
    if (parsed.data.role === "tutor") writes.push(db.insert(guardians).values({ id: crypto.randomUUID(), userId: id }));
    else if (parsed.data.role === "docente") writes.push(db.insert(teachers).values({ id: crypto.randomUUID(), userId: id }));
    try {
      await db.batch(writes);
    } catch {
      return errorResponse(500, "No se pudo reservar el acceso escolar. No se envió ninguna invitación.");
    }

    try {
      if (!env.APP_ORIGIN) throw new Error("Missing invite origin");
      const redirectTo = new URL("/restablecer", env.APP_ORIGIN).toString();
      await auth.admin.inviteUserByEmail({ email, redirectTo, user_metadata: { name: parsed.data.name } });
      return Response.json({ id, invited: true }, { status: 201, headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      const identityState = await checkInvitationIdentity(email, () => auth.admin.listUsers({ perPage: 1000, maxPages: 100 }));
      if (identityState !== "absent") {
        return errorResponse(503, "Supabase pudo aceptar la invitación aunque no llegó la confirmación. La cuenta quedó reservada; verifica el correo y contacta a soporte antes de reintentar.");
      }
      try {
        await db.batch([
          db.delete(guardians).where(eq(guardians.userId, id)),
          db.delete(teachers).where(eq(teachers.userId, id)),
          db.delete(userRoles).where(eq(userRoles.userId, id)),
          db.delete(auditLog).where(eq(auditLog.id, auditId)),
          db.delete(user).where(eq(user.id, id)),
        ]);
      } catch {
        return errorResponse(500, "No se pudo completar la invitación ni retirar la reserva local. Contacta a soporte antes de reintentar.");
      }
      if (error instanceof SupabaseAuthError && error.code === "not_configured") {
        return errorResponse(503, "Falta configurar el origen autorizado para invitaciones en Supabase.");
      }
      return errorResponse(503, "No se pudo enviar la invitación. No se creó el acceso escolar; verifica el correo y vuelve a intentarlo.");
    }
  }

  try {
    const created = await getAuth().api.signUpEmail({ body: { email, name: parsed.data.name, password: parsed.data.password! } });
    if (!created?.user?.id) return errorResponse(500, "No se pudo crear la cuenta.");
    const userId = created.user.id;
    const now = new Date();
    const roleWrite = db.insert(userRoles).values({ userId, role: parsed.data.role, assignedBy: actor.id, assignedAt: now });
    const auditWrite = db.insert(auditLog).values({ id: crypto.randomUUID(), actorId: actor.id, action: "create", entityType: "user", entityId: userId, createdAt: now });
    if (parsed.data.role === "tutor") await db.batch([roleWrite, auditWrite, db.insert(guardians).values({ id: crypto.randomUUID(), userId })]);
    else if (parsed.data.role === "docente") await db.batch([roleWrite, auditWrite, db.insert(teachers).values({ id: crypto.randomUUID(), userId })]);
    else await db.batch([roleWrite, auditWrite]);
    return Response.json({ id: userId }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch {
    return errorResponse(500, "No se pudo completar el alta. Dirección debe revisar la cuenta antes de reintentar.");
  }
}
