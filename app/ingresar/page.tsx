"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";

// Display only public availability messages that our auth server deliberately
// returns. Unexpected upstream errors and invalid credentials remain generic.
const accessAvailabilityMessages = new Set([
  "El acceso escolar todavía no está configurado.",
  "No fue posible conectar con el servicio de acceso.",
  "No fue posible comprobar el acceso escolar. Inténtalo más tarde o consulta a dirección.",
  "Tu cuenta escolar se autenticó, pero aún no se pudo sincronizar el acceso. Inténtalo más tarde o contacta a dirección.",
  "No fue posible conectar con la escuela.",
]);

export default function Ingresar() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(false);
  const mounted = useRef(false);
  const submitting = useRef(false);

  useEffect(() => {
    mounted.current = true;
    void Promise.resolve().then(() => { if (mounted.current) setReady(true); });
    return () => { mounted.current = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || !mounted.current || submitting.current) return;
    submitting.current = true;
    setError("");
    setPending(true);
    try {
      const result = await authClient.signIn.email({ email: email.trim().toLowerCase(), password });
      if (!mounted.current) return;
      if (result.error) {
        setError(accessAvailabilityMessages.has(result.error.message)
          ? result.error.message
          : "No pudimos iniciar sesión. Revisa tus datos o consulta a dirección.");
        return;
      }
      const data = result.data as { user?: { id?: unknown; name?: unknown; email?: unknown } } | null;
      if (!data?.user || typeof data.user.id !== "string" || !data.user.id || typeof data.user.name !== "string" ||
          typeof data.user.email !== "string" || data.user.email.trim().toLowerCase() !== email.trim().toLowerCase()) {
        setError("No pudimos confirmar el acceso. Inténtalo de nuevo o consulta a dirección.");
        return;
      }
      router.push("/");
    } catch {
      if (mounted.current) setError("No fue posible conectar con la escuela. Inténtalo de nuevo.");
    } finally {
      submitting.current = false;
      if (mounted.current) setPending(false);
    }
  }

  return <main className="auth-page">
    <div className="auth-decoration" aria-hidden="true"><span>✦</span><span>●</span><span>✳</span></div>
    <section className="auth-card" aria-labelledby="auth-title">
      <Image src="/logo-escuela.jpg" width={92} height={92} alt="Logotipo El Mundo de los Niños" className="auth-logo" priority />
      <p className="eyebrow">PORTAL ESCOLAR</p>
      <h1 id="auth-title">Bienvenidos a nuestra escuela</h1>
      <p className="auth-intro">Entra con la cuenta que te proporcionó El Mundo de los Niños.</p>
      <form onSubmit={submit} className="auth-form">
        <label htmlFor="email">Correo electrónico</label>
        <input id="email" type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="username" required disabled={!ready || pending} />
        <label htmlFor="password">Contraseña</label>
        <input id="password" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required disabled={!ready || pending} />
        {!ready && <p role="status" className="form-hint">Preparando acceso…</p>}
        {error && <p role="alert" className="form-error">{error}</p>}
        <button type="submit" disabled={!ready || pending}>{!ready ? "Preparando acceso…" : pending ? "Entrando…" : "Entrar al portal"}</button>
      </form>
      <p className="auth-help"><a href="/recuperar">¿Olvidaste tu contraseña?</a></p>
      <p className="auth-help"><a href="/aviso-de-privacidad">Aviso de privacidad · estado de preparación</a></p>
      <p className="auth-help">Si todavía no tienes cuenta, dirección escolar te dará acceso.</p>
      <p className="auth-help"><a href="/escuela">Conoce el portal de nuestra escuela →</a></p>
    </section>
  </main>;
}
