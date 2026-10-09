import { env } from "@/lib/runtime/env";
import Image from "next/image";
import Link from "next/link";
import { isRecoveryEmailConfigured } from "@/lib/recovery-email";
import { RecoveryForm } from "./recovery-form";

export const dynamic = "force-dynamic";

export default function Recuperar() {
  const recoveryEnabled = isRecoveryEmailConfigured(env);

  return <main className="auth-page">
    <section className="auth-card" aria-labelledby="recovery-title">
      <Image src="/logo-escuela.jpg" width={92} height={92} alt="Logotipo El Mundo de los Niños" className="auth-logo" priority />
      <p className="eyebrow">AYUDA DE ACCESO</p>
      <h1 id="recovery-title">Recuperar contraseña</h1>
      {recoveryEnabled
        ? <RecoveryForm />
        : <p role="status" className="recovery-unavailable">La recuperación por correo todavía no está habilitada. Contacta a Dirección para recuperar el acceso a tu cuenta.</p>}
      <p className="auth-help"><Link href="/ingresar">Volver a iniciar sesión</Link></p>
    </section>
  </main>;
}
