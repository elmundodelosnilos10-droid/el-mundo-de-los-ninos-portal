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
import { AnnouncementManager } from "./announcement-manager";

export const dynamic = "force-dynamic";

export default async function Comunicados() {
  const actor = await getSchoolPageActor(await headers());
  if (!actor) redirect("/ingresar");
  const role = actor.roles[0];
  if (!role) redirect("/");
  const canCreate = hasRole(actor, "superadmin", "direccion", "docente");
  const canCreateGeneral = hasRole(actor, "superadmin", "direccion");
  let announcementGroups: { id: string; name: string }[] = [];

  if (canCreate && env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) redirect("/ingresar");
    try {
      const result = await createSchoolDatabaseClient(env).select<{ id: string; name: string }>(actor.supabaseAuth.accessToken, "groups", {
        columns: ["id", "name"],
        filters: [{ column: "active", operator: "eq", value: true }],
        orderBy: [{ column: "name" }, { column: "id" }],
        limit: 500,
      });
      announcementGroups = result.data;
    } catch {
      return <PortalShell name={actor.name} role={role} active="/comunicados"><p className="eyebrow">AVISOS Y NOTIFICACIONES</p><h1>Comunicados</h1><p className="form-error" role="alert">No se pudieron cargar los grupos desde Supabase.</p></PortalShell>;
    }
  } else if (canCreate) {
    const db = getDb();
    const ids = await accessibleGroupIds(actor);
    announcementGroups = ids.length
      ? await db.select({ id: groups.id, name: groups.name }).from(groups).where(and(inArray(groups.id, ids), eq(groups.active, true)))
      : [];
  }

  return <PortalShell name={actor.name} role={role} active="/comunicados">
    <p className="eyebrow">AVISOS Y NOTIFICACIONES</p>
    <h1>Comunicados</h1>
    <p className="page-intro">Avisos de dirección y mensajes para las familias de cada grupo.</p>
    <AnnouncementManager groups={announcementGroups} canCreate={canCreate} canCreateGeneral={canCreateGeneral} />
  </PortalShell>;
}
