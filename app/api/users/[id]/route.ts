import type { BatchItem } from "drizzle-orm/batch";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { auditLog, guardians, session, teachers, user, userRoles } from "@/db/schema";
import { actorFromRequest, errorResponse, hasRole } from "@/lib/access";
import { env } from "@/lib/runtime/env";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";
import { createSchoolAuthClient } from "@/lib/supabase/auth";
import { createSchoolAdminDatabaseClient } from "@/lib/supabase/admin-database";
import { createSchoolDatabaseClient, SupabaseDatabaseError } from "@/lib/supabase/database";
import { updateSchoolAccount, SchoolAccountAdministrationError } from "@/lib/supabase/account-administration";

async function supabaseIdentityForEmail(email: string) {
  const users = await createSchoolAuthClient(env).admin.listUsers({ perPage: 1000, maxPages: 100 });
  const matches = users.filter(candidate => candidate.email?.trim().toLowerCase() === email.trim().toLowerCase());
  if (matches.length !== 1) throw new Error("supabase_identity_not_unique");
  return matches[0].id;
}

const profileInput = z.object({ name: z.string().trim().min(2).max(100), email: z.email() });
const statusInput = z.object({ active: z.boolean() });
const roleInput = z.object({ role: z.enum(["direccion", "docente", "tutor"]) });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403, "Solicitud no válida.");
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin", "direccion")) return errorResponse(403, "No tienes permiso para administrar cuentas.");
  const { id } = await context.params;
  if (id === actor.id) return errorResponse(400, "No puedes editar ni desactivar tu propia cuenta.");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!z.uuid().safeParse(id).success) return errorResponse(404, "Cuenta no disponible.");
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return errorResponse(400, "Revisa los datos de la cuenta.");
    let changes;
    if (Object.hasOwn(body, "role")) {
      const parsed = roleInput.strict().safeParse(body);
      if (!parsed.success) return errorResponse(400, "El tipo de acceso no es válido.");
      changes = parsed.data;
    } else if (Object.hasOwn(body, "active")) {
      const parsed = statusInput.strict().safeParse(body);
      if (!parsed.success) return errorResponse(400, "El estado de la cuenta no es válido.");
      changes = parsed.data;
    } else {
      const parsed = profileInput.strict().safeParse(body);
      if (!parsed.success) return errorResponse(400, "Revisa el nombre y el correo de la cuenta.");
      changes = parsed.data;
    }
    try {
      const updated = await updateSchoolAccount(createSchoolDatabaseClient(env), actor, id, changes);
      return Response.json(updated, { headers: { "Cache-Control": "no-store" } });
    } catch (cause) {
      if (cause instanceof SchoolAccountAdministrationError && cause.code === "forbidden") return errorResponse(403, "No puedes administrar esa cuenta o asignar ese tipo de acceso.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 403) return errorResponse(403, "La cuenta está protegida o no tienes permiso para cambiarla.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 404) return errorResponse(404, "Cuenta escolar no disponible; puede estar pendiente de aprovisionamiento.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 409) return errorResponse(409, "La cuenta ya tiene ese acceso o su correo debe actualizarse en Supabase Auth. Revisa los datos.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 400) return errorResponse(400, "Revisa los datos de la cuenta.");
      return errorResponse(503, "No se pudo confirmar el cambio de la cuenta. Actualiza la lista y revisa su estado antes de reintentar.");
    }
  }
  const db = getDb();
  const target = await db.select({ id: user.id, email: user.email, name: user.name }).from(user).where(eq(user.id, id)).limit(1);
  if (!target.length) return errorResponse(404, "Cuenta no disponible.");
  const targetRoles = await db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, id));
  if (!targetRoles.length) return errorResponse(404, "Cuenta no disponible.");
  const roleNames = targetRoles.map(item => item.role);
  if (roleNames.includes("superadmin")) return errorResponse(403, "La cuenta de superadministración está protegida.");
  if (roleNames.includes("direccion") && !hasRole(actor, "superadmin")) return errorResponse(403, "Solo superadministración puede administrar cuentas de dirección.");

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return errorResponse(400, "Revisa los datos de la cuenta.");
  const now = new Date();
  if (Object.hasOwn(body, "role")) {
    const parsed = roleInput.safeParse(body);
    if (!parsed.success) return errorResponse(400, "El tipo de acceso no es válido.");
    if (parsed.data.role === "direccion" && !hasRole(actor, "superadmin")) return errorResponse(403, "Solo superadministración puede asignar dirección.");
    if (roleNames.length === 1 && parsed.data.role === roleNames[0]) return errorResponse(409, "La cuenta ya tiene ese tipo de acceso.");
    const teacherProfile = await db.select({ id: teachers.id }).from(teachers).where(eq(teachers.userId, id)).limit(1);
    const guardianProfile = await db.select({ id: guardians.id }).from(guardians).where(eq(guardians.userId, id)).limit(1);
    let authUserId: string | null = null;
    const adminDatabase = env.SCHOOL_AUTH_PROVIDER === "supabase" ? createSchoolAdminDatabaseClient(env) : null;
    if (adminDatabase) {
      try {
        authUserId = await supabaseIdentityForEmail(target[0].email);
        await adminDatabase.setProfileActive(authUserId, false);
      } catch {
        return errorResponse(503, "No se pudo preparar la actualización de permisos en Supabase. No se cambiaron los permisos escolares.");
      }
    }
    const changes: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
      db.delete(userRoles).where(eq(userRoles.userId, id)),
      db.insert(userRoles).values({ userId: id, role: parsed.data.role, assignedBy: actor.id, assignedAt: now }),
      db.delete(session).where(eq(session.userId, id)),
      db.insert(auditLog).values({ id: crypto.randomUUID(), actorId: actor.id, action: "change_role", entityType: "user", entityId: id, createdAt: now }),
    ];
    if (teacherProfile[0]) changes.push(db.update(teachers).set({ active: parsed.data.role === "docente" }).where(eq(teachers.userId, id)));
    else if (parsed.data.role === "docente") changes.push(db.insert(teachers).values({ id: crypto.randomUUID(), userId: id, active: true }));
    if (guardianProfile[0]) changes.push(db.update(guardians).set({ active: parsed.data.role === "tutor" }).where(eq(guardians.userId, id)));
    else if (parsed.data.role === "tutor") changes.push(db.insert(guardians).values({ id: crypto.randomUUID(), userId: id, active: true }));
    try {
      await db.batch(changes);
    } catch {
      return errorResponse(500, "No se pudieron actualizar los permisos escolares. El perfil Supabase quedó desactivado por seguridad; contacta a soporte.");
    }
    if (adminDatabase && authUserId) {
      try {
        await adminDatabase.syncAccountAccess(authUserId, [parsed.data.role], target[0].name);
      } catch {
        return errorResponse(503, "Los permisos escolares cambiaron, pero no se pudieron sincronizar. El perfil Supabase quedó desactivado; contacta a soporte.");
      }
    }
    return Response.json({ updated: true, role: parsed.data.role, previousRoles: roleNames }, { headers: { "Cache-Control": "no-store" } });
  }
  if (Object.hasOwn(body, "active")) {
    const parsed = statusInput.safeParse(body);
    if (!parsed.success) return errorResponse(400, "El estado de la cuenta no es válido.");
    const adminDatabase = env.SCHOOL_AUTH_PROVIDER === "supabase" ? createSchoolAdminDatabaseClient(env) : null;
    let authUserId: string | null = null;
    if (adminDatabase) {
      try {
        authUserId = await supabaseIdentityForEmail(target[0].email);
        // Keep Supabase RLS closed while D1 is being changed. Reactivation is
        // completed only after the D1 batch succeeds below.
        await adminDatabase.syncAccountAccess(authUserId, roleNames, target[0].name, false);
      } catch {
        return errorResponse(503, "No se pudo sincronizar el perfil y los permisos en Supabase. No se cambió el estado escolar.");
      }
    }
    const accountWrite = db.update(user).set({ active: parsed.data.active, updatedAt: now }).where(eq(user.id, id));
    const auditWrite = db.insert(auditLog).values({ id: crypto.randomUUID(), actorId: actor.id, action: parsed.data.active ? "reactivate" : "deactivate", entityType: "user", entityId: id, createdAt: now });
    const writes: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [accountWrite];
    if (roleNames.includes("docente")) writes.push(db.update(teachers).set({ active: parsed.data.active }).where(eq(teachers.userId, id)));
    if (roleNames.includes("tutor")) writes.push(db.update(guardians).set({ active: parsed.data.active }).where(eq(guardians.userId, id)));
    if (!parsed.data.active) writes.push(db.delete(session).where(eq(session.userId, id)));
    writes.push(auditWrite);
    try {
      await db.batch(writes);
    } catch {
      if (adminDatabase) {
        return errorResponse(500, "No se pudo actualizar el estado escolar. El perfil Supabase permanece desactivado; contacta a soporte antes de reintentar.");
      }
      return errorResponse(500, "No se pudo actualizar el estado de la cuenta. Contacta a soporte antes de reintentar.");
    }
    if (parsed.data.active && adminDatabase && authUserId) {
      try {
        await adminDatabase.setProfileActive(authUserId, true, target[0].name);
      } catch {
        let blocked = false;
        try {
          await adminDatabase.setProfileActive(authUserId, false);
          blocked = true;
        } catch {
          // Report uncertainty rather than claim a remote state we could not verify.
        }
        return errorResponse(
          503,
          blocked
            ? "La cuenta escolar se reactivó, pero Supabase sigue bloqueado. El próximo inicio de sesión puede reintentar la sincronización."
            : "La cuenta escolar se reactivó, pero no se pudo confirmar el estado de Supabase. Contacta a soporte antes de reintentar.",
        );
      }
    }
    return Response.json({ updated: true, active: parsed.data.active }, { headers: { "Cache-Control": "no-store" } });
  }

  const parsed = profileInput.safeParse(body);
  if (!parsed.success) return errorResponse(400, "Revisa el nombre y el correo de la cuenta.");
  const email = parsed.data.email.trim().toLowerCase();
  const current = await db.select({ email: user.email }).from(user).where(eq(user.id, id)).limit(1);
  if (env.SCHOOL_AUTH_PROVIDER === "supabase" && current[0]?.email.toLowerCase() !== email) {
    return errorResponse(409, "El correo de acceso debe actualizarse también en Supabase Auth. Contacta a la administración técnica.");
  }
  const existing = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
  if (existing.length && existing[0].id !== id) return errorResponse(409, "Ya existe una cuenta con ese correo.");
  const nowUpdated = new Date();
  await db.batch([
    db.update(user).set({ name: parsed.data.name, email, emailVerified: false, updatedAt: nowUpdated }).where(eq(user.id, id)),
    db.delete(session).where(eq(session.userId, id)),
    db.insert(auditLog).values({ id: crypto.randomUUID(), actorId: actor.id, action: "update", entityType: "user", entityId: id, createdAt: nowUpdated }),
  ]);
  return Response.json({ updated: true }, { headers: { "Cache-Control": "no-store" } });
}
