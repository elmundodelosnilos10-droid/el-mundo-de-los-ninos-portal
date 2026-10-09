import type { createSupabaseDatabaseClient } from "./database";

type SchoolDatabaseClient = ReturnType<typeof createSupabaseDatabaseClient>;

type StudentGuardianLink = {
  guardian_id: string;
  relationship: string;
  active: boolean;
  may_collect: boolean;
};

/** Resolve one student's guardian links through the caller's RLS-scoped JWT. */
export async function readStudentGuardians(client: SchoolDatabaseClient, jwt: string, studentId: string) {
  const links = await client.select<StudentGuardianLink>(jwt, "student_guardians", {
    columns: ["guardian_id", "relationship", "active", "may_collect"],
    filters: [{ column: "student_id", operator: "eq", value: studentId }],
    orderBy: [{ column: "guardian_id" }],
    limit: 500,
  });
  if (!links.data.length) return [];

  const guardianIds = [...new Set(links.data.map(link => link.guardian_id))];
  const guardians: Array<{ id: string; user_id: string }> = [];
  for (let offset = 0; offset < guardianIds.length; offset += 100) {
    const batch = guardianIds.slice(offset, offset + 100);
    const result = await client.select<{ id: string; user_id: string }>(jwt, "guardians", {
      columns: ["id", "user_id"],
      filters: [{ column: "id", operator: "in", value: batch }],
      limit: 100,
    });
    guardians.push(...result.data);
  }

  const userIds = [...new Set(guardians.map(guardian => guardian.user_id))];
  const profiles: Array<{ id: string; name: string }> = [];
  for (let offset = 0; offset < userIds.length; offset += 100) {
    const batch = userIds.slice(offset, offset + 100);
    const result = await client.select<{ id: string; name: string }>(jwt, "profiles", {
      columns: ["id", "name"],
      filters: [{ column: "id", operator: "in", value: batch }],
      limit: 100,
    });
    profiles.push(...result.data);
  }

  const guardianById = new Map(guardians.map(guardian => [guardian.id, guardian]));
  const nameByUserId = new Map(profiles.map(profile => [profile.id, profile.name]));
  return links.data.flatMap(link => {
    const guardian = guardianById.get(link.guardian_id);
    const name = guardian ? nameByUserId.get(guardian.user_id) : undefined;
    return guardian && name
      ? [{ id: guardian.id, name, relationship: link.relationship, active: link.active, mayCollect: link.may_collect }]
      : [];
  });
}
