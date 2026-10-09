import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { env } from "@/lib/runtime/env";
import { getSchoolPageActor } from "@/lib/supabase/page-actor";
import { createSchoolDatabaseClient } from "@/lib/supabase/database";
import { readSchoolAudit } from "@/lib/supabase/operations";
import { getDb } from "@/db";
import { auditLog, user } from "@/db/schema";
import { hasRole } from "@/lib/access";
import { PortalShell } from "@/components/portal-shell";

export const dynamic = "force-dynamic";

export default async function Auditoria() {
  const actor = await getSchoolPageActor(await headers());
  if (!actor) redirect("/ingresar");
  if (!hasRole(actor, "superadmin", "direccion")) redirect("/");
  let records: { id: string; actorName: string | null; action: string; entityType: string; entityId: string; createdAt: Date }[];
  let loadFailed = false;
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) redirect("/ingresar");
    try {
      records = (await readSchoolAudit(createSchoolDatabaseClient(env), actor.supabaseAuth.accessToken))
        .map(row => ({ ...row, createdAt: new Date(row.createdAt) }));
    } catch { records = []; loadFailed = true; }
  } else {
    records = await getDb().select({
      id: auditLog.id, actorName: user.name, action: auditLog.action,
      entityType: auditLog.entityType, entityId: auditLog.entityId, createdAt: auditLog.createdAt,
    }).from(auditLog).leftJoin(user, eq(user.id, auditLog.actorId)).orderBy(desc(auditLog.createdAt)).limit(100);
  }
  const labels: Record<string, string> = {
    bootstrap: "Configuración inicial", create: "Creación", assign_teacher: "Asignación de docente",
    publish: "Publicación", submit: "Entrega recibida", review: "Revisión de actividad",
    attendance: "Registro de asistencia", record_attendance: "Registro de asistencia", correct_attendance: "Corrección de asistencia",
    submit_attendance_justification: "Justificación enviada", approve_attendance_justification: "Justificación aceptada", reject_attendance_justification: "Justificación rechazada",
    export_attendance_csv: "Exportación de asistencia CSV", export_attendance_xlsx: "Exportación de asistencia Excel", export_attendance_pdf: "Exportación de asistencia PDF",
    record_observation: "Seguimiento registrado", complete_activity: "Avance de actividad guardado", update: "Actualización", deactivate: "Baja de registro", reactivate: "Reactivación de registro",
    change_role: "Cambio de permisos", invite: "Invitación de cuenta", publish_privacy_notice: "Publicación del aviso de privacidad", schedule_meet: "Programación de clase",
    send_message: "Mensaje enviado", upload: "Archivo cargado", link_guardian: "Vinculación de tutor",
    observation: "Seguimiento registrado", delete_material: "Recurso retirado",
    replace_material_file: "Archivo de recurso reemplazado",
    update_communication_hours: "Cambio de horario de comunicación",
    record_consent_evidence: "Registro de decisión documentada",
    submit_privacy_request: "Envió una solicitud de privacidad",
    update_privacy_request_status: "Actualizó una solicitud de privacidad",
  };

  return <PortalShell name={actor.name} role={actor.roles[0] ?? ""} active="/auditoria">
    <p className="eyebrow">SEGURIDAD Y SUPERVISIÓN</p>
    <h1>Registro de actividad</h1>
    <p className="page-intro">Acciones recientes de la plataforma. Se muestran hasta 100 registros; este historial no incluye el contenido de conversaciones ni nombres de alumnos.</p>
    <section className="portal-panel">
      <h2>Actividad reciente</h2>
      {loadFailed ? <p className="form-error" role="alert">No se pudo cargar la auditoría. Vuelve a intentar en unos minutos.</p> : records.length ? <div className="audit-table-wrap"><table className="audit-table"><thead><tr><th scope="col">Fecha y hora</th><th scope="col">Persona</th><th scope="col">Acción</th><th scope="col">Tipo de registro</th><th scope="col">Referencia</th></tr></thead><tbody>{records.map(record => <tr key={record.id}><td>{record.createdAt.toLocaleString("es-MX", { timeZone: "America/Mexico_City", dateStyle: "medium", timeStyle: "short" })}</td><td>{record.actorName ?? "Sistema"}</td><td>{labels[record.action] ?? record.action.replaceAll("_", " ")}</td><td>{record.entityType.replaceAll("_", " ")}</td><td><code>{record.entityId}</code></td></tr>)}</tbody></table></div> : <p className="empty-state">Todavía no hay acciones registradas.</p>}
    </section>
  </PortalShell>;
}
