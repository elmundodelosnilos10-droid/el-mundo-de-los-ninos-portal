import { env } from "@/lib/runtime/env";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { asc, count, eq } from "drizzle-orm";
import { getSchoolPageActor } from "@/lib/supabase/page-actor";
import { getDb } from "@/db";
import { groups, schoolYears, teachers, user } from "@/db/schema";
import { hasRole } from "@/lib/access";
import { GroupManager } from "./group-manager";
import { PortalShell } from "@/components/portal-shell";
import { createSchoolDatabaseClient } from "@/lib/supabase/database";

export const dynamic = "force-dynamic";

export default async function Grupos() {
  const actor = await getSchoolPageActor(await headers());
  if (!actor) redirect("/ingresar");
  const role = actor.roles[0];
  if (!role) redirect("/");
  if (!hasRole(actor, "superadmin", "direccion")) redirect("/");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) redirect("/ingresar");
    const jwt = actor.supabaseAuth.accessToken;
    const schoolData = await (async () => {
      const client = createSchoolDatabaseClient(env);
      const [yearResult, groupResult, groupCount, teacherResult, groupOptionResult] = await Promise.all([
        client.select<{ id: string; name: string; starts_on: string; ends_on: string; active: boolean }>(jwt, "school_years", { columns: ["id", "name", "starts_on", "ends_on", "active"], orderBy: [{ column: "active", ascending: false }, { column: "starts_on" }], limit: 500 }),
        client.select<{ id: string; year_id: string; name: string; stage: "lactantes" | "maternal" | "prekinder" | "preescolar"; active: boolean }>(jwt, "groups", { columns: ["id", "year_id", "name", "stage", "active"], filters: [{ column: "active", operator: "eq", value: true }], orderBy: [{ column: "name" }, { column: "id" }], limit: 10 }),
        client.select<{ id: string }>(jwt, "groups", { columns: ["id"], filters: [{ column: "active", operator: "eq", value: true }], count: "exact", limit: 1 }),
        client.select<{ id: string; user_id: string }>(jwt, "teachers", { columns: ["id", "user_id"], filters: [{ column: "active", operator: "eq", value: true }], limit: 100 }),
        client.select<{ id: string; name: string }>(jwt, "groups", { columns: ["id", "name"], filters: [{ column: "active", operator: "eq", value: true }], orderBy: [{ column: "name" }], limit: 50 }),
      ]);
      const teacherUserIds = teacherResult.data.map(row => row.user_id);
      const profileResult = teacherUserIds.length ? await client.select<{ id: string; name: string; email: string }>(jwt, "profiles", { columns: ["id", "name", "email"], filters: [{ column: "id", operator: "in", value: teacherUserIds }], limit: 100 }) : { data: [] as { id: string; name: string; email: string }[] };
      const profilesById = new Map(profileResult.data.map(profile => [profile.id, profile]));
      const years = yearResult.data.map(row => ({ id: row.id, name: row.name, startsOn: row.starts_on, endsOn: row.ends_on, active: row.active }));
      const activeGroups = groupResult.data.map(row => ({ id: row.id, yearId: row.year_id, name: row.name, stage: row.stage, active: row.active }));
      const teachers = teacherResult.data.flatMap(row => {
        const profile = profilesById.get(row.user_id);
        return profile ? [{ id: row.id, name: profile.name, email: profile.email }] : [];
      });
      return { years, activeGroups, total: groupCount.count ?? 0, groupOptions: groupOptionResult.data, teachers };
    })().catch(() => null);
    if (!schoolData) {
      return <PortalShell name={actor.name} role={role} active="/grupos"><p className="eyebrow">ADMINISTRACIÓN ESCOLAR</p><h1>Ciclos y grupos</h1><p className="form-error" role="alert">No se pudieron cargar los ciclos y grupos de Supabase. Vuelve a intentarlo en unos minutos.</p></PortalShell>;
    }
    return <PortalShell name={actor.name} role={role} active="/grupos"><p className="eyebrow">ADMINISTRACIÓN ESCOLAR</p><h1>Ciclos y grupos</h1><p className="page-intro">Organiza los grupos por etapa. Cada registro se guarda en la base de datos de la escuela.</p><GroupManager initialYears={schoolData.years} initialGroups={schoolData.activeGroups} initialTotal={schoolData.total} selectableGroups={schoolData.groupOptions} teachers={schoolData.teachers} /></PortalShell>;
  }
  const db = getDb();
  const years = await db.select().from(schoolYears);
  const [records, totals, teacherRecords, groupOptions] = await Promise.all([
    db.select().from(groups).where(eq(groups.active, true)).orderBy(asc(groups.name), asc(groups.id)).limit(10),
    db.select({ total: count() }).from(groups).where(eq(groups.active, true)),
    db.select({ id: teachers.id, name: user.name, email: user.email }).from(teachers).innerJoin(user, eq(teachers.userId, user.id)).where(eq(teachers.active, true)),
    db.select({ id: groups.id, name: groups.name }).from(groups).where(eq(groups.active, true)).orderBy(asc(groups.name)).limit(50),
  ]);
  return <PortalShell name={actor.name} role={role} active="/grupos"><p className="eyebrow">ADMINISTRACIÓN ESCOLAR</p><h1>Ciclos y grupos</h1><p className="page-intro">Organiza los grupos por etapa. Cada registro se guarda en la base de datos de la escuela.</p><GroupManager initialYears={years} initialGroups={records} initialTotal={totals[0]?.total ?? 0} selectableGroups={groupOptions} teachers={teacherRecords} /></PortalShell>;
}
