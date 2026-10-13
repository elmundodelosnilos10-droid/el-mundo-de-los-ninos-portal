"use client";

import { useEffect, useRef, useState } from "react";

type Code = { code: string; expiresAt: string; activationPath: "/activar-cuenta" };
function receipt(value: unknown, targetId: string): Code | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as { id?: unknown; invited?: unknown; activation?: unknown };
  if (result.id !== targetId || result.invited !== false || !result.activation || typeof result.activation !== "object" || Array.isArray(result.activation)) return null;
  const code = result.activation as Partial<Code>;
  return typeof code.code === "string" && /^EMDN1\.[A-Za-z0-9_-]{80,2042}$/.test(code.code)
    && code.activationPath === "/activar-cuenta" && typeof code.expiresAt === "string"
    && Number.isFinite(Date.parse(code.expiresAt)) && Date.parse(code.expiresAt) > Date.now() ? code as Code : null;
}

export function InternalReissueControl({ targetId, email, contextKey, disabled, beginOperation, onUnauthorized, onUncertain }: {
  targetId: string; email: string; contextKey: string; disabled: boolean;
  beginOperation: () => (() => void) | null; onUnauthorized: () => void; onUncertain: () => void;
}) {
  const context = `${contextKey}:${targetId}:${email}`;
  const [result, setResult] = useState<{ context: string; code: Code } | null>(null);
  const [feedback, setFeedback] = useState<{ context: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(false);
  const [access, setAccess] = useState(true);
  const alive = useRef(false);
  const generation = useRef(0);
  const lock = useRef(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true; generation.current++;
    const version = generation.current;
    queueMicrotask(() => {
      if (!alive.current || version !== generation.current) return;
      setResult(null); setFeedback(null); setReview(false); setAccess(true); setBusy(false);
    });
    return () => { alive.current = false; generation.current = version + 1; request.current?.abort(); request.current = null; lock.current = false; };
  }, [context]);

  async function renew() {
    if (!alive.current || disabled || lock.current || review || !access) return;
    if (!window.confirm(`¿Renovar el código de primer acceso de ${email}? Solo funciona si todavía no verificó su invitación. El código anterior dejará de servir.`)) return;
    const release = beginOperation();
    if (!release) return;
    lock.current = true; setBusy(true); setResult(null); setFeedback(null);
    const version = generation.current;
    const controller = new AbortController(); request.current = controller;
    const current = () => alive.current && version === generation.current && !controller.signal.aborted;
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(targetId)}/activation/reissue`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
      if (!current()) return;
      const body = await response.json().catch(() => null);
      if (!current()) return;
      if (response.status === 401 || response.status === 403) {
        setAccess(false); setResult(null); setFeedback({ context, message: "Tu sesión o tus permisos cambiaron. Vuelve a ingresar para revisar el acceso." }); onUnauthorized(); return;
      }
      if (response.status === 409) {
        setReview(true); setFeedback({ context, message: "Este acceso ya no es una invitación pendiente sin verificar. Solicita recuperación de acceso; no se cambió su contraseña." }); return;
      }
      const code = response.status === 201 ? receipt(body, targetId) : null;
      if (!code) throw Error();
      setResult({ context, code });
      setFeedback({ context, message: "Código renovado. Compártelo únicamente con la persona correspondiente." });
      setReview(true);
    } catch {
      if (current()) { setReview(true); setFeedback({ context, message: "No se pudo confirmar la renovación. No repitas la solicitud: la escuela debe revisar el estado del acceso." }); onUncertain(); }
    } finally {
      if (generation.current === version) lock.current = false;
      release();
      if (current()) { request.current = null; setBusy(false); }
    }
  }

  const code = result?.context === context ? result.code : null;
  const message = feedback?.context === context ? feedback.message : "";
  return <section aria-label="Renovar primer acceso">
    <p className="form-hint">Si perdió el código y todavía no verificó su invitación, puedes renovarlo. Las cuentas que ya ingresaron necesitan recuperación de acceso.</p>
    <button className="secondary-button" type="button" disabled={disabled || busy || review || !access} onClick={() => { void renew(); }}>{busy ? "Renovando código…" : "Renovar código pendiente"}</button>
    {message && <p role={code ? "status" : "alert"}>{message}</p>}
    {code && <aside aria-label="Código privado renovado">
      <label htmlFor={`reissue-code-${targetId}`}>Código de un solo uso para {email}</label>
      <textarea id={`reissue-code-${targetId}`} readOnly rows={3} spellCheck={false} value={code.code} />
      <p>Vence: {new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Mexico_City" }).format(new Date(code.expiresAt))} (hora de Ciudad de México).</p>
      <p>La persona entra en <a href="/activar-cuenta">Activar mi cuenta</a> y elige su contraseña en privado.</p>
      <button className="secondary-button" type="button" onClick={() => setResult(null)}>Ocultar código</button>
    </aside>}
  </section>;
}
