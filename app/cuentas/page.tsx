import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { asc, count, eq } from "drizzle-orm";
import { getSchoolPageActor } from "@/lib/supabase/page-actor";
import { env } from "@/lib/runtime/env";
import { getDb } from "@/db";
import { user, userRoles } from "@/db/schema";
import { AccountManager } from "./account-manager";
import { PortalShell } from "@/components/portal-shell";
import { createSchoolDatabaseClient } from "@/lib/supabase/database";
import { readSchoolAccounts } from "@/lib/supabase/account-feed";

export const dynamic = "force-dynamic";

export default async function Cuentas() {
  const actor = await getSchoolPageActor(await headers());
  if (!actor) redirect("/ingresar");
  const isSuperadmin = actor.roles.includes("superadmin");
  if (!isSuperadmin && !actor.roles.includes("direccion")) redirect("/");
  const role = isSuperadmin ? "superadmin" : "direccion";
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) redirect("/ingresar");
    const feed = await readSchoolAccounts(createSchoolDatabaseClient(env), actor.supabaseAuth.accessToken).catch(() => null);
    if (!feed) return <PortalShell name={actor.name} role={role} active="/cuentas"><h1>Cuentas de acceso</h1><p className="form-error" role="alert">No se pudieron cargar las cuentas de Supabase. Vuelve a intentarlo en unos minutos.</p></PortalShell>;
    return <PortalShell name={actor.name} role={role} active="/cuentas"><p className="eyebrow">ADMINISTRACIÓN ESCOLAR</p><h1>Cuentas de acceso</h1><p className="page-intro">Crea accesos para maestras, dirección y tutores autorizados. Puedes actualizar datos o desactivar accesos; el historial escolar se conserva.</p><AccountManager initialUsers={feed.items} initialTotal={feed.total} canCreateDirection={isSuperadmin} actorId={actor.id} useSupabaseInvites={env.SCHOOL_AUTH_PROVIDER === "supabase"} /></PortalShell>;
  }
  const db = getDb();
  const [users, totals] = await Promise.all([
    db.select({ id: user.id, name: user.name, email: user.email, role: userRoles.role, active: user.active }).from(user).innerJoin(userRoles, eq(userRoles.userId, user.id)).orderBy(asc(user.name), asc(user.id)).limit(10),
    db.select({ total: count() }).from(user).innerJoin(userRoles, eq(userRoles.userId, user.id)),
  ]);
  return <PortalShell name={actor.name} role={role} active="/cuentas"><p className="eyebrow">ADMINISTRACIÓN ESCOLAR</p><h1>Cuentas de acceso</h1><p className="page-intro">Crea accesos para maestras, dirección y tutores autorizados. Puedes actualizar datos o desactivar accesos; el historial escolar se conserva.</p><AccountManager initialUsers={users} initialTotal={totals[0]?.total ?? 0} canCreateDirection={isSuperadmin} actorId={actor.id} useSupabaseInvites={env.SCHOOL_AUTH_PROVIDER === "supabase"} /></PortalShell>;
}
