import type { createSchoolDatabaseClient } from "./database";

export type DashboardData = {
  mode: "direccion" | "docente" | "tutor" | "alumno";
  counts: Record<string, number | string | null>;
  events: { id: string; title: string; startsAt: string }[];
  announcements: { id: string; title: string; important: boolean }[];
  children: { id: string; givenName: string; familyName: string; groupId: string | null; groupName: string | null }[];
  tasks: { id: string; title: string; dueAt: string | null }[];
  classes: { id: string; title: string; startsAt: string }[];
  timeZone: "America/Mexico_City";
};

export async function readSchoolDashboard(client: ReturnType<typeof createSchoolDatabaseClient>, jwt: string): Promise<DashboardData> {
  const result = await client.rpc(jwt, "school_dashboard", { p_version: 1 });
  const data = result.data[0];
  if (!data || !["direccion", "docente", "tutor", "alumno"].includes(String(data.mode)) ||
      data.timeZone !== "America/Mexico_City" || !data.counts || typeof data.counts !== "object" || Array.isArray(data.counts) ||
      ["events", "announcements", "children", "tasks", "classes"].some(key => !Array.isArray(data[key]))) {
    throw new Error("School dashboard unavailable");
  }
  return data as DashboardData;
}
