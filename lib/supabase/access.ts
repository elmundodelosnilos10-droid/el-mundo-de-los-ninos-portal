/** User-scoped authorization reads; PostgreSQL RLS remains authoritative. */
import type { createSchoolDatabaseClient } from "./database";

export type SupabaseAccessActor = {
  id: string;
  roles: readonly string[];
  supabaseAuth?: { userId: string; accessToken: string } | null;
};

type SchoolDatabaseClient = ReturnType<typeof createSchoolDatabaseClient>;
const PAGE_SIZE = 500;
const MAX_GROUPS = 100_000;

/** Injectable client keeps access checks independently verifiable with fixtures. */
export function createSupabaseSchoolAccess(client: SchoolDatabaseClient) {
  function token(actor: SupabaseAccessActor) {
    if (!actor.supabaseAuth || actor.supabaseAuth.userId !== actor.id) return null;
    return actor.supabaseAuth.accessToken;
  }
  function leader(actor: SupabaseAccessActor) {
    return actor.roles.some(role => role === "superadmin" || role === "direccion");
  }
  function canReadSchool(actor: SupabaseAccessActor) {
    return leader(actor) || actor.roles.some(role => role === "docente" || role === "tutor");
  }

  async function maySeeStudent(actor: SupabaseAccessActor, studentId: string) {
    const jwt = token(actor);
    if (!jwt || !canReadSchool(actor)) return false;
    try {
      const result = await client.select(jwt, "students", {
        columns: ["id", "active"],
        filters: [
          { column: "id", operator: "eq", value: studentId },
          ...(leader(actor) ? [] : [{ column: "active", operator: "eq" as const, value: true }]),
        ],
        limit: 1,
      });
      // students_read_authorized checks the current guardian or teacher relation.
      return result.data.some(row => row.id === studentId && (leader(actor) || row.active === true));
    } catch { return false; }
  }

  async function maySeeGroup(actor: SupabaseAccessActor, groupId: string) {
    const jwt = token(actor);
    if (!jwt || !canReadSchool(actor)) return false;
    try {
      const result = await client.select(jwt, "groups", {
        columns: ["id"], filters: [{ column: "id", operator: "eq", value: groupId }], limit: 1,
      });
      // groups_read_authorized limits visibility to existing school relations.
      return result.data.some(row => row.id === groupId);
    } catch { return false; }
  }

  async function mayTeachGroup(actor: SupabaseAccessActor, groupId: string) {
    const jwt = token(actor);
    if (!jwt) return false;
    if (leader(actor)) return maySeeGroup(actor, groupId);
    if (!actor.roles.includes("docente")) return false;
    try {
      const ownTeacher = await client.select(jwt, "teachers", {
        columns: ["id", "user_id", "active"],
        filters: [{ column: "user_id", operator: "eq", value: actor.id }, { column: "active", operator: "eq", value: true }],
        limit: 1,
      });
      const teacher = ownTeacher.data.find(row => typeof row.id === "string" && row.user_id === actor.id && row.active === true);
      if (!teacher || typeof teacher.id !== "string") return false;
      const assigned = await client.select(jwt, "teacher_groups", {
        columns: ["teacher_id", "group_id"],
        filters: [{ column: "teacher_id", operator: "eq", value: teacher.id }, { column: "group_id", operator: "eq", value: groupId }],
        limit: 1,
      });
      // A teacher may read another teacher's link in a shared group. Require
      // their own teacher id explicitly before permitting a teaching action.
      return assigned.data.some(row => row.teacher_id === teacher.id && row.group_id === groupId);
    } catch { return false; }
  }

  async function accessibleGroupIds(actor: SupabaseAccessActor): Promise<string[]> {
    const jwt = token(actor);
    if (!jwt || !canReadSchool(actor)) return [];
    const ids = new Set<string>();
    try {
      for (let offset = 0; offset < MAX_GROUPS; offset += PAGE_SIZE) {
        const result = await client.select(jwt, "groups", {
          columns: ["id", "active"], filters: [{ column: "active", operator: "eq", value: true }],
          orderBy: [{ column: "id" }], limit: PAGE_SIZE, offset, count: "exact",
        });
        if (result.count !== null && result.count > MAX_GROUPS) return [];
        for (const row of result.data) {
          if (typeof row.id !== "string" || row.active !== true) return [];
          ids.add(row.id);
        }
        if (result.data.length < PAGE_SIZE || result.count !== null && offset + result.data.length >= result.count) {
          return [...ids];
        }
      }
      // Never treat a truncated authorization list as a complete result.
      return [];
    } catch { return []; }
  }

  return { maySeeStudent, maySeeGroup, mayTeachGroup, accessibleGroupIds };
}
