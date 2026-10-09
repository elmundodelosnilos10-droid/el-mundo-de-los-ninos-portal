import type { createSchoolDatabaseClient, SelectOptions } from "./database";

type SchoolClient = ReturnType<typeof createSchoolDatabaseClient>;
export type FamilyConsentRecord = {
  studentId: string; studentName: string; studentFamilyName: string;
  purpose: string | null; granted: boolean | null; recordedAt: Date | null;
  expiresAt: Date | null; noticeVersion: string | null;
};

async function readAll<T extends Record<string, unknown>>(client: SchoolClient, jwt: string, table: string, options: SelectOptions) {
  const rows: T[] = [];
  for (let offset = 0; offset < 100_000; offset += 500) {
    const page = await client.select<T>(jwt, table, { ...options, limit: 500, offset });
    rows.push(...page.data);
    if (page.data.length < 500) return rows;
  }
  throw new Error("Family consent history exceeds the supported read limit");
}

function date(value: string | null) {
  if (value === null) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new Error("Invalid consent timestamp");
  return parsed;
}

/** A tutor sees only their own records for active linked children, including children with no consent yet. */
export async function readFamilyConsents(client: SchoolClient, jwt: string, actorId: string): Promise<FamilyConsentRecord[]> {
  const guardianRows = await client.select<{ id: string; user_id: string; active: boolean }>(jwt, "guardians", {
    columns: ["id", "user_id", "active"],
    filters: [{ column: "user_id", operator: "eq", value: actorId }, { column: "active", operator: "eq", value: true }], limit: 1,
  });
  const guardian = guardianRows.data[0];
  if (!guardian || guardian.user_id !== actorId || guardian.active !== true) return [];
  const links = await readAll<{ student_id: string; guardian_id: string; active: boolean }>(client, jwt, "student_guardians", {
    columns: ["student_id", "guardian_id", "active"],
    filters: [{ column: "guardian_id", operator: "eq", value: guardian.id }, { column: "active", operator: "eq", value: true }],
    orderBy: [{ column: "student_id" }],
  });
  const studentIds = [...new Set(links.filter(link => link.guardian_id === guardian.id && link.active).map(link => link.student_id))];
  const records: FamilyConsentRecord[] = [];
  for (let offset = 0; offset < studentIds.length; offset += 100) {
    const selected = studentIds.slice(offset, offset + 100);
    const students = await client.select<{ id: string; given_name: string; family_name: string; active: boolean }>(jwt, "students", {
      columns: ["id", "given_name", "family_name", "active"],
      filters: [{ column: "id", operator: "in", value: selected }, { column: "active", operator: "eq", value: true }],
      orderBy: [{ column: "id" }], limit: 100,
    });
    const children = students.data.filter(child => child.active && selected.includes(child.id));
    if (!children.length) continue;
    const childIds = children.map(child => child.id);
    const consentRows = await readAll<{
      id: string; student_id: string; guardian_id: string; purpose: string; granted: boolean;
      recorded_at: string; expires_at: string | null; notice_version: string | null;
    }>(client, jwt, "consents", {
      columns: ["id", "student_id", "guardian_id", "purpose", "granted", "recorded_at", "expires_at", "notice_version"],
      filters: [{ column: "guardian_id", operator: "eq", value: guardian.id }, { column: "student_id", operator: "in", value: childIds }],
      orderBy: [{ column: "recorded_at", ascending: false }, { column: "id", ascending: false }],
    });
    const latest = new Map<string, (typeof consentRows)[number]>();
    for (const consent of consentRows) {
      if (consent.guardian_id !== guardian.id || !childIds.includes(consent.student_id)) continue;
      const key = `${consent.student_id}:${consent.purpose}`;
      if (!latest.has(key)) latest.set(key, consent);
    }
    for (const child of children) {
      const ownRecords = [...latest.values()].filter(consent => consent.student_id === child.id);
      const childFields = { studentId: child.id, studentName: child.given_name, studentFamilyName: child.family_name };
      if (!ownRecords.length) records.push({ ...childFields, purpose: null, granted: null, recordedAt: null, expiresAt: null, noticeVersion: null });
      else for (const consent of ownRecords) records.push({
        ...childFields, purpose: consent.purpose, granted: consent.granted,
        recordedAt: date(consent.recorded_at), expiresAt: date(consent.expires_at), noticeVersion: consent.notice_version,
      });
    }
  }
  return records;
}
