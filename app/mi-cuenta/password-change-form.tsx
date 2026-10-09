"use client";

import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";

export function PasswordChangeForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess(false);
    if (newPassword !== confirmation) {
      setError("Las contraseñas nuevas no coinciden.");
      return;
    }
    if (newPassword.length < 12) {
      setError("La contraseña nueva debe tener al menos 12 caracteres.");
      return;
    }
    setPending(true);
    try {
      const result = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
      if (result.error) throw new Error("No se pudo cambiar la contraseña. Verifica la contraseña actual e inténtalo de nuevo.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
      setSuccess(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cambiar la contraseña.");
    } finally {
      setPending(false);
    }
  }

  return <form onSubmit={submit} className="school-form password-change-form">
    <label htmlFor="current-password">Contraseña actual</label>
    <input id="current-password" type="password" autoComplete="current-password" minLength={8} value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required disabled={pending} />
    <label htmlFor="new-password">Nueva contraseña</label>
    <input id="new-password" type="password" autoComplete="new-password" minLength={12} value={newPassword} onChange={event => setNewPassword(event.target.value)} required disabled={pending} />
    <label htmlFor="confirm-password">Confirma la contraseña nueva</label>
    <input id="confirm-password" type="password" autoComplete="new-password" minLength={12} value={confirmation} onChange={event => setConfirmation(event.target.value)} required disabled={pending} />
    {error && <p className="form-error" role="alert">{error}</p>}
    {success && <p className="form-success" role="status">Contraseña actualizada. Usa la nueva contraseña la próxima vez que ingreses.</p>}
    <button type="submit" disabled={pending}>{pending ? "Actualizando…" : "Actualizar contraseña"}</button>
  </form>;
}
