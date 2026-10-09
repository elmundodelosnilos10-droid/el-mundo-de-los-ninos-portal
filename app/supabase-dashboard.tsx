import Link from "next/link";
import type { Actor } from "@/lib/access";
import { PortalShell } from "@/components/portal-shell";
import type { DashboardData } from "@/lib/supabase/dashboard";

function date(value: string) {
  return new Date(value).toLocaleString("es-MX", { timeZone: "America/Mexico_City" });
}

export function SupabaseDashboard({ actor, data }: { actor: Actor; data: DashboardData }) {
  const cards = data.mode === "direccion" ? [
    { label: "Alumnos activos", value: data.counts.activeStudents, icon: "✿" },
    { label: "Grupos activos", value: data.counts.activeGroups, icon: "▦" },
    { label: "Presentes hoy", value: data.counts.presentToday, icon: "◎" },
    { label: "Ciclo escolar", value: data.counts.schoolYear ?? "Sin configurar", icon: "▣" },
  ] : data.mode === "tutor" ? [
    { label: "Niños vinculados", value: data.counts.linkedChildren, icon: "✦" },
    { label: "Tareas pendientes", value: data.counts.pendingTasks, icon: "✓" },
  ] : data.mode === "docente" ? [
    { label: "Grupos asignados", value: data.counts.assignedGroups, icon: "▧" },
    { label: "Entregas por revisar", value: data.counts.needsReview, icon: "✓" },
    { label: "Clases de hoy", value: data.counts.todayClasses, icon: "◉" },
  ] : [];
  return <PortalShell name={actor.name} role={actor.roles[0]} active="/">
    <p className="eyebrow">UN ESPACIO PARA CRECER JUNTOS</p><h1>¡Hola, {actor.name.split(" ")[0]}!</h1>
    <p className="page-intro">Tu comunidad escolar, organizada en un solo lugar.</p>
    <section className="dashboard-grid" aria-label="Resumen escolar">{cards.map((card, index) => <article className="stat-card" key={card.label}><span className={`stat-icon ${index % 2 ? "gold" : "green"}`}>{card.icon}</span><p>{card.label}</p><strong className={typeof card.value === "string" ? "stat-name" : undefined}>{card.value}</strong></article>)}</section>
    {data.mode === "tutor" && <><section className="portal-panel"><h2>Mis hijos</h2>{data.children.length ? <ul className="children-list">{data.children.map(child => <li key={`${child.id}-${child.groupId ?? "none"}`}><span className="child-icon">✦</span><span>{child.givenName} {child.familyName} · {child.groupName ?? "Grupo por asignar"}</span><Link href={`/alumnos/${child.id}`}>Ver expediente →</Link></li>)}</ul> : <p>Dirección aún no ha vinculado a tus hijos con esta cuenta.</p>}</section><section className="portal-panel"><h2>Tareas pendientes</h2>{data.tasks.length ? <ul className="record-list">{data.tasks.map(task => <li key={task.id}><div><strong>{task.title}</strong><span>{task.dueAt ? `Entrega: ${date(task.dueAt)}` : "Sin fecha límite"}</span></div></li>)}</ul> : <p>No hay tareas pendientes.</p>}<Link href="/tareas">Ir a tareas →</Link></section></>}
    {data.mode === "docente" && <section className="portal-panel"><h2>Clases de hoy</h2>{data.classes.length ? <ul className="record-list">{data.classes.map(item => <li key={item.id}><div><strong>{item.title}</strong><span>{date(item.startsAt)}</span></div><Link href="/clases">Ver clase →</Link></li>)}</ul> : <p>No hay clases programadas para hoy.</p>}</section>}
    <div className="dashboard-grid"><section className="portal-panel"><h2>Próximas actividades</h2>{data.events.length ? <ul className="record-list">{data.events.map(event => <li key={event.id}><div><strong>{event.title}</strong><span>{date(event.startsAt)}</span></div></li>)}</ul> : <p>No hay actividades próximas.</p>}<Link href="/calendario">Ver calendario →</Link></section><section className="portal-panel"><h2>Comunicados recientes</h2>{data.announcements.length ? <ul className="record-list">{data.announcements.map(item => <li key={item.id}><Link href="/comunicados">{item.important ? "📌 " : ""}{item.title}</Link></li>)}</ul> : <p>No hay comunicados publicados.</p>}</section></div>
    {data.mode === "direccion" && <section className="portal-panel"><h2>Organiza tu escuela</h2><p>Crea un ciclo y sus grupos, autoriza las cuentas y registra la matrícula.</p><div className="panel-actions"><Link href="/grupos">Gestionar grupos →</Link><Link href="/alumnos">Ver alumnos →</Link><Link href="/cuentas">Cuentas de acceso →</Link></div></section>}
  </PortalShell>;
}
