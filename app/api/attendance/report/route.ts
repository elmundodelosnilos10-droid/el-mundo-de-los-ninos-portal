import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { attendance, auditLog, groups, students } from "@/db/schema";
import { actorFromRequest, errorResponse, hasRole, mayTeachGroup } from "@/lib/access";
import { buildAttendancePdf, buildAttendanceXlsx } from "@/lib/attendance-export";
import { isSameOriginAuthRequest } from "@/lib/supabase/auth-route-utils";
import { env } from "@/lib/runtime/env";
import { createSchoolDatabaseClient, SupabaseDatabaseError } from "@/lib/supabase/database";

const input = z.object({ groupId: z.union([z.uuid(), z.literal("todos")]), from: z.iso.date(), to: z.iso.date(), format: z.enum(["csv", "xlsx", "pdf"]).default("csv") })
  .refine(value => value.from <= value.to, { message: "El inicio debe ser anterior al fin." });

function csvCell(value: string) {
  const protectedValue = /^[\u0000-\u0020]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${protectedValue.replaceAll('"', '""')}"`;
}

export async function POST(request: Request) {
  if (!isSameOriginAuthRequest(request)) return errorResponse(403, "Solicitud no válida.");
  const actor = await actorFromRequest(request);
  if (!actor) return errorResponse(401, "Inicia sesión.");
  if (!hasRole(actor, "superadmin", "direccion", "docente")) return errorResponse(403, "Solo el personal autorizado puede descargar reportes.");
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, "Revisa el grupo y las fechas del reporte.");
  const { groupId, from, to, format } = parsed.data;
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (days > 366) return errorResponse(400, "El periodo máximo del reporte es de 366 días.");
  if (groupId === "todos" && !hasRole(actor, "superadmin", "direccion")) return errorResponse(403, "Solo dirección puede exportar todos los grupos.");
  let records: { date: string; groupName: string; givenName: string; familyName: string; status: string; note: string | null }[];
  let selectedGroup: { name: string } | undefined;
  if (env.SCHOOL_DATA_PROVIDER === "supabase") {
    if (!actor.supabaseAuth) return errorResponse(503, "La sesión no está vinculada con Supabase. Vuelve a iniciar sesión.");
    try {
      const result = await createSchoolDatabaseClient(env).rpc<{ items: typeof records; groupName: string }>(actor.supabaseAuth.accessToken, "school_attendance_report", {
        p_group_id: groupId === "todos" ? null : groupId, p_from: from, p_to: to, p_format: format,
      });
      const payload = result.data[0];
      if (!payload || !Array.isArray(payload.items) || typeof payload.groupName !== "string") return errorResponse(503, "No se pudo preparar el reporte de asistencia.");
      records = payload.items;
      selectedGroup = { name: payload.groupName };
    } catch (cause) {
      if (cause instanceof SupabaseDatabaseError && cause.status === 400) return errorResponse(400, "El reporte supera 10,000 registros o el periodo no es válido.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 403) return errorResponse(403, "No tienes permiso para descargar este reporte.");
      if (cause instanceof SupabaseDatabaseError && cause.status === 404) return errorResponse(404, "Grupo no disponible.");
      return errorResponse(503, "No se pudo preparar el reporte de asistencia.");
    }
  } else {
    const db = getDb();
    if (groupId !== "todos" && !(await mayTeachGroup(actor, groupId))) return errorResponse(404, "Grupo no disponible.");
    const allowedGroupIds = groupId === "todos"
      ? (await db.select({ id: groups.id }).from(groups)).map(group => group.id)
      : [groupId];
    if (!allowedGroupIds.length) return errorResponse(404, "No hay grupos disponibles para el reporte.");
    [selectedGroup] = groupId === "todos" ? [{ name: "Todos los grupos" }] : await db.select({ name: groups.name }).from(groups).where(and(eq(groups.id, groupId), eq(groups.active, true))).limit(1);
    if (!selectedGroup) return errorResponse(404, "Grupo no disponible.");
    records = await db.select({ date: attendance.onDate, groupName: groups.name, givenName: students.givenName, familyName: students.familyName, status: attendance.status, note: attendance.note })
      .from(attendance)
      .innerJoin(students, eq(students.id, attendance.studentId))
      .innerJoin(groups, eq(groups.id, attendance.groupId))
      .where(and(inArray(attendance.groupId, allowedGroupIds), gte(attendance.onDate, from), lte(attendance.onDate, to)))
      .orderBy(asc(attendance.onDate), asc(groups.name), asc(students.familyName), asc(students.givenName)).limit(10_001);
  }
  if (records.length > 10_000) return errorResponse(400, "El reporte supera 10,000 registros. Reduce el periodo para descargarlo.");
  if (!selectedGroup) return errorResponse(404, "Grupo no disponible.");

  const rows = [["Fecha", "Grupo", "Alumno", "Estado", "Observación"], ...records.map(record => [record.date, record.groupName, `${record.givenName} ${record.familyName}`, record.status, record.note ?? ""])];
  const csv = `\uFEFF${rows.map(row => row.map(csvCell).join(",")).join("\r\n")}`;
  if (env.SCHOOL_DATA_PROVIDER !== "supabase") await getDb().insert(auditLog).values({ id: crypto.randomUUID(), actorId: actor.id, action: `export_attendance_${format}`, entityType: groupId === "todos" ? "school" : "group", entityId: groupId, createdAt: new Date() });
  const body = format === "xlsx" ? buildAttendanceXlsx(rows) : format === "pdf" ? buildAttendancePdf(selectedGroup.name, from, to, rows) : csv;
  const contentType = format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : format === "pdf" ? "application/pdf" : "text/csv; charset=utf-8";
  return new Response(body, { headers: {
    "Cache-Control": "no-store",
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="asistencia-${from}-${to}.${format}"`,
  } });
}
