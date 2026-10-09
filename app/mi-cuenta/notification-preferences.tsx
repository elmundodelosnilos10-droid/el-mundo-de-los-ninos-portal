"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./notification-preferences.module.css";

type Channel = "email" | "webpush";
type SubscriptionRecord = { id: string; active: boolean; createdAt: string };
type NoticeSettings = {
  capabilities: { email: boolean; webpush: boolean; publicVapidKey?: string };
  preferences: { channel: Channel; enabled: boolean }[];
  subscriptions: SubscriptionRecord[];
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class NoticeActionError extends Error {}

function settingsFrom(value: unknown): NoticeSettings {
  if (!value || typeof value !== "object") throw Error("Invalid settings");
  const row = value as NoticeSettings;
  if (!row.capabilities || typeof row.capabilities.email !== "boolean" || typeof row.capabilities.webpush !== "boolean" ||
    (row.capabilities.webpush && typeof row.capabilities.publicVapidKey !== "string") ||
    !Array.isArray(row.preferences) || row.preferences.length > 2 || !Array.isArray(row.subscriptions) || row.subscriptions.length > 5 ||
    row.preferences.some(item => !item || !["email", "webpush"].includes(item.channel) || typeof item.enabled !== "boolean") ||
    row.subscriptions.some(item => !item || !uuid.test(item.id) || typeof item.active !== "boolean" || typeof item.createdAt !== "string" || !Number.isFinite(Date.parse(item.createdAt)))) throw Error("Invalid settings");
  if (new Set(row.preferences.map(item => item.channel)).size !== row.preferences.length || new Set(row.subscriptions.map(item => item.id)).size !== row.subscriptions.length) throw Error("Invalid settings");
  return row;
}
async function request(url: string, method = "GET", body?: unknown) {
  const response = await fetch(url, {
    method, credentials: "same-origin", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000),
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (!response.ok) throw Error("Request unconfirmed");
  return await response.json() as Record<string, unknown>;
}
function browserSupportsPush() {
  return typeof window !== "undefined" && window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}
function vapidBytes(value: string) {
  const decoded = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(decoded, character => character.charCodeAt(0));
  if (bytes.length !== 65 || bytes[0] !== 4) throw Error("Invalid public key");
  return bytes;
}
async function browserOperation<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error("Browser operation unconfirmed")), 20_000); })]);
  } finally { if (timer) clearTimeout(timer); }
}

