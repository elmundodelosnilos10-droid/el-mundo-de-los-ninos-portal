import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, asc, eq, gte, inArray, isNull, lt, or } from "drizzle-orm";
import { getSchoolSession } from "@/lib/supabase/session";
import { getDb } from "@/db";
import { announcements, attendance, calendarEvents, classSessions, enrollments, groups, guardians, schoolYears, students, studentGuardians, submissions, tasks, userRoles } from "@/db/schema";
import { accessibleGroupIds, hasRole } from "@/lib/access";
import { schoolDateKey, schoolLocalInputToISO } from "@/lib/datetime";
import { SignOutButton } from "./sign-out-button";
import { PortalShell } from "@/components/portal-shell";
import { env } from "@/lib/runtime/env";
import { getSchoolPageActor } from "@/lib/supabase/page-actor";
import { createSchoolDatabaseClient } from "@/lib/supabase/database";
import { readSchoolDashboard } from "@/lib/supabase/dashboard";
import { SupabaseDashboard } from "./supabase-dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    const actor = await getSchoolPageActor(await headers());
    if (!actor) redirect("/escuela");
    if (!actor.supabaseAuth) redirect("/ingresar");
    let data;
    try {
      data = await readSchoolDashboard(createSchoolDatabaseClient(env), actor.supabaseAuth.accessToken);
    } catch {
      return <PortalShell name={actor.name} role={actor.roles[0]} active="/"><h1>Panel escolar</h1><p className="form-error" role="alert">No se pudo cargar el resumen escolar. Inténtalo de nuevo en unos minutos.</p><Link href="/">Volver a cargar →</Link></PortalShell>;
    }
    return <SupabaseDashboard actor={actor} data={data} />;
  }
  const session = await getSchoolSession(await headers());
  if (!session?.user) redirect("/ingresar");
  const db = getDb();
  const roleRows = await db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, session.user.id));
  const roles = roleRows.map(row => row.role); const role = roles[0];
  if (!role) return <main className="pending-access"><h1>Tu cuenta está pendiente de autorización</h1><p>Dirección escolar debe asignarte acceso antes de que puedas ver información del alumnado.</p><SignOutButton /></main>;
  const actor = { id: session.user.id, name: session.user.name, email: session.user.email, roles };
  const groupIds = await accessibleGroupIds(actor);
  const isAdmin = hasRole(actor, "superadmin", "direccion");
  const now = new Date(); const day = schoolDateKey(now);
  const upcomingEvents = groupIds.length ? await db.select({ id: calendarEvents.id, title: calendarEvents.title, startsAt: calendarEvents.startsAt }).from(calendarEvents).where(and(gte(calendarEvents.startsAt, now), or(isNull(calendarEvents.groupId), inArray(calendarEvents.groupId, groupIds)))).orderBy(asc(calendarEvents.startsAt)).limit(4) : [];
  const freshAnnouncements = await db.select({ id: announcements.id, title: announcements.title, important: announcements.important }).from(announcements).where(isAdmin ? undefined : (groupIds.length ? or(isNull(announcements.groupId), inArray(announcements.groupId, groupIds)) : isNull(announcements.groupId))).orderBy(asc(announcements.publishedAt)).limit(3);

  if (isAdmin) {
    const [activeStudents, activeGroups, activeYears, presentToday] = await Promise.all([
      db.select({ id: students.id }).from(students).where(eq(students.active, true)),
      db.select({ id: groups.id }).from(groups).where(eq(groups.active, true)),
      db.select({ name: schoolYears.name }).from(schoolYears).where(eq(schoolYears.active, true)).limit(1),
      db.select({ id: attendance.id }).from(attendance).where(and(eq(attendance.onDate, day), eq(attendance.status, "presente"))),
    ]);
    return <PortalShell name={session.user.name} role={role} active="/">
      <p className="eyebrow">UN ESPACIO PARA CRECER JUNTOS</p><h1>¡Hola, {session.user.name.split(" ")[0]}!</h1><p className="page-intro">Resumen de actividad escolar con los registros actuales.</p>
      <section className="dashboard-grid" aria-label="Resumen de la escuela">
        <article className="stat-card"><span className="stat-icon green">✿</span><p>Alumnos activos</p><strong>{activeStudents.length}</strong></article>
        <article className="stat-card"><span className="stat-icon gold">▦</span><p>Grupos activos</p><strong>{activeGroups.length}</strong></article>
        <article className="stat-card"><span className="stat-icon lilac">◎</span><p>Presentes hoy</p><strong>{presentToday.length}</strong></article>
        <article className="stat-card"><span className="stat-icon green">▣</span><p>Ciclo escolar</p><strong className="stat-name">{activeYears[0]?.name ?? "Sin configurar"}</strong></article>
      </section>
      <div className="dashboard-grid"><section className="portal-panel"><h2>Próximas actividades</h2>{upcomingEvents.length?<ul className="record-list">{upcomingEvents.map(event=><li key={event.id}><div><strong>{event.title}</strong><span>{event.startsAt.toLocaleString("es-MX",{timeZone:"America/Mexico_City"})}</span></div></li>)}</ul>:<p>No hay actividades próximas.</p>}</section><section className="portal-panel"><h2>Comunicados recientes</h2>{freshAnnouncements.length?<ul className="record-list">{freshAnnouncements.map(item=><li key={item.id}><Link href="/comunicados">{item.important?"📌 ":""}{item.title}</Link></li>)}</ul>:<p>No hay comunicados publicados.</p>}</section></div>
      <section className="portal-panel"><h2>Organiza tu escuela</h2><p>Comienza por crear un ciclo, después los grupos, las cuentas y la matrícula.</p><div className="panel-actions"><Link href="/grupos">Gestionar grupos →</Link><Link href="/alumnos">Ver alumnos →</Link><Link href="/cuentas">Cuentas de acceso →</Link></div></section>
    </PortalShell>;
  }

  if (hasRole(actor, "tutor")) {
    const childRows = await db.selectDistinct({ id: students.id, givenName: students.givenName, familyName: students.familyName, groupId: enrollments.groupId, groupName: groups.name }).from(studentGuardians).innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId)).innerJoin(students, eq(students.id, studentGuardians.studentId)).leftJoin(enrollments, and(eq(enrollments.studentId, students.id), isNull(enrollments.endedAt))).leftJoin(groups, eq(groups.id, enrollments.groupId)).where(and(eq(guardians.userId, session.user.id), eq(guardians.active, true), eq(studentGuardians.active, true), eq(students.active, true)));
    const childIds = [...new Set(childRows.map(child => child.id))];
    const childTaskRows = childIds.length ? await db.selectDistinct({ id: tasks.id, title: tasks.title, dueAt: tasks.dueAt }).from(tasks).innerJoin(enrollments, and(eq(enrollments.groupId, tasks.groupId), isNull(enrollments.endedAt))).where(and(inArray(enrollments.studentId, childIds), isNull(tasks.archivedAt))).orderBy(asc(tasks.dueAt)).limit(8) : [];
    const childTaskIds = childTaskRows.map(task => task.id);
    const submitted = childTaskIds.length && childIds.length ? await db.select({ taskId: submissions.taskId, studentId: submissions.studentId }).from(submissions).where(and(inArray(submissions.taskId, childTaskIds), inArray(submissions.studentId, childIds))) : [];
    const pendingTasks = childTaskRows.filter(task => childIds.some(childId => !submitted.some(row => row.taskId === task.id && row.studentId === childId)));
    return <PortalShell name={session.user.name} role={role} active="/"><p className="eyebrow">UN ESPACIO PARA CRECER JUNTOS</p><h1>¡Hola, {session.user.name.split(" ")[0]}!</h1><p className="page-intro">Información y pendientes de tus niños en un solo lugar.</p><div className="dashboard-grid"><article className="stat-card"><span className="stat-icon green">✦</span><p>Niños vinculados</p><strong>{childIds.length}</strong></article><article className="stat-card"><span className="stat-icon gold">✓</span><p>Entregas pendientes</p><strong>{pendingTasks.length}</strong></article><article className="stat-card"><span className="stat-icon lilac">▦</span><p>Próximos eventos</p><strong>{upcomingEvents.length}</strong></article></div>
      <section className="portal-panel"><h2>Mis hijos</h2>{childRows.length?<ul className="children-list">{childRows.map(child=><li key={`${child.id}-${child.groupId||"none"}`}><span className="child-icon">✦</span><span>{child.givenName} {child.familyName}{child.groupName?` · ${child.groupName}`:" · Grupo por asignar"}</span><Link href={`/alumnos/${child.id}`}>Ver expediente →</Link></li>)}</ul>:<p>Dirección aún no ha vinculado a tus hijos con esta cuenta.</p>}</section>
      <div className="dashboard-grid"><section className="portal-panel"><h2>Tareas próximas</h2>{pendingTasks.length?<ul className="record-list">{pendingTasks.slice(0,4).map(task=><li key={task.id}><div><strong>{task.title}</strong><span>{task.dueAt?`Entrega: ${task.dueAt.toLocaleDateString("es-MX",{timeZone:"America/Mexico_City"})}`:"Sin fecha límite"}</span></div></li>)}</ul>:<p>No hay tareas pendientes por ahora.</p>}<Link href="/tareas">Ir a tareas →</Link></section><section className="portal-panel"><h2>Próximas actividades</h2>{upcomingEvents.length?<ul className="record-list">{upcomingEvents.map(event=><li key={event.id}><div><strong>{event.title}</strong><span>{event.startsAt.toLocaleString("es-MX",{timeZone:"America/Mexico_City"})}</span></div></li>)}</ul>:<p>No hay eventos próximos.</p>}</section></div>
      </PortalShell>;
  }

  const nextDay = new Date(`${day}T12:00:00Z`); nextDay.setUTCDate(nextDay.getUTCDate() + 1); const nextDayKey = schoolDateKey(nextDay); const dayStart = new Date(schoolLocalInputToISO(`${day}T00:00`)); const dayEnd = new Date(schoolLocalInputToISO(`${nextDayKey}T00:00`));
  const todaySessions = groupIds.length ? await db.select({ id: classSessions.id, title: calendarEvents.title, startsAt: calendarEvents.startsAt }).from(classSessions).innerJoin(calendarEvents, eq(calendarEvents.id, classSessions.eventId)).where(and(inArray(classSessions.groupId, groupIds), gte(calendarEvents.startsAt, dayStart), lt(calendarEvents.startsAt, dayEnd))).orderBy(asc(calendarEvents.startsAt)).limit(6) : [];
  const needsReview = groupIds.length ? await db.select({ id: submissions.id }).from(submissions).innerJoin(tasks, eq(tasks.id, submissions.taskId)).where(and(inArray(tasks.groupId, groupIds), eq(submissions.status, "entregada"), isNull(tasks.archivedAt))) : [];
  return <PortalShell name={session.user.name} role={role} active="/"><p className="eyebrow">UN ESPACIO PARA CRECER JUNTOS</p><h1>¡Hola, {session.user.name.split(" ")[0]}!</h1><p className="page-intro">Tu jornada escolar, organizada por tus grupos asignados.</p><div className="dashboard-grid"><article className="stat-card"><span className="stat-icon green">▧</span><p>Grupos asignados</p><strong>{groupIds.length}</strong></article><article className="stat-card"><span className="stat-icon gold">✓</span><p>Entregas por revisar</p><strong>{needsReview.length}</strong></article><article className="stat-card"><span className="stat-icon lilac">◉</span><p>Clases programadas</p><strong>{todaySessions.length}</strong></article></div><div className="dashboard-grid"><section className="portal-panel"><h2>Clases próximas</h2>{todaySessions.length?<ul className="record-list">{todaySessions.map(item=><li key={item.id}><div><strong>{item.title}</strong><span>{item.startsAt.toLocaleString("es-MX",{timeZone:"America/Mexico_City"})}</span></div><Link href="/clases">Ver clases →</Link></li>)}</ul>:<p>No hay clases próximas para tus grupos.</p>}</section><section className="portal-panel"><h2>Comunicados recientes</h2>{freshAnnouncements.length?<ul className="record-list">{freshAnnouncements.map(item=><li key={item.id}><Link href="/comunicados">{item.important?"📌 ":""}{item.title}</Link></li>)}</ul>:<p>No hay comunicados publicados.</p>}</section></div></PortalShell>;
}
