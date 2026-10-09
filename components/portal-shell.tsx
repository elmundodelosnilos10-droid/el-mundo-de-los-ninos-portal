import Image from "next/image";
import Link from "next/link";
import { BookOpen, CalendarDays, CheckCheck, ClipboardCheck, FileCheck2, GraduationCap, Home, LayoutGrid, LockKeyhole, Mail, MessageCircle, Settings2, ShieldCheck, Sparkles, TrendingUp, UserRound, Users, Video } from "lucide-react";
import { SignOutButton } from "@/app/sign-out-button";
import { NotificationCenter } from "@/components/notification-center";
import presentation from "./portal-presentation.module.css";

const baseLinks = [
  ["/", "Inicio", Home],
  ["/calendario", "Calendario", CalendarDays],
  ["/clases", "Clases virtuales", Video],
  ["/tareas", "Tareas y entregas", CheckCheck],
  ["/biblioteca", "Biblioteca", BookOpen],
  ["/actividades", "Juegos y retos", Sparkles],
  ["/seguimiento", "Seguimiento", TrendingUp],
  ["/comunicacion", "Comunicación", MessageCircle],
  ["/comunicados", "Comunicados", Mail],
  ["/asistencia", "Asistencia", ClipboardCheck],
  ["/mi-cuenta", "Mi cuenta", UserRound],
] as const;

export function PortalShell({ name, role, active, children }: { name: string; role: string; active: string; children: React.ReactNode }) {
  const isAdmin = role === "superadmin" || role === "direccion";
  const links = role === "superadmin"
    ? [...baseLinks, ["/grupos", "Grupos", LayoutGrid], ["/alumnos", "Alumnos", GraduationCap], ["/privacidad", "Solicitudes de privacidad", ShieldCheck], ["/consentimientos", "Autorizaciones", FileCheck2], ["/cuentas", "Cuentas", Users], ["/sistema", "Estado del sistema", Settings2], ["/auditoria", "Auditoría", LockKeyhole]] as const
    : isAdmin
      ? [...baseLinks, ["/grupos", "Grupos", LayoutGrid], ["/alumnos", "Alumnos", GraduationCap], ["/privacidad", "Solicitudes de privacidad", ShieldCheck], ["/consentimientos", "Autorizaciones", FileCheck2], ["/cuentas", "Cuentas", Users], ["/auditoria", "Auditoría", LockKeyhole]] as const
      : role === "tutor" ? [...baseLinks, ["/privacidad", "Privacidad", ShieldCheck]] as const : baseLinks;
  const roleLabel = role === "direccion" ? "Dirección" : role === "tutor" ? "Familia" : role === "docente" ? "Docente" : role === "alumno" ? "Alumno" : "Administración";
  const displayName = name.includes("@") ? roleLabel : name;
  const activeLabel = links.find(link => link[0] === active)?.[1] ?? (active === "/mi-cuenta" ? "Mi cuenta" : "Portal");
  return <div className={`portal-shell ${presentation.shell}`}>
    <a className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-white focus:px-4 focus:py-3 focus:font-bold focus:text-[#27533a] focus:shadow-lg" href="#contenido">Saltar al contenido principal</a>
    <aside className={`portal-sidebar ${presentation.sidebar}`} aria-label="Navegación principal">
      <Link className={`portal-brand ${presentation.brand}`} href="/"><Image src="/logo-escuela.jpg" width={52} height={52} alt="" /><span><strong>El Mundo de los Niños</strong><small>Aprendo jugando</small></span></Link>
      <p className="nav-heading">PORTAL ESCOLAR</p>
      <div className={`portal-nav-wrap ${presentation.navigation}`}>
        <nav className="portal-nav" aria-label="Secciones del portal">{links.map(([href, label, Icon]) => <Link key={href} className={active === href ? "selected" : ""} href={href} aria-current={active === href ? "page" : undefined}><Icon size={19} strokeWidth={1.8} aria-hidden="true" /><span>{label}</span></Link>)}</nav>
        <span className="portal-nav-hint" aria-hidden="true">Desliza para ver más secciones →</span>
      </div>
      <div className={`sidebar-account ${presentation.account}`}><span className="account-avatar" aria-hidden="true">{displayName.slice(0, 1).toUpperCase()}</span><span><strong>{displayName}</strong><small>{roleLabel}</small></span><SignOutButton /></div>
    </aside>
    <main className="portal-main" id="contenido" tabIndex={-1}>
      <header className={`portal-topbar ${presentation.topbar}`}><div className={presentation.breadcrumb} aria-label="Ubicación actual"><span className={presentation.breadcrumbContext}>Portal escolar <span className="topbar-slash" aria-hidden="true">/</span></span><strong>{activeLabel}</strong></div><div className={`topbar-actions ${presentation.topbarActions}`}><NotificationCenter /><SignOutButton /></div></header>
      <div className="portal-content">{children}</div>
    </main>
  </div>;
}