export function NotificationPreferences() {
  const [settings, setSettings] = useState<NoticeSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [emailConsent, setEmailConsent] = useState(false);
  const [pushConsent, setPushConsent] = useState(false);
  const [pushSupported, setPushSupported] = useState(false);
  const [unknownBrowserSubscription, setUnknownBrowserSubscription] = useState(false);
  const active = useRef(false);
  const pending = useRef(false);
  // The association exists only after this mounted view confirms its own POST.
  // A stored browser endpoint is never adopted or rebound to a different account.
  const localSubscription = useRef<{ id: string; subscription: PushSubscription } | null>(null);

  async function readSettings() {
    const next = settingsFrom(await request("/api/notification-channels"));
    if (active.current) { setSettings(next); setPushSupported(browserSupportsPush()); setNeedsRefresh(false); }
    return next;
  }
  async function refresh() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try { await readSettings(); }
    catch { if (active.current) { setSettings(null); setNeedsRefresh(true); setError("No se pudo consultar tu configuración. Consulta su estado antes de hacer cambios."); } }
    finally { pending.current = false; if (active.current) setBusy(false); }
  }
  useEffect(() => {
    active.current = true;
    // No permissions, worker registration or subscription creation on mount.
    void refresh();
    return () => { active.current = false; };
    // The first read runs once; later refreshes are explicit user actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function change(action: () => Promise<void>, success: string) {
    if (pending.current || !settings || needsRefresh) return;
    pending.current = true; setBusy(true); setError(""); setMessage("");
    try {
      await action();
      if (!active.current) return;
      await readSettings();
      if (active.current) { setMessage(success); setEmailConsent(false); setPushConsent(false); }
    } catch (cause) {
      if (active.current) {
        setNeedsRefresh(true);
        setError(cause instanceof NoticeActionError ? `${cause.message} Consulta el estado antes de volver a cambiarlo.` : "No se pudo confirmar el cambio. Puede haberse guardado. Pulsa Consultar estado antes de decidir si necesitas intentarlo otra vez.");
      }
    } finally { pending.current = false; if (active.current) setBusy(false); }
  }
  async function preference(channel: Channel, enabled: boolean) {
    const result = await request("/api/notification-channels", "PATCH", { channel, enabled, consentConfirmed: enabled });
    if (result.channel !== channel || result.enabled !== enabled) throw Error("Preference unconfirmed");
  }
  function email(enabled: boolean) {
    if (!settings || (enabled && (!settings.capabilities.email || !emailConsent))) return;
    return change(() => preference("email", enabled), enabled ? "Avisos por correo activados para tu cuenta." : "Avisos por correo desactivados.");
  }
  function activatePush() {
    if (!settings?.capabilities.webpush || !pushConsent || !pushSupported) return;
    return change(async () => {
      // Keep permission initiation inside the user's click, before any await.
      const applicationServerKey = vapidBytes(settings.capabilities.publicVapidKey!);
      const permissionRequest = Notification.requestPermission();
      const permission = await browserOperation(permissionRequest);
      if (permission !== "granted") throw new NoticeActionError("No se concedió el permiso de avisos. No se activó este navegador.");
      if (!active.current) throw Error("View closed");
      const existingRegistration = await browserOperation(navigator.serviceWorker.getRegistration("/"));
      const existing = existingRegistration ? await browserOperation(existingRegistration.pushManager.getSubscription()) : null;
      if (!active.current) throw Error("View closed");
      if (existing) {
        if (active.current) setUnknownBrowserSubscription(true);
        throw new NoticeActionError("Este navegador ya tiene una suscripción. Si deseas reemplazarla, usa Reiniciar avisos de este navegador.");
      }
      await preference("webpush", true);
      if (!active.current) throw Error("View closed");
      const registration = await browserOperation(navigator.serviceWorker.register("/school-notices-sw.js", { scope: "/" }));
      await browserOperation(navigator.serviceWorker.ready);
      if (!active.current) throw Error("View closed");
      const subscription = await browserOperation(registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey }));
      if (!active.current) throw Error("View closed");
      const result = await request("/api/push-subscriptions", "POST", subscription.toJSON());
      if (typeof result.id !== "string" || !uuid.test(result.id) || result.registered !== true) throw Error("Subscription unconfirmed");
      localSubscription.current = { id: result.id, subscription };
      if (active.current) setUnknownBrowserSubscription(false);
    }, "Avisos activados en este navegador para tu cuenta.");
  }
  function resetBrowser() {
    if (!pushSupported) return;
    return change(async () => {
      const registration = await browserOperation(navigator.serviceWorker.getRegistration("/"));
      const subscription = registration ? await browserOperation(registration.pushManager.getSubscription()) : null;
      if (subscription && !(await browserOperation(subscription.unsubscribe()))) throw Error("Local removal unconfirmed");
      localSubscription.current = null;
      if (active.current) setUnknownBrowserSubscription(false);
    }, "Avisos reiniciados en este navegador. Actívalos de nuevo si deseas recibirlos aquí.");
  }
  function revoke(id: string) {
    if (!settings?.subscriptions.some(item => item.id === id)) return;
    return change(async () => {
      const result = await request("/api/push-subscriptions", "DELETE", { id });
      if (result.removed !== true) throw Error("Removal unconfirmed");
      if (localSubscription.current?.id === id) {
        if (!(await browserOperation(localSubscription.current.subscription.unsubscribe()))) throw Error("Local removal unconfirmed");
        localSubscription.current = null;
      }
    }, "Suscripción propia retirada. Este registro ya no recibirá nuevos avisos.");
  }

  const locked = busy || !settings || needsRefresh;
  const enabled = (channel: Channel) => settings?.preferences.some(item => item.channel === channel && item.enabled) ?? false;
  return <section className={`portal-panel ${styles.panel}`} aria-labelledby="external-notices-title" aria-busy={busy}>
    <p className="eyebrow">TÚ DECIDES</p>
    <h2 id="external-notices-title">Avisos fuera del portal</h2>
    <p>Son opcionales y propios de tu cuenta. El mensaje siempre será genérico: tendrás que entrar al portal para consultar el aviso. La recepción depende del proveedor y del navegador.</p>
    <button type="button" className={styles.secondary} disabled={busy} onClick={() => void refresh()}>Consultar estado</button>
    {!settings && !error && <p role="status">Consultando tu configuración…</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {message && <p className={styles.success} role="status">{message}</p>}
    {settings && !settings.capabilities.email && !settings.capabilities.webpush && <p className="empty-state">La escuela todavía no tiene un canal externo disponible. Puedes consultar los avisos dentro del portal.</p>}
    {settings && (settings.capabilities.email || enabled("email")) && <fieldset className={styles.channel} disabled={locked}>
      <legend>Avisos por correo</legend>
      <p>Último estado consultado: <strong>{enabled("email") ? "activados" : "desactivados"}</strong>. Se utiliza el correo verificado de tu cuenta.</p>
      {!enabled("email") && <label className={styles.consent}><input type="checkbox" checked={emailConsent} onChange={event => setEmailConsent(event.target.checked)} />Autorizo recibir avisos genéricos del portal en mi correo.</label>}
      <button type="button" className={styles.primary} disabled={locked || (!enabled("email") && !emailConsent)} onClick={() => void email(!enabled("email"))}>{enabled("email") ? "Desactivar correo" : "Activar correo"}</button>
    </fieldset>}
    {settings && (settings.capabilities.webpush || enabled("webpush") || settings.subscriptions.length > 0) && <fieldset className={styles.channel} disabled={locked}>
      <legend>Avisos en este navegador</legend>
      <p>Canal de tu cuenta: <strong>{enabled("webpush") ? "activado" : "desactivado"}</strong>. Usar un navegador compartido puede permitir que otras personas vean estos avisos genéricos.</p>
      {!settings.capabilities.webpush && <p>El canal no está disponible para nuevas activaciones. Puedes desactivarlo o retirar tus suscripciones.</p>}
      {settings.capabilities.webpush && !pushSupported && <p>Este navegador no permite activar avisos. Usa un navegador compatible en una conexión segura.</p>}
      <div className={styles.actions}>{enabled("webpush") && <button type="button" className={styles.secondary} disabled={locked} onClick={() => void change(() => preference("webpush", false), "Avisos de navegador desactivados para tu cuenta.")}>Desactivar canal de navegador</button>}</div>
      {pushSupported && <>
        {settings.capabilities.webpush && <><label className={styles.consent}><input type="checkbox" checked={pushConsent} onChange={event => setPushConsent(event.target.checked)} />Autorizo avisos genéricos en este navegador y el permiso que me solicitará.</label>
          <button type="button" className={styles.primary} disabled={locked || !pushConsent} onClick={() => void activatePush()}>Activar en este equipo</button></>}
        {unknownBrowserSubscription && <p className={styles.warning}>Ya existen avisos en este navegador y no podemos confirmar que pertenezcan a tu cuenta. No los vincularemos automáticamente.</p>}
        <div className={styles.reset}><p>Reiniciar quita la recepción de avisos de este navegador, incluso si se usó con otra cuenta. Después necesitarás activarlos otra vez. No borra registros de otras personas.</p>
          <button type="button" className={styles.secondary} disabled={locked} onClick={() => void resetBrowser()}>Reiniciar avisos de este navegador</button></div>
      </>}
      <h3>Suscripciones de tu cuenta</h3>
      {settings.subscriptions.length ? <ul className={styles.devices}>{settings.subscriptions.map((item, index) => <li key={item.id}><span>Suscripción {index + 1} · {item.active ? "activa" : "inactiva"}<small>Registrada {new Date(item.createdAt).toLocaleDateString("es-MX", { timeZone: "America/Mexico_City" })}</small></span><button type="button" className={styles.secondary} disabled={locked} aria-label={`Retirar suscripción ${index + 1} de mi cuenta`} onClick={() => void revoke(item.id)}>Retirar</button></li>)}</ul> : <p className="empty-state">No tienes suscripciones registradas. Activar el canal no activa por sí solo un dispositivo.</p>}
    </fieldset>}
  </section>;
}
