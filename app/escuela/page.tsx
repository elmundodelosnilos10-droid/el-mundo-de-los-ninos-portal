import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BookOpen, CalendarDays, Check, ClipboardCheck, Heart, Leaf, MessageCircle, ShieldCheck, Sparkles, Video } from "lucide-react";

const sections = [
  { icon: BookOpen, title: "Aprender, descubrir y jugar", text: "Actividades, tareas y materiales organizados por grupo. Un lugar para seguir aprendiendo en casa.", detail: "Biblioteca · Tareas y entregas · Juegos y retos", color: "sage" },
  { icon: MessageCircle, title: "Escuela y familia, cerca", text: "Conversaciones con las maestras, comunicados y avisos para acompañar cada día de tus niños.", detail: "Mensajes privados · Comunicados · Notificaciones", color: "rose" },
  { icon: ClipboardCheck, title: "Cada pequeño paso cuenta", text: "Asistencia, observaciones y seguimiento del desarrollo, con información disponible según el acceso de cada persona.", detail: "Asistencia · Seguimiento · Expedientes", color: "gold" },
  { icon: CalendarDays, title: "Una rutina bien organizada", text: "Calendario escolar, fechas de entrega y clases virtuales mediante enlaces de Google Meet.", detail: "Calendario · Eventos · Clases virtuales", color: "lilac" },
];

export const metadata = { title: "El Mundo de los Niños · Aprendo jugando", description: "Un espacio para conectar a nuestra escuela y sus familias. Conoce el portal de El Mundo de los Niños." };

export default function EscuelaPage() {
  return <div className="school-presentation">
    <a className="presentation-skip" href="#escuela-contenido">Saltar al contenido</a>
    <header className="presentation-header">
      <Link href="/escuela" className="presentation-brand"><Image src="/logo-escuela.jpg" width={54} height={54} alt="Logotipo oficial de El Mundo de los Niños" priority /><span><strong>El Mundo de los Niños</strong><small>Aprendo jugando</small></span></Link>
      <nav aria-label="Navegación de la presentación"><a href="#acompanamiento">Nuestro portal</a><a href="#familias">Para las familias</a><Link className="presentation-login" href="/ingresar">Entrar al portal <ArrowRight size={16} aria-hidden="true" /></Link></nav>
    </header>
    <main id="escuela-contenido">
      <section className="presentation-hero">
        <div className="presentation-hero-copy"><p className="presentation-pill"><Leaf size={15} aria-hidden="true" /> CRECEMOS JUNTOS, CADA DÍA</p><h1>Un pequeño mundo.<br /><em>Grandes descubrimientos.</em></h1><p>Un espacio cálido y sencillo para conectar a la escuela con las familias y acompañar cada etapa de nuestros niños.</p><div className="presentation-actions"><Link href="/ingresar" className="presentation-primary">Entrar a mi escuela <ArrowRight size={18} aria-hidden="true" /></Link><a href="#acompanamiento" className="presentation-secondary">Conocer el portal</a></div><div className="presentation-stages"><span>Lactantes</span><span>Maternal</span><span>Prekínder</span><span>Preescolar</span></div></div>
        <div className="presentation-world" aria-label="Nuestra comunidad escolar"><span className="world-spark" aria-hidden="true">✦</span><div className="world-orbit" aria-hidden="true" /><div className="world-logo"><Image src="/logo-escuela.jpg" width={270} height={270} alt="El Mundo de los Niños, Aprendo Jugando" priority /></div><div className="world-note note-learning"><BookOpen size={22} aria-hidden="true" /><span>Aprender jugando<small>Curiosidad en cada etapa</small></span></div><div className="world-note note-family"><Heart size={22} aria-hidden="true" /><span>Familias conectadas<small>Un acompañamiento cercano</small></span></div><div className="world-note note-calendar"><CalendarDays size={22} aria-hidden="true" /><span>Todo en un lugar<small>Una rutina más sencilla</small></span></div><span className="world-flower" aria-hidden="true">✿</span></div>
      </section>
      <section id="acompanamiento" className="presentation-section"><div className="presentation-section-heading"><p className="eyebrow">UN PORTAL, MUCHAS FORMAS DE ACOMPAÑAR</p><h2>Lo cotidiano, un poco más fácil.</h2><p>Secciones claras para organizar la vida escolar, desde el celular o la computadora.</p></div><div className="presentation-feature-grid">{sections.map(({icon:Icon,title,text,detail,color})=><article key={title} className={`presentation-feature ${color}`}><span className="presentation-feature-icon"><Icon size={26} aria-hidden="true" /></span><h3>{title}</h3><p>{text}</p><span className="presentation-feature-detail">{detail}</span></article>)}</div></section>
      <section id="familias" className="presentation-family"><div><p className="eyebrow">CERCA DE TI, CERCA DE TUS NIÑOS</p><h2>Menos vueltas.<br />Más tiempo para acompañarlos.</h2><p>Dirección organiza la escuela, las maestras acompañan a sus grupos y cada familia consulta la información de sus hijos vinculados.</p><Link className="presentation-primary" href="/ingresar">Acceder con mi cuenta <ArrowRight size={18} aria-hidden="true" /></Link></div><ul>{["Consulta actividades y fechas en un solo lugar.","Descarga materiales y comparte entregas.","Revisa avances y observaciones de las maestras.","Comunícate con el equipo docente autorizado."].map(text=><li key={text}><span><Check size={19} aria-hidden="true" /></span>{text}</li>)}</ul></section>
      <section className="presentation-care"><ShieldCheck size={30} aria-hidden="true" /><div><h2>Un espacio para nuestra comunidad.</h2><p>El acceso al portal es mediante cuentas autorizadas por la escuela. Los expedientes, mensajes y archivos requieren iniciar sesión.</p><Link href="/aviso-de-privacidad">Consultar el estado del aviso de privacidad →</Link></div></section>
      <section className="presentation-final"><Sparkles size={28} aria-hidden="true" /><h2>Sigamos creciendo juntos.</h2><p>La escuela te proporciona tu cuenta. Entra para consultar las secciones disponibles para tu familia o tu grupo.</p><Link href="/ingresar" className="presentation-primary">Entrar al portal <ArrowRight size={18} aria-hidden="true" /></Link><p className="presentation-meet"><Video size={16} aria-hidden="true" /> Clases virtuales mediante enlaces de Google Meet. Grabaciones deshabilitadas.</p></section>
    </main>
    <footer className="presentation-footer"><span>El Mundo de los Niños <small>Aprendo jugando</small></span><Link href="/ingresar">Acceso escolar</Link><Link href="/aviso-de-privacidad">Privacidad</Link></footer>
  </div>;
}
