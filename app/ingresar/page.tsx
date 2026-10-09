"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const result = await authClient.signIn.email({ email: email.trim().toLowerCase(), password });
      if (result.error) {
        setError(accessAvailabilityMessages.has(result.error.message)
          ? result.error.message
          : "No pudimos iniciar sesión. Revisa tus datos o consulta a dirección.");
        return;
      }
      router.push("/");
    } catch {
      setError("No fue posible conectar con la escuela. Inténtalo de nuevo.");
    } finally {
      setPending(false);
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
        <input id="email" type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="username" required disabled={pending} />
        <label htmlFor="password">Contraseña</label>
        <input id="password" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required disabled={pending} />
        {error && <p role="alert" className="form-error">{error}</p>}
        <button type="submit" disabled={pending}>{pending ? "Entrando…" : "Entrar al portal"}</button>
      </form>
      <p className="auth-help"><a href="/recuperar">¿Olvidaste tu contraseña?</a></p>
      <p className="auth-help"><a href="/aviso-de-privacidad">Aviso de privacidad · estado de preparación</a></p>
      <p className="auth-help">Si todavía no tienes cuenta, dirección escolar te dará acceso.</p>
      <p className="auth-help"><a href="/escuela">Conoce el portal de nuestra escuela →</a></p>
    </section>
  </main>;
}
