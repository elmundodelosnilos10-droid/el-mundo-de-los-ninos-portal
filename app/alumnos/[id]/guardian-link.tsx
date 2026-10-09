"use client";

import { useState, type FormEvent } from "react";

type Guardian = { id: string; name: string; email: string };

export function GuardianLinkManager({ studentId, guardians }: { studentId: string; guardians: Guardian[] }) {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setMessage(""); setBusy(true);
    try {
      const response = await fetch(`/api/students/${studentId}/guardians`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "No se pudo vincular al tutor.");
      setMessage("Tutor vinculado. Actualiza la página para ver la relación.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Error de conexión."); }
    finally { setBusy(false); }
  }
  return guardians.length ? <form className="school-form" onSubmit={submit}><label htmlFor="guardian-id">Cuenta del tutor</label><select id="guardian-id" name="guardianId" required disabled={busy}>{guardians.map(guardian => <option key={guardian.id} value={guardian.id}>{guardian.name} · {guardian.email}</option>)}</select><label htmlFor="relationship">Parentesco</label><input id="relationship" name="relationship" placeholder="Madre, padre, tutor legal…" required minLength={2} maxLength={40} disabled={busy} /><button disabled={busy}>Vincular tutor</button>{error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success" role="status">{message}</p>}</form> : <p>Crea primero una cuenta de tutor en Cuentas.</p>;
}
