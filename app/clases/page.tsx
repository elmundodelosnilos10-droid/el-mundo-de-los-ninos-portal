import { env } from "@/lib/runtime/env";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { getSchoolPageActor } from "@/lib/supabase/page-actor";
import { getDb } from "@/db";
import { groups, teachers, teacherGroups, user } from "@/db/schema";
import { accessibleGroupIds, hasRole } from "@/lib/access";
import { createSchoolDatabaseClient } from "@/lib/supabase/database";
import { PortalShell } from "@/components/portal-shell";
import { ClassManager } from "./class-manager";

export const dynamic = "force-dynamic";

export default async function Clases() {
  const actor = await getSchoolPageActor(await headers());
  if (!actor) redirect("/ingresar");
  const role = actor.roles[0];
  if (!role) redirect("/");
  const canCreate = hasRole(actor, "superadmin", "direccion", "docente");
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) redirect("/ingresar");
    let groups: { id: string; name: string }[] | null = null;
    let teachers: { id: string; name: string; email: string }[] | null = null;
    try {
      const result = await createSchoolDatabaseClient(env).rpc<{ groups: unknown[]; teachers: unknown[] }>(actor.supabaseAuth.accessToken, "school_list_class_options", {});
      const payload = result.data[0];
      if (!payload || !Array.isArray(payload.groups) || !Array.isArray(payload.teachers)) throw new Error("invalid class options");
      groups = payload.groups as { id: string; name: string }[];
      teachers = payload.teachers as { id: string; name: string; email: string }[];
    } catch { /* Render a clear page-level error below. */ }
    if (!groups || !teachers) {
      return <PortalShell name={actor.name} role={role} active="/clases"><p className="eyebrow">CLASES EN LÍNEA</p><h1>Google Meet</h1><p className="form-error" role="alert">No se pudieron cargar los grupos y maestras desde Supabase.</p></PortalShell>;
    }
    return <PortalShell name={actor.name} role={role} active="/clases"><p className="eyebrow">CLASES EN LÍNEA</p><h1>Google Meet</h1><p className="page-intro">La maestra crea la reunión en Google Meet y agrega aquí el enlace para su grupo.</p><ClassManager groups={groups} teachers={teachers} canCreate={canCreate} /></PortalShell>;
  }
  const db = getDb();
  const groupIds = await accessibleGroupIds(actor);
  const groupRows = groupIds.length ? await db.select({ id: groups.id, name: groups.name }).from(groups).where(inArray(groups.id, groupIds)) : [];
  let teacherRows: { id: string; name: string; email: string }[] = [];
  if (hasRole(actor, "superadmin", "direccion") && groupIds.length) teacherRows = await db.selectDistinct({ id: teachers.id, name: user.name, email: user.email }).from(teachers).innerJoin(teacherGroups, eq(teacherGroups.teacherId, teachers.id)).innerJoin(user, eq(user.id, teachers.userId)).where(and(eq(teachers.active, true), inArray(teacherGroups.groupId, groupIds)));
  else if (hasRole(actor, "docente")) teacherRows = await db.select({ id: teachers.id, name: user.name, email: user.email }).from(teachers).innerJoin(user, eq(user.id, teachers.userId)).where(and(eq(teachers.userId, actor.id), eq(teachers.active, true)));
  return <PortalShell name={actor.name} role={role} active="/clases"><p className="eyebrow">CLASES EN LÍNEA</p><h1>Google Meet</h1><p className="page-intro">La maestra crea la reunión en Google Meet y agrega aquí el enlace para su grupo.</p><ClassManager groups={groupRows} teachers={teacherRows} canCreate={canCreate} /></PortalShell>;
}
