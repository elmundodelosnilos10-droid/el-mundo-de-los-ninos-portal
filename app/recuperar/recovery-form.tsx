"use client";

import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";

export function RecoveryForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const response = await authClient.requestPasswordReset({
        email: email.trim().toLowerCase(),
        redirectTo: `${window.location.origin}/restablecer`,
      });
      if (response.error) {
        throw new Error(response.error.message);
      }
      setSent(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo procesar la solicitud.");
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return <p role="status" className="form-success">Si el correo corresponde a una cuenta escolar, recibirás un enlace para cambiar la contraseña. Revisa tu bandeja de entrada.</p>;
  }

  return <>
    <p className="auth-intro">Te enviaremos un enlace seguro al correo de tu cuenta escolar.</p>
    <form onSubmit={submit} className="auth-form">
      <label htmlFor="recovery-email">Correo electrónico</label>
      <input id="recovery-email" type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required disabled={pending} />
      {error && <p role="alert" className="form-error">{error}</p>}
      <button type="submit" disabled={pending}>{pending ? "Enviando…" : "Enviar enlace"}</button>
    </form>
  </>;
}
