import Link from "next/link";
import { ArrowRight, BookOpen, CalendarDays, CheckCheck, ClipboardCheck, GraduationCap, LayoutGrid, Mail, Sparkles, TrendingUp, Users, Video, type LucideIcon } from "lucide-react";
import presentation from "@/components/portal-presentation.module.css";
import type { Actor } from "@/lib/access";
import { PortalShell } from "@/components/portal-shell";
import type { DashboardData } from "@/lib/supabase/dashboard";

function date(value: string) {
  return new Date(value).toLocaleString("es-MX", { timeZone: "America/Mexico_City" });
}

function greeting(name: string, mode: DashboardData["mode"]) {
  const firstName = name.trim().split(/\s+/)[0];
  const institutionalNames = new Set(["el", "la", "los", "las", "equipo", "escuela", "colegio", "administración", "administrador", "dirección", "docente", "familia"]);
  if (!/[@\d]/u.test(name) && firstName.length >= 2 && firstName.length <= 22 && /^[\p{L}\p{M}'’-]+$/u.test(firstName) && !institutionalNames.has(firstName.toLocaleLowerCase("es-MX"))) return `¡Hola, ${firstName}!`;
  return mode === "direccion" ? "¡Hola, equipo escolar!" : mode === "tutor" ? "¡Hola, familia!" : mode === "docente" ? "¡Hola, equipo docente!" : "¡Hola!";
}

function DashboardEmpty({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return <div className={presentation.empty}><span className={presentation.emptyIcon}><Icon size={23} strokeWidth={1.6} aria-hidden="true" /></span><div><strong>{title}</strong><p>{description}</p></div></div>;
}

function PanelLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link className={presentation.panelLink} href={href}>{children}<ArrowRight size={16} aria-hidden="true" /></Link>;
}

export function SupabaseDashboard({ actor, data }: { actor: Actor; data: DashboardData }) {
  const canManageSchool = actor.roles.includes("superadmin") || actor.roles.includes("direccion");
  const cards = data.mode === "direccion" ? [
    { label: "Alumnos activos", value: data.counts.activeStudents, icon: GraduationCap },
    { label: "Grupos activos", value: data.counts.activeGroups, icon: LayoutGrid },
    { label: "Presentes hoy", value: data.counts.presentToday, icon: ClipboardCheck },
    { label: "Ciclo escolar", value: data.counts.schoolYear ?? "Sin configurar", icon: CalendarDays },
  ] : data.mode === "tutor" ? [
    { label: "Niños vinculados", value: data.counts.linkedChildren, icon: Users },
    { label: "Tareas pendientes", value: data.counts.pendingTasks, icon: CheckCheck },
  ] : data.mode === "docente" ? [
    { label: "Grupos asignados", value: data.counts.assignedGroups, icon: LayoutGrid },
    { label: "Entregas por revisar", value: data.counts.needsReview, icon: CheckCheck },
    { label: "Clases de hoy", value: data.counts.todayClasses, icon: Video },
  ] : [];
  const shortcuts = data.mode === "direccion" && canManageSchool ? [
    { href: "/grupos", label: "Grupos", detail: "Ciclos y organización", icon: LayoutGrid },
    { href: "/alumnos", label: "Alumnos", detail: "Matrícula y expedientes", icon: GraduationCap },
    { href: "/cuentas", label: "Cuentas", detail: "Accesos de la comunidad", icon: Users },
  ] : data.mode === "docente" ? [
    { href: "/tareas", label: "Tareas", detail: "Actividades y revisión", icon: CheckCheck },
    { href: "/clases", label: "Clases", detail: "Encuentros en Google Meet", icon: Video },
    { href: "/biblioteca", label: "Biblioteca", detail: "Recursos para tus grupos", icon: BookOpen },
  ] : data.mode === "tutor" ? [
    { href: "/tareas", label: "Tareas", detail: "Pendientes y entregas", icon: CheckCheck },
    { href: "/calendario", label: "Calendario", detail: "Fechas importantes", icon: CalendarDays },
    { href: "/seguimiento", label: "Seguimiento", detail: "Avances de tus niños", icon: TrendingUp },
  ] : [
    { href: "/actividades", label: "Juegos", detail: "Aprender jugando", icon: Sparkles },
    { href: "/biblioteca", label: "Biblioteca", detail: "Recursos de tu grupo", icon: BookOpen },
    { href: "/calendario", label: "Calendario", detail: "Tu rutina escolar", icon: CalendarDays },
  ];
  const title = data.mode === "direccion" ? "Tu escuela, a un vistazo." : data.mode === "docente" ? "Tu jornada, en un solo lugar." : data.mode === "tutor" ? "Cada pequeño paso cuenta." : "¡Vamos a aprender!";
  const intro = data.mode === "direccion" ? "Organiza a tu comunidad y acompaña lo que sucede cada día." : data.mode === "docente" ? "Todo listo para acompañar a tus grupos y sus familias." : data.mode === "tutor" ? "Actividades, avances y momentos de tus niños, cerca de ti." : "Descubre actividades y materiales de tu escuela.";
  return <PortalShell name={actor.name} role={actor.roles[0]} active="/">
    <div className={presentation.dashboard}>
      <header className={presentation.welcome}><div><p className={presentation.greeting}>{greeting(actor.name, data.mode)}</p><h1>{title}</h1><p className="page-intro">{intro}</p></div><span className={presentation.welcomeMark} aria-hidden="true"><Sparkles size={34} strokeWidth={1.5} /></span></header>
      <nav className={presentation.shortcuts} aria-label="Accesos rápidos">{shortcuts.map(({ href, label, detail, icon: Icon }) => <Link href={href} key={href}><Icon size={22} strokeWidth={1.7} aria-hidden="true" /><span><strong>{label}</strong><small>{detail}</small></span><ArrowRight className={presentation.shortcutArrow} size={17} aria-hidden="true" /></Link>)}</nav>
    {cards.length > 0 && <section className={`dashboard-grid ${presentation.metrics}`} aria-label="Resumen escolar">{cards.map(({ label, value, icon: Icon }, index) => <article className={`stat-card ${presentation.metric}`} key={label}><span className={`stat-icon ${index % 2 ? "gold" : "green"}`}><Icon size={21} strokeWidth={1.8} aria-hidden="true" /></span><p>{label}</p><strong className={typeof value === "string" ? "stat-name" : undefined}>{value}</strong></article>)}</section>}
    {data.mode === "tutor" && <div className={presentation.panels}><section className="portal-panel"><h2>Mis hijos</h2>{data.children.length ? <ul className="children-list">{data.children.map(child => <li key={`${child.id}-${child.groupId ?? "none"}`}><span className="child-icon" aria-hidden="true"><Sparkles size={18} /></span><span>{child.givenName} {child.familyName} · {child.groupName ?? "Grupo por asignar"}</span><Link href={`/alumnos/${child.id}`}>Ver expediente →</Link></li>)}</ul> : <DashboardEmpty icon={Users} title="Aquí acompañarás a tus niños" description="Dirección aún no ha vinculado a tus hijos con esta cuenta. Solicita el vínculo a la escuela." />}</section><section className="portal-panel"><h2>Tareas pendientes</h2>{data.tasks.length ? <ul className="record-list">{data.tasks.map(task => <li key={task.id}><div><strong>{task.title}</strong><span>{task.dueAt ? `Entrega: ${date(task.dueAt)}` : "Sin fecha límite"}</span></div></li>)}</ul> : <DashboardEmpty icon={CheckCheck} title="Sin tareas pendientes" description="Las nuevas actividades aparecerán aquí cuando tu maestra las publique." />}<PanelLink href="/tareas">Consultar tareas</PanelLink></section></div>}
    {data.mode === "docente" && <section className="portal-panel"><h2>Clases de hoy</h2>{data.classes.length ? <ul className="record-list">{data.classes.map(item => <li key={item.id}><div><strong>{item.title}</strong><span>{date(item.startsAt)}</span></div><Link href="/clases">Ver clase →</Link></li>)}</ul> : <DashboardEmpty icon={Video} title="Hoy no hay clases programadas" description="Consulta tus sesiones y enlaces de Google Meet en Clases virtuales." />}</section>}
    <div className={presentation.panels}><section className="portal-panel"><h2>Próximas actividades</h2>{data.events.length ? <ul className="record-list">{data.events.map(event => <li key={event.id}><div><strong>{event.title}</strong><span>{date(event.startsAt)}</span></div></li>)}</ul> : <DashboardEmpty icon={CalendarDays} title="Una agenda por descubrir" description="Aquí verás las próximas fechas y actividades de tu comunidad escolar." />}<PanelLink href="/calendario">Consultar calendario</PanelLink></section><section className="portal-panel"><h2>Comunicados recientes</h2>{data.announcements.length ? <ul className="record-list">{data.announcements.map(item => <li key={item.id}><Link href="/comunicados">{item.important ? "📌 " : ""}{item.title}</Link></li>)}</ul> : <DashboardEmpty icon={Mail} title="Sin comunicados nuevos" description="Los avisos publicados por la escuela aparecerán en esta sección." />}<PanelLink href="/comunicados">Consultar comunicados</PanelLink></section></div>
    {data.mode === "direccion" && canManageSchool && <section className={`portal-panel ${presentation.setup}`}><span className={presentation.setupIcon} aria-hidden="true"><Sparkles size={26} strokeWidth={1.6} /></span><div><h2>Una escuela lista para crecer</h2><p>Crea un ciclo y sus grupos, autoriza las cuentas y registra la matrícula.</p><div className="panel-actions"><Link href="/grupos">Gestionar grupos →</Link><Link href="/alumnos">Ver alumnos →</Link><Link href="/cuentas">Cuentas de acceso →</Link></div></div></section>}
    </div>
  </PortalShell>;
}
