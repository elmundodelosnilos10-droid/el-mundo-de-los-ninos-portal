"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createNotificationController, INITIAL_NOTIFICATION_STATE, type NotificationState } from "@/lib/notification-client";
import { subscribeSchoolRealtime, type SchoolRealtimeUpdate } from "@/lib/school-realtime-client";
import styles from "./notification-center.module.css";

export function NotificationCenter() {
  const router = useRouter();
  const panelId = useId();
  const [state, setState] = useState<NotificationState>(INITIAL_NOTIFICATION_STATE);
  const [open, setOpen] = useState(false);
  const [realtimeStatus, setRealtimeStatus] = useState<Extract<SchoolRealtimeUpdate, { type: "status" }>["status"]>("disabled");
  const client = useRef<ReturnType<typeof createNotificationController> | null>(null);
  const toggleButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controller = createNotificationController({
      isOnline: () => navigator.onLine, isVisible: () => document.visibilityState !== "hidden",
      subscribe: listener => {
        document.addEventListener("visibilitychange", listener); window.addEventListener("online", listener); window.addEventListener("offline", listener);
        return () => { document.removeEventListener("visibilitychange", listener); window.removeEventListener("online", listener); window.removeEventListener("offline", listener); };
      },
      setTimer: (callback, delay) => window.setTimeout(callback, delay), clearTimer: timer => window.clearTimeout(timer),
      onChange: setState, onNavigate: href => router.push(href),
    });
    client.current = controller; controller.start();
    return () => { controller.dispose(); client.current = null; };
  }, [router]);

  useEffect(() => {
    let active = true;
    let previousStatus = "disabled";
    const unsubscribe = subscribeSchoolRealtime(update => {
      if (!active) return;
      if (update.type === "status") {
        setRealtimeStatus(update.status);
        if ((update.status === "connected" || update.status === "unauthorized") && update.status !== previousStatus) client.current?.refresh();
        previousStatus = update.status;
      } else if ((update.scope === "notifications" || update.scope === "all")) client.current?.refresh();
    });
    return () => { active = false; unsubscribe(); };
  }, []);

  const unread = state.items.filter(notice => !notice.readAt && !state.confirmedReadIds.includes(notice.id)).length;
  function toggle() { if (!open) client.current?.refresh(); setOpen(current => !current); }
  function close() { setOpen(false); toggleButton.current?.focus(); }
  return <div className="notification-center" onKeyDown={event => {
    if (open && event.key === "Escape") { event.preventDefault(); close(); }
  }}>
    <button ref={toggleButton} type="button" className="notification-toggle" aria-expanded={open} aria-controls={panelId} onClick={toggle}>Avisos{unread > 0 && <span className="notification-count" aria-label={`${unread} avisos sin leer`}>{unread}</span>}{(state.error || state.markError) && <span className={styles.errorIndicator} aria-label="Hay un problema con tus avisos">!</span>}</button>
    {open && <section id={panelId} className="notification-popover" aria-label="Notificaciones escolares" aria-busy={state.loading || Boolean(state.markingId)}>
      <div className="panel-heading"><strong>Notificaciones</strong><button type="button" className="secondary-button" onClick={close}>Cerrar</button></div>
      {!state.online && <p className={styles.status} role="status">Sin conexión. Los avisos se actualizarán cuando vuelvas a conectarte.</p>}
      {state.online && state.loading && <p className={styles.status} role="status">{state.loaded ? "Actualizando avisos…" : "Cargando avisos…"}</p>}
      {state.error && <p className="form-error" role="alert">{state.error}</p>}
      {state.markError && <p className="form-error" role="alert">{state.markError}</p>}
      {(state.error || state.markError) && <button type="button" className="secondary-button" disabled={state.loading || Boolean(state.markingId) || !state.online} onClick={() => client.current?.refresh()}>Actualizar avisos</button>}
      {state.items.map(notice => {
        const read = Boolean(notice.readAt) || state.confirmedReadIds.includes(notice.id);
        return <button type="button" className={`notification-row ${read ? "" : "unread"}`} key={notice.id} disabled={Boolean(state.markingId) || !state.online} aria-label={`${notice.title}${read ? ", leído" : ", sin leer"}`} onClick={() => client.current?.mark(notice)}>
          <strong>{notice.title}</strong><small>{new Date(notice.createdAt).toLocaleString("es-MX")}{state.markingId === notice.id ? " · Confirmando…" : ""}</small>
        </button>;
      })}
      {state.loaded && !state.loading && !state.error && state.items.length === 0 && <p>No tienes avisos disponibles.</p>}
      <p className={styles.status} role="status">{realtimeStatus === "connected" ? "Conexión de avisos en vivo activa; los cambios se verifican con la escuela." : realtimeStatus === "connecting" ? "Conectando las actualizaciones en vivo. Las consultas periódicas siguen activas." : realtimeStatus === "reconnecting" ? "Reconectando las actualizaciones en vivo. Seguimos consultando los avisos periódicamente." : realtimeStatus === "unauthorized" ? "La conexión en vivo no tiene acceso a la sesión. Revisa tu inicio de sesión." : "Actualización de avisos por consultas periódicas."}</p>
      <p className={styles.status}>Se muestran hasta 100 avisos recientes. Se consultan cada 30 segundos mientras esta pestaña está visible y tiene conexión. Si falla la conexión, los reintentos se espacian.</p>
    </section>}
  </div>;
}
