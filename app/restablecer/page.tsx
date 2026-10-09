"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { prepareSchoolAuthLink } from "@/lib/supabase/auth-link";

type LinkKind = "invite" | "recovery" | "password-reset";

export default function Restablecer() {
  const [token, setToken] = useState("");
  const [linkKind, setLinkKind] = useState<LinkKind | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const [linkChecked, setLinkChecked] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const callback = prepareSchoolAuthLink(window.location.href);
      window.history.replaceState(null, "", callback.cleanPath);
      if (callback.link) {
        setToken(callback.link.token);
        setLinkKind(callback.link.kind);
      } else {
        setError(callback.issue === "expired" ? "Este enlace ya venció. Solicita uno nuevo y abre el correo más reciente." : "Este enlace no es válido. Solicita uno nuevo desde Recuperar contraseña.");
      }
      setLinkChecked(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!token) {
      setError("Este enlace no es válido o ya venció. Solicita otro.");
      return;
    }
    if (password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    if (password.length < 12 || password.length > 128) {
      setError("Usa una contraseña de entre 12 y 128 caracteres.");
      return;
    }

    setPending(true);
    try {
      const response = await authClient.resetPassword({ newPassword: password, token });
      if (response.error) throw new Error(response.error.message === "No se pudo completar la solicitud."
        ? "El enlace no es válido o ya venció. Solicita otro." : response.error.message);
      setToken("");
      setPassword("");
      setConfirm("");
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cambiar la contraseña.");
    } finally {
      setPending(false);
    }
  }

  const isInvite = linkKind === "invite";

  return <main className="auth-page">
    <section className="auth-card">
      <Image src="/logo-escuela.jpg" width={92} height={92} alt="Logotipo El Mundo de los Niños" className="auth-logo" priority />
      <p className="eyebrow">SEGURIDAD DE LA CUENTA</p>
      <h1>{isInvite ? "Crea tu contraseña escolar" : "Nueva contraseña"}</h1>
      {done ? <>
        <p role="status" className="form-success">{isInvite ? "Tu contraseña quedó creada. Ahora puedes iniciar sesión con la contraseña que acabas de crear." : "La contraseña quedó actualizada. Por seguridad, vuelve a iniciar sesión."}</p>
        <Link href="/ingresar">Ir a iniciar sesión →</Link>
      </> : !linkChecked ? <p role="status">Comprobando el enlace…</p> : !token ? <>
        <p role="alert" className="form-error">{error}</p>
        <Link href="/recuperar">Solicitar un nuevo enlace →</Link>
        <p className="auth-help"><Link href="/ingresar">Volver a iniciar sesión</Link></p>
      </> : <>
        <p className="auth-intro">{isInvite ? "Elige una contraseña privada para completar el acceso a la escuela." : "Elige una contraseña nueva para tu cuenta escolar."}</p>
        <form onSubmit={submit} className="auth-form">
          <label htmlFor="new-password">Nueva contraseña</label>
          <input id="new-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} required disabled={pending} />
          <label htmlFor="confirm-password">Confirma la contraseña</label>
          <input id="confirm-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={confirm} onChange={event => setConfirm(event.target.value)} required disabled={pending} />
          {error && <p role="alert" className="form-error">{error}</p>}
          <button type="submit" disabled={pending}>{pending ? "Actualizando…" : "Guardar contraseña"}</button>
        </form>
      </>}
    </section>
  </main>;
}
