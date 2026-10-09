"use client";

import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";

export function SignOutButton() {
  const router = useRouter();
  return <button type="button" className="sign-out" onClick={async () => { await authClient.signOut(); router.push("/ingresar"); }}>Cerrar sesión</button>;
}
