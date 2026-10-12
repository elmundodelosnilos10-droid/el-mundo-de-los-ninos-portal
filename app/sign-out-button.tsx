"use client";

import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const failureMessage = "No se pudo cerrar tu sesión. Revisa la conexión e inténtalo de nuevo.";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const mounted = useRef(false);
  const pending = useRef(false);
  useEffect(() => {
    mounted.current = true;
    void Promise.resolve().then(() => { if (mounted.current) setReady(true); });
    return () => { mounted.current = false; };
  }, []);
  async function signOut() {
    if (!ready || !mounted.current || pending.current) return;
    pending.current = true;
    setBusy(true); setError("");
    try {
      const result = await authClient.signOut();
      if (!mounted.current) return;
      if (result.error) { setError(failureMessage); return; }
      router.push("/ingresar");
    } catch { if (mounted.current) setError(failureMessage); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  return <><button type="button" className="sign-out" disabled={!ready || busy} onClick={signOut}>{busy ? "Cerrando sesión…" : "Cerrar sesión"}</button>{error && <p className="form-error fixed bottom-4 right-4 z-[100] max-w-[calc(100vw-32px)] rounded-xl border border-[#f0d2cc] bg-white p-4 shadow-lg" role="alert">{error}</p>}</>;
}
