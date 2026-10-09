import styles from "./portal-fallback.module.css";

export type PortalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
  // Next 16.3+ can refresh server content; Vinext currently supplies reset only.
  retry?: () => void;
};
type FallbackKind = "error" | "loading" | "not-found";
const content = {
  error: { label: "PODEMOS VOLVER A INTENTARLO", title: "No pudimos cargar esta página", description: "Inténtalo de nuevo. Si el problema continúa, vuelve al inicio o comunícate con la escuela." },
  loading: { label: "UN MOMENTO", title: "Estamos preparando tu página", description: "Cargando el portal. Espera un momento para continuar." },
  "not-found": { label: "PÁGINA NO DISPONIBLE", title: "Volvamos al inicio", description: "Esta página no está disponible. Desde el inicio puedes elegir la sección que necesitas." },
} as const;

/** Public, self-contained fallback: no account, route or error details. */
export function PortalFallback({ kind, onRetry }: { kind: FallbackKind; onRetry?: () => void }) {
  const copy = content[kind];
  return <main className={styles.screen} aria-labelledby="portal-fallback-title">
    <div className={styles.card}>
      {/* A direct public asset keeps this fallback independent of image APIs. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={styles.logo} src="/logo-escuela.jpg" alt="Logo de El Mundo de los Niños" width={88} height={88} />
      <p className={styles.school}>El Mundo de los Niños<span>Portal escolar · Aprendo jugando</span></p>
      <p className={styles.label}>{copy.label}</p>
      <h1 id="portal-fallback-title" className={styles.title}>{copy.title}</h1>
      <p id="portal-fallback-description" className={styles.description} role={kind === "error" ? "alert" : kind === "loading" ? "status" : undefined} aria-live={kind === "loading" ? "polite" : undefined}>{copy.description}</p>
      <div className={styles.actions}>
        {kind === "error" && onRetry ? <button type="button" className={styles.retry} onClick={onRetry} aria-describedby="portal-fallback-description">Volver a intentar</button> : null}
        {/* Full navigation also works if the router or root layout failed. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className={styles.home} href="/">Ir al inicio</a>
      </div>
      <p className={styles.help}>{kind === "error" ? "Si estabas enviando algo, consulta su estado antes de volver a enviarlo." : "Un lugar para aprender y acompañar, paso a paso."}</p>
    </div>
  </main>;
}
