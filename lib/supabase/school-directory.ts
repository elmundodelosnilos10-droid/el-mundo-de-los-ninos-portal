import type { createSupabaseDatabaseClient } from "./database";

type SchoolDirectoryClient = ReturnType<typeof createSupabaseDatabaseClient>;
export type SchoolPersonTable = "teachers" | "guardians";

/** Read the active school-facing directory with profiles constrained by RLS. */
export async function readSchoolDirectory(client: SchoolDirectoryClient, jwt: string, table: SchoolPersonTable) {
  const linkedPeople = await client.select<{ id: string; user_id: string }>(jwt, table, {
    columns: ["id", "user_id"],
    filters: [{ column: "active", operator: "eq", value: true }],
    orderBy: [{ column: "id" }],
    limit: 500,
  });
  const userIds = linkedPeople.data.map(person => person.user_id);
  if (!userIds.length) return [];

  const profiles = await client.select<{ id: string; name: string; email: string }>(jwt, "profiles", {
    columns: ["id", "name", "email"],
    filters: [{ column: "id", operator: "in", value: userIds }],
    limit: 500,
  });
  const profileById = new Map(profiles.data.map(profile => [profile.id, profile]));
  return linkedPeople.data.flatMap(person => {
    const profile = profileById.get(person.user_id);
    return profile ? [{ id: person.id, name: profile.name, email: profile.email }] : [];
  });
}
