import { env } from "@/lib/runtime/env";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { getSchoolPageActor } from "@/lib/supabase/page-actor";
import { getDb } from "@/db";
import { groups } from "@/db/schema";
import { accessibleGroupIds, hasRole } from "@/lib/access";
import { createSchoolDatabaseClient } from "@/lib/supabase/database";
import { PortalShell } from "@/components/portal-shell";
import { CalendarView } from "./calendar-view";

export const dynamic = "force-dynamic";

export default async function Calendario() {
  const actor = await getSchoolPageActor(await headers());
  if (!actor) redirect("/ingresar");
  const role = actor.roles[0];
  if (!role) redirect("/");
  const canCreate = hasRole(actor, "superadmin", "direccion", "docente");
  const canCreateGeneral = hasRole(actor, "superadmin", "direccion");
  let eventGroups: { id: string; name: string }[] = [];
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) redirect("/ingresar");
    try {
      const result = await createSchoolDatabaseClient(env).select<{ id: string; name: string }>(actor.supabaseAuth.accessToken, "groups", {
        columns: ["id", "name"], filters: [{ column: "active", operator: "eq", value: true }],
        orderBy: [{ column: "name" }, { column: "id" }], limit: 500,
      });
      eventGroups = result.data;
    } catch {
      return <PortalShell name={actor.name} role={role} active="/calendario"><p className="eyebrow">AGENDA ESCOLAR</p><h1>Calendario</h1><p className="form-error" role="alert">No se pudieron cargar los grupos desde Supabase.</p></PortalShell>;
    }
  } else {
    const db = getDb();
    const ids = await accessibleGroupIds(actor);
    eventGroups = ids.length ? await db.select({ id: groups.id, name: groups.name }).from(groups).where(and(eq(groups.active, true), inArray(groups.id, ids))) : [];
  }
  return <PortalShell name={actor.name} role={role} active="/calendario"><p className="eyebrow">AGENDA ESCOLAR</p><h1>Calendario</h1><p className="page-intro">Clases, actividades y entregas de tus grupos · hora de Ciudad de México.</p><CalendarView groups={eventGroups} canCreate={canCreate} canCreateGeneral={canCreateGeneral} /></PortalShell>;
}
