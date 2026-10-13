"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

const connectionError = "No se pudo confirmar la operación. Revisa tu conexión antes de volver a intentarlo. Si ya creaste tu contraseña, intenta entrar al portal.";
const codeError = "No pudimos verificar el código. Revisa el correo y el código completo. Si venció o ya se usó, solicita ayuda a la escuela.";
function validEmail(value: unknown): value is string { return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }

export default function ActivarCuenta() {
  const [phase, setPhase] = useState<"code" | "password" | "done">("code");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const mounted = useRef(false);
  const lock = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const version = useRef(0);

  const request = useCallback(async (path: string, method: "GET" | "POST", body?: Record<string, string>) => {
    if (!mounted.current || lock.current) return;
    lock.current = true;
    const generation = ++version.current;
    const abort = new AbortController(); controller.current = abort;
    const current = () => mounted.current && version.current === generation && !abort.signal.aborted;
    setBusy(true); setError("");
    try {
      const response = await fetch(path, { method, credentials: "same-origin", cache: "no-store", ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}), signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20_000)]) });
      if (!current()) return;
      const result: unknown = await response.json().catch(() => null);
      if (!current()) return;
      if (response.status !== 200 || !record(result)) {
        if (method === "GET") { setCheckFailed(true); setReady(false); }
        if (path.endsWith("/complete") && (response.status === 401 || response.status === 403 || (record(result) && result.code === "activation_consumed"))) {
          setPassword(""); setConfirmPassword(""); setCode(""); setPhase("code");
          setError(record(result) && result.code === "activation_consumed"
            ? "Esta activación ya no está disponible. Prueba iniciar sesión con la contraseña que elegiste; si no funciona, consulta a la escuela."
            : "Tu activación venció o ya no está disponible. Consulta a la escuela para recuperar tu acceso.");
          return;
        }
        setError(path.endsWith("/verify") ? codeError : connectionError);
        return;
      }
      if (method === "GET") {
        if (typeof result.pending !== "boolean" || (result.pending && !validEmail(result.email))) throw Error();
        setCheckFailed(false); setReady(true);
        if (result.pending) { setPhase("password"); setEmail(result.email as string); setCode(""); }
        else { setPhase("code"); setPassword(""); setConfirmPassword(""); }
      } else if (path.endsWith("/verify")) {
        if (result.verified !== true || !validEmail(result.email) || result.email.trim().toLowerCase() !== body?.email) throw Error();
        setEmail(result.email); setCode(""); setPhase("password");
      } else if (path.endsWith("/complete")) {
        if (result.activated !== true) throw Error();
        setPassword(""); setConfirmPassword(""); setCode(""); setPhase("done");
      } else if (path.endsWith("/cancel")) {
        if (result.cancelled !== true) throw Error();
        setPassword(""); setConfirmPassword(""); setCode(""); setPhase("code");
      }
    } catch {
      if (current()) {
        if (method === "GET") { setCheckFailed(true); setReady(false); }
        setError(connectionError);
      }
    } finally {
      if (current()) { lock.current = false; controller.current = null; setBusy(false); }
    }
  }, []);

  const cancelRequests = useCallback(() => {
    mounted.current = false; version.current++; controller.current?.abort(); controller.current = null; lock.current = false;
  }, []);
  useEffect(() => {
    let current = true;
    mounted.current = true;
    void Promise.resolve().then(() => { if (current) void request("/api/account-activation", "GET"); });
    return () => { current = false; cancelRequests(); };
  }, [request, cancelRequests]);

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || lock.current || phase !== "code" || !mounted.current) return;
    const normalized = email.trim().toLowerCase();
    if (!validEmail(normalized) || !/^EMDN1\.[A-Za-z0-9_-]{80,2042}$/.test(code.trim())) { setError(codeError); return; }
    await request("/api/account-activation/verify", "POST", { email: normalized, code: code.trim() });
  }
  async function complete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || lock.current || phase !== "password" || !mounted.current) return;
    if (password.length < 12 || password.length > 128) { setError("Elige una contraseña de entre 12 y 128 caracteres."); return; }
    if (password !== confirmPassword) { setError("Las contraseñas no coinciden. Escríbelas iguales."); return; }
    await request("/api/account-activation/complete", "POST", { password, confirmPassword });
  }

  const disabled = !ready || busy;
  return <main className="auth-page">
    <div className="auth-decoration" aria-hidden="true"><span>✦</span><span>●</span><span>✳</span></div>
    <section className="auth-card" aria-labelledby="activation-title">
      <Image src="/logo-escuela.jpg" width={92} height={92} alt="Logotipo El Mundo de los Niños" className="auth-logo" priority />
      <p className="eyebrow">TU PRIMER ACCESO</p>
      <h1 id="activation-title">{phase === "done" ? "Tu cuenta está lista" : phase === "password" ? "Crea tu contraseña" : "Activa tu cuenta escolar"}</h1>
      {phase === "code" && <><p className="auth-intro">Dirección te dará un código privado de un solo uso. Usa el correo que registraron para ti; no necesitas una cuenta nueva de Gmail.</p>
        <form className="auth-form" onSubmit={verify}>
          <label htmlFor="activation-email">Tu correo electrónico</label><input id="activation-email" type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} maxLength={254} required disabled={disabled} />
          <label htmlFor="activation-code">Código privado de la escuela</label><textarea id="activation-code" value={code} onChange={event => setCode(event.target.value)} maxLength={2048} rows={4} spellCheck={false} autoComplete="off" required disabled={disabled} />
          <p className="form-hint">Copia y pega el código completo. Si venció o ya fue usado, consulta a la escuela; no lo compartas con otras personas.</p>
          <button type="submit" disabled={disabled}>{busy ? "Comprobando…" : "Verificar mi código"}</button>
        </form></>}
      {phase === "password" && <><p className="auth-intro">El código se verificó para <strong>{email}</strong>. Elige una contraseña privada. Después entrarás con ese correo y tu contraseña.</p>
        <form className="auth-form" onSubmit={complete}>
          <label htmlFor="activation-password">Nueva contraseña</label><input id="activation-password" type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} minLength={12} maxLength={128} required disabled={disabled} />
          <label htmlFor="activation-confirm-password">Repite tu contraseña</label><input id="activation-confirm-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} minLength={12} maxLength={128} required disabled={disabled} />
          <p className="form-hint">Usa entre 12 y 128 caracteres. No compartas tu contraseña, ni siquiera con la escuela.</p>
          <button type="submit" disabled={disabled}>{busy ? "Guardando…" : "Activar mi cuenta"}</button>
        </form><button type="button" className="secondary-button" disabled={disabled} onClick={() => { void request("/api/account-activation/cancel", "POST", {}); }}>Cancelar y usar otro código</button></>}
      {phase === "done" && <><p className="form-success" role="status">Tu contraseña quedó confirmada. Ya puedes entrar con tu correo y la contraseña que elegiste.</p><a href="/ingresar">Entrar al portal</a></>}
      {!ready && !checkFailed && <p role="status">Preparando activación…</p>}
      {error && <p role="alert" className="form-error">{error}</p>}
      {checkFailed && <button type="button" className="secondary-button" disabled={busy} onClick={() => { void request("/api/account-activation", "GET"); }}>Volver a comprobar</button>}
      <p className="auth-help"><a href="/ingresar">Ya tengo cuenta · iniciar sesión</a></p>
      <p className="auth-help"><a href="/aviso-de-privacidad">Aviso de privacidad · estado de preparación</a></p>
    </section>
  </main>;
}
