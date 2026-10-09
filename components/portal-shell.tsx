import Image from "next/image";
import Link from "next/link";
import { SignOutButton } from "@/app/sign-out-button";
import { NotificationCenter } from "@/components/notification-center";

const baseLinks = [
  ["/", "Inicio", "⌂"],
  ["/calendario", "Calendario", "▦"],
  ["/clases", "Clases virtuales", "◉"],
  ["/tareas", "Tareas y entregas", "✓"],
  ["/biblioteca", "Biblioteca", "▤"],
  ["/actividades", "Juegos y retos", "✿"],
  ["/seguimiento", "Seguimiento", "↗"],
  ["/comunicacion", "Comunicación", "◌"],
  ["/comunicados", "Comunicados", "✉"],
  ["/asistencia", "Asistencia", "◎"],
  ["/mi-cuenta", "Mi cuenta", "♙"],
] as const;

export function PortalShell({ name, role, active, children }: { name: string; role: string; active: string; children: React.ReactNode }) {
  const isAdmin = role === "superadmin" || role === "direccion";
  const links = role === "superadmin"
    ? [...baseLinks, ["/grupos", "Grupos", "▧"], ["/alumnos", "Alumnos", "◇"], ["/privacidad", "Solicitudes de privacidad", "⌕"], ["/consentimientos", "Autorizaciones", "✓"], ["/cuentas", "Cuentas", "♙"], ["/sistema", "Estado del sistema", "⚙"], ["/auditoria", "Auditoría", "◷"]] as const
    : isAdmin
      ? [...baseLinks, ["/grupos", "Grupos", "▧"], ["/alumnos", "Alumnos", "◇"], ["/privacidad", "Solicitudes de privacidad", "⌕"], ["/consentimientos", "Autorizaciones", "✓"], ["/cuentas", "Cuentas", "♙"], ["/auditoria", "Auditoría", "◷"]] as const
      : role === "tutor" ? [...baseLinks, ["/privacidad", "Privacidad", "⌕"]] as const : baseLinks;
  const roleLabel = role === "direccion" ? "Dirección" : role === "tutor" ? "Familia" : role === "docente" ? "Docente" : role === "alumno" ? "Alumno" : "Administración";
  return <div className="portal-shell">
    <a className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-white focus:px-4 focus:py-3 focus:font-bold focus:text-[#27533a] focus:shadow-lg" href="#contenido">Saltar al contenido principal</a>
    <aside className="portal-sidebar" aria-label="Navegación principal">
      <Link className="portal-brand" href="/"><Image src="/logo-escuela.jpg" width={52} height={52} alt="" /><span><strong>El Mundo de los Niños</strong><small>Aprendo jugando</small></span></Link>
      <p className="nav-heading">PORTAL ESCOLAR</p>
      <div className="portal-nav-wrap">
        <nav className="portal-nav" aria-label="Secciones del portal">{links.map(([href, label, icon]) => <Link key={href} className={active === href ? "selected" : ""} href={href} aria-current={active === href ? "page" : undefined}><span aria-hidden="true">{icon}</span><span>{label}</span></Link>)}</nav>
        <span className="portal-nav-hint" aria-hidden="true">Desliza para ver más secciones →</span>
      </div>
      <div className="sidebar-account"><span className="account-avatar">{name.slice(0, 1).toUpperCase()}</span><span><strong>{name}</strong><small>{roleLabel}</small></span><SignOutButton /></div>
    </aside>
    <main className="portal-main" id="contenido" tabIndex={-1}>
      <header className="portal-topbar"><span>El Mundo de los Niños <span className="topbar-slash">/</span>{links.find(link => link[0] === active)?.[1] ?? (active === "/mi-cuenta" ? "Mi cuenta" : "Portal")}</span><div className="topbar-actions"><NotificationCenter /><SignOutButton /></div></header>
      <div className="portal-content">{children}</div>
    </main>
  </div>;
}
