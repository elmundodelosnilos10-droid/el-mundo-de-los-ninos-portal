import type { createSchoolDatabaseClient, PostgrestFilter } from "./database";

export const OBSERVATION_PAGE_SIZE = 25;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type Observation = { id: string; category: string; body: string; visibleToFamily: boolean; recordedAt: string };
export type ObservationCursor = { studentId: string; recordedAt: string; id: string };
export type ObservationPage = { items: Observation[]; nextCursor: string | null; hasMore: boolean };

export function isObservationUuid(value: unknown): value is string { return typeof value === "string" && UUID.test(value); }

/** Postgres microseconds survive normalization; Date alone would discard them. */
export function observationTimestamp(value: unknown): string {
  if (typeof value !== "string") throw Error("invalid_observation_timestamp");
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/);
  if (!match) throw Error("invalid_observation_timestamp");
  const [, y, m, d, h, min, sec, fraction = "", zone] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > days[month - 1] || Number(h) > 23 || Number(min) > 59 || Number(sec) > 59 ||
      (zone !== "Z" && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))) throw Error("invalid_observation_timestamp");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw Error("invalid_observation_timestamp");
  const iso = date.toISOString();
  if (!/^\d{4}-/.test(iso)) throw Error("invalid_observation_timestamp");
  return `${iso.slice(0, 19)}.${fraction.padEnd(6, "0")}Z`;
}

export function encodeObservationCursor(cursor: ObservationCursor): string {
  if (!isObservationUuid(cursor.studentId) || !isObservationUuid(cursor.id)) throw Error("invalid_observation_cursor");
  const json = JSON.stringify([1, cursor.studentId.toLowerCase(), observationTimestamp(cursor.recordedAt), cursor.id.toLowerCase()]);
  return btoa(json).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** A cursor is a position, never authorization. The route still checks the child. */
export function parseObservationCursor(value: string | null, studentId: string): ObservationCursor | null {
  if (value === null) return null;
  if (!isObservationUuid(studentId) || value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) throw Error("invalid_observation_cursor");
  try {
    const fields: unknown = JSON.parse(atob(value.replaceAll("-", "+").replaceAll("_", "/")));
    if (!Array.isArray(fields) || fields.length !== 4 || fields[0] !== 1 || fields[1] !== studentId.toLowerCase() || !isObservationUuid(fields[3])) throw Error();
    const cursor = { studentId: fields[1], recordedAt: observationTimestamp(fields[2]), id: fields[3].toLowerCase() };
    if (encodeObservationCursor(cursor) !== value) throw Error();
    return cursor;
  } catch { throw Error("invalid_observation_cursor"); }
}

export function makeObservationPage(studentId: string, selected: Observation[]): ObservationPage {
  if (!isObservationUuid(studentId) || selected.length > OBSERVATION_PAGE_SIZE + 1) throw Error("invalid_observation_page");
  const seen = new Set<string>();
  const rows = selected.map(row => {
    if (!isObservationUuid(row.id) || seen.has(row.id.toLowerCase()) || typeof row.category !== "string" || !row.category || typeof row.body !== "string" || row.body.length > 2000 || typeof row.visibleToFamily !== "boolean") throw Error("invalid_observation_page");
    seen.add(row.id.toLowerCase());
    return { id: row.id.toLowerCase(), category: row.category, body: row.body, visibleToFamily: row.visibleToFamily, recordedAt: observationTimestamp(row.recordedAt) };
  });
  for (let i = 1; i < rows.length; i++) {
    const before = rows[i - 1], after = rows[i];
    if (before.recordedAt < after.recordedAt || (before.recordedAt === after.recordedAt && before.id <= after.id)) throw Error("invalid_observation_order");
  }
  const hasMore = rows.length > OBSERVATION_PAGE_SIZE;
  const items = rows.slice(0, OBSERVATION_PAGE_SIZE), last = items.at(-1);
  return { items, hasMore, nextCursor: hasMore && last ? encodeObservationCursor({ studentId, recordedAt: last.recordedAt, id: last.id }) : null };
}

type Database = ReturnType<typeof createSchoolDatabaseClient>;
type ObservationRow = { id: string; category: string; body: string; visible_to_family: boolean; recorded_at: string };
export async function readSupabaseObservationPage(client: Database, jwt: string, studentId: string, cursor: ObservationCursor | null, staff: boolean): Promise<ObservationPage> {
  if (cursor && cursor.studentId !== studentId.toLowerCase()) throw Error("invalid_observation_cursor");
  const filters: PostgrestFilter[] = [{ column: "student_id", operator: "eq", value: studentId }];
  if (!staff) filters.push({ column: "visible_to_family", operator: "eq", value: true });
  const select = async (extra: PostgrestFilter[], limit: number) => (await client.select<ObservationRow>(jwt, "observations", {
    columns: ["id", "category", "body", "visible_to_family", "recorded_at"], filters: [...filters, ...extra],
    orderBy: [{ column: "recorded_at", ascending: false }, { column: "id", ascending: false }], limit,
  })).data;
  let rows: ObservationRow[];
  if (!cursor) rows = await select([], OBSERVATION_PAGE_SIZE + 1);
  else {
    rows = await select([{ column: "recorded_at", operator: "eq", value: cursor.recordedAt }, { column: "id", operator: "lt", value: cursor.id }], OBSERVATION_PAGE_SIZE + 1);
    if (rows.length < OBSERVATION_PAGE_SIZE + 1) rows.push(...await select([{ column: "recorded_at", operator: "lt", value: cursor.recordedAt }], OBSERVATION_PAGE_SIZE + 1 - rows.length));
  }
  return makeObservationPage(studentId, rows.map(row => ({ id: row.id, category: row.category, body: row.body, visibleToFamily: row.visible_to_family, recordedAt: row.recorded_at })));
}
