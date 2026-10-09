import { env } from "@/lib/runtime/env";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSchoolPageActor } from "@/lib/supabase/page-actor";
import { createSchoolDatabaseClient } from "@/lib/supabase/database";
import { describeSchoolServiceConfiguration, readSchoolDatabaseStatus, type SchoolDatabaseStatus } from "@/lib/supabase/operations";
import { getDb } from "@/db";
import { auditLog } from "@/db/schema";
import { hasRole } from "@/lib/access";
import { isRecoveryEmailConfigured } from "@/lib/recovery-email";
import { isFileScannerConfigured } from "@/lib/file-scanner";
import { PortalShell } from "@/components/portal-shell";
import { PrivacyNoticeForm } from "./privacy-notice-form";
import { MigrationPreflightPanel } from "./migration-preflight-panel";

export const dynamic = "force-dynamic";

export default async function EstadoDelSistema() {
  const actor = await getSchoolPageActor(await headers());
  if (!actor) redirect("/ingresar");
  if (!hasRole(actor, "superadmin")) redirect("/");
  const supabaseData = env.SCHOOL_DATA_PROVIDER === "supabase";
  if (supabaseData && !actor.supabaseAuth) redirect("/ingresar");
  let databaseStatus: SchoolDatabaseStatus | null = null;
  let databaseFailed = false;
  try {
    if (supabaseData) {
      databaseStatus = await readSchoolDatabaseStatus(createSchoolDatabaseClient(env), actor.supabaseAuth!.accessToken);
    } else {
      await getDb().select({ id: auditLog.id }).from(auditLog).limit(1);
    }
  } catch { databaseFailed = true; }
  const gmailFields = [env.GMAIL_CLIENT_ID, env.GMAIL_CLIENT_SECRET, env.GMAIL_REFRESH_TOKEN, env.GMAIL_SENDER_EMAIL];
  const gmailPartial = gmailFields.some(value => Boolean(value?.trim()));
  const recoveryConfigured = isRecoveryEmailConfigured(env);
  const supabaseRecovery = env.SCHOOL_AUTH_PROVIDER === "supabase";
  const resendConfigured = Boolean(env.RESEND_API_KEY?.trim() && env.EMAIL_FROM?.trim());
  const fileScannerConfigured = isFileScannerConfigured({ url: env.SCHOOL_FILE_SCAN_URL, token: env.SCHOOL_FILE_SCAN_TOKEN });

  const configuration = describeSchoolServiceConfiguration(env, { recoveryConfigured, scannerConfigured: fileScannerConfigured });

  return <PortalShell name={actor.name} role="superadmin" active="/sistema">
    <p className="eyebrow">SUPERADMINISTRACIÓN</p>
    <h1>Estado del sistema</h1>
    <p className="page-intro">Configuración y verificaciones operativas. Esta pantalla muestra si hay ajustes presentes; no revela claves ni sustituye una prueba real de cada servicio.</p>

    <div className="management-grid system-status-grid">
      <section className="portal-panel system-status-card">
        <h2>Base de datos escolar</h2>
        <p><strong>Proveedor:</strong> {supabaseData ? "Supabase PostgreSQL" : "Cloudflare D1"}</p>
        {databaseFailed ? <p className="form-error" role="alert">No se pudo verificar la base de datos escolar. Los datos no se muestran hasta completar la consulta.</p> : <>
          <p><strong>Estado:</strong> consulta autorizada completada.</p>
          {databaseStatus && <><p><strong>Última verificación:</strong> {new Date(databaseStatus.checkedAt).toLocaleString("es-MX", { timeZone: "America/Mexico_City" })}</p>
            <p><strong>Cuentas activas:</strong> {databaseStatus.activeAccounts}</p><p><strong>Grupos activos:</strong> {databaseStatus.activeGroups}</p><p><strong>Registros de auditoría:</strong> {databaseStatus.auditRecords}</p></>}
        </>}
        <p className="system-status-note">Esta consulta verifica la lectura con los permisos actuales. El correo, el almacenamiento y los respaldos requieren sus propias pruebas.</p>
      </section>

      <section className="portal-panel system-status-card">
        <h2>Recuperación de cuentas</h2>
        <p><strong>Correo de acceso de Dirección:</strong> {actor.email}</p>
        <p><strong>Estado:</strong> {recoveryConfigured ? (supabaseRecovery ? "Configuración de Supabase Auth presente; entrega del correo sin verificar." : "Configuración presente; entrega del correo sin verificar.") : "Pendiente de configuración."}</p>
        {!supabaseRecovery && <p><strong>Remitente Gmail:</strong> {env.GMAIL_SENDER_EMAIL?.trim() || "Sin definir"}</p>}
        <p className="system-status-note">El correo de acceso identifica la cuenta escolar. El remitente sirve para enviar mensajes y no habilita el acceso por sí solo.</p>
        {supabaseRecovery && recoveryConfigured && <p className="system-status-note">Las solicitudes se procesan con Supabase Auth. La entrega y el retorno del enlace requieren una prueba de recuperación.</p>}
        {!supabaseRecovery && !recoveryConfigured && gmailPartial && <p className="system-status-note">Gmail está seleccionado, pero faltan credenciales OAuth. Completa la configuración privada del remitente en el servidor.</p>}
        {!supabaseRecovery && !recoveryConfigured && !gmailPartial && !resendConfigured && <p className="system-status-note">La pantalla de recuperación permanece cerrada hasta completar y probar Gmail API o Resend.</p>}
        {recoveryConfigured && !supabaseRecovery && <p className="system-status-note">La pantalla pública permite solicitar el enlace; prueba su entrega y expiración antes de abrir el acceso a familias.</p>}
      </section>

      <section className="portal-panel system-status-card">
        <h2>Revisión de archivos</h2>
        <p><strong>Escáner:</strong> {fileScannerConfigured ? "Configuración presente; falta confirmar una prueba con archivos de prueba." : "Sin configurar; las cargas se rechazan por seguridad."}</p>
        <p className="system-status-note">La conexión usa HTTPS y envía únicamente el archivo saneado y su tipo. La URL del servicio y el token se guardan en configuración privada del servidor; nunca se incluyen nombres ni datos del alumno.</p>
      </section>

      <section className="portal-panel system-status-card">
        <h2>Almacenamiento de archivos</h2>
        <p><strong>Proveedor:</strong> {configuration.storageProvider === "supabase" ? "Supabase Storage" : "Cloudflare R2"}</p>
        <p><strong>Estado:</strong> {configuration.storageConfigured ? "Configuración presente; carga y descarga sin verificar en esta consulta." : "Pendiente de configuración."}</p>
        <p className="system-status-note">Los recursos escolares son privados y cada solicitud requiere una cuenta autorizada.</p>
      </section>

      <section className="portal-panel system-status-card">
        <h2>Clases virtuales</h2>
        <p><strong>Google Meet:</strong> uso manual. El personal crea la reunión y el portal restringe la visibilidad del enlace al grupo autorizado.</p>
        <p className="system-status-note">La creación automática de reuniones requiere integrar y autorizar Google Workspace. La escuela aún no ha configurado esa integración.</p>
      </section>

      <section className="portal-panel system-status-card">
        <h2>Grabaciones</h2>
        <p><strong>Estado:</strong> desactivadas.</p>
        <p className="system-status-note">Mantenerlas desactivadas hasta aprobar consentimiento, acceso, conservación y eliminación.</p>
      </section>

      <section className="portal-panel system-status-card">
        <h2>Respaldos y recuperación</h2>
        <p><strong>Herramienta:</strong> {supabaseData ? "hay un procedimiento local para exportar PostgreSQL y los archivos privados de Supabase en un paquete cifrado." : "hay un procedimiento local para exportar D1 y copiar R2 en un paquete cifrado."}</p>
        <p className="system-status-note">Esta pantalla no comprueba la existencia de una copia reciente ni una restauración. El estado operativo del respaldo permanece sin verificar.</p>
      </section>

      <section className="portal-panel system-status-card">
        <h2>Privacidad y acceso escolar</h2>
        <p><strong>Antes de operar:</strong> la escuela debe aprobar su aviso de privacidad, responsable, retención y procesos de consentimiento.</p>
        <p className="system-status-note">La página de inicio de sesión es pública; los datos y las funciones escolares requieren una cuenta autorizada. No registres expedientes reales hasta completar las revisiones y pruebas de lanzamiento.</p>
      </section>
    </div>
    {!supabaseData && <MigrationPreflightPanel />}
    <PrivacyNoticeForm />
  </PortalShell>;
}
