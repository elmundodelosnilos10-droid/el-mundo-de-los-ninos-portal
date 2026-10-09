"use client";

import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { useState } from "react";

const failureMessage = "No se pudo cerrar tu sesión. Revisa la conexión e inténtalo de nuevo.";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function signOut() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const result = await authClient.signOut();
      if (result.error) { setError(failureMessage); return; }
      router.push("/ingresar");
    } catch { setError(failureMessage); }
    finally { setBusy(false); }
  }
  return <><button type="button" className="sign-out" disabled={busy} onClick={signOut}>{busy ? "Cerrando sesión…" : "Cerrar sesión"}</button>{error && <p className="form-error fixed bottom-4 right-4 z-[100] max-w-[calc(100vw-32px)] rounded-xl border border-[#f0d2cc] bg-white p-4 shadow-lg" role="alert">{error}</p>}</>;
}
