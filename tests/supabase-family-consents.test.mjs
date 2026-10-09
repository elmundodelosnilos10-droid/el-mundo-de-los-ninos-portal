import assert from "node:assert/strict";
import test from "node:test";
import { readFamilyConsents } from "../lib/supabase/family-consents.ts";

function fixture({ guardian = { id: "g-own", user_id: "actor-own", active: true }, consents = [], links, students } = {}) {
  const calls = [];
  const client = { select: async (jwt, table, options) => {
    assert.equal(jwt, "family-jwt");
    calls.push({ table, options });
    if (table === "guardians") {
      assert.ok(options.filters.some(filter => filter.column === "user_id" && filter.value === "actor-own"));
      return { data: guardian ? [guardian] : [] };
    }
    if (table === "student_guardians") {
      assert.ok(options.filters.some(filter => filter.column === "guardian_id" && filter.value === "g-own"));
      const rows = links ?? [{ student_id: "child-own", guardian_id: "g-own", active: true }, { student_id: "child-empty", guardian_id: "g-own", active: true }];
      return { data: rows.slice(options.offset, options.offset + options.limit) };
    }
    if (table === "students") return { data: students ?? [{ id: "child-own", given_name: "Ana", family_name: "Escolar", active: true }, { id: "child-empty", given_name: "Leo", family_name: "Escolar", active: true }] };
    if (table === "consents") {
      assert.ok(options.filters.some(filter => filter.column === "guardian_id" && filter.value === "g-own"));
      assert.deepEqual(options.orderBy, [{ column: "recorded_at", ascending: false }, { column: "id", ascending: false }]);
      return { data: consents.slice(options.offset, options.offset + options.limit) };
    }
    throw new Error(`Unexpected table ${table}`);
  } };
  return { client, calls };
}

function consent(overrides = {}) {
  return { id: "consent-new", student_id: "child-own", guardian_id: "g-own", purpose: "class_recording", granted: false, recorded_at: "2026-10-08T10:00:00Z", expires_at: null, notice_version: "v1", ...overrides };
}

test("family sees its latest decision and linked children with no consent, excluding another guardian's records", async () => {
  const { client } = fixture({ consents: [
    consent(), consent({ id: "consent-old", granted: true, recorded_at: "2026-10-01T10:00:00Z" }),
    consent({ id: "other-guardian", guardian_id: "g-other", purpose: "public_image", granted: true }),
    consent({ id: "other-child", student_id: "child-foreign", purpose: "public_image", granted: true }),
  ] });
  const records = await readFamilyConsents(client, "family-jwt", "actor-own");
  assert.equal(records.length, 2);
  assert.equal(records.find(row => row.studentId === "child-own").granted, false);
  assert.equal(records.find(row => row.studentId === "child-own").recordedAt.toISOString(), "2026-10-08T10:00:00.000Z");
  assert.equal(records.find(row => row.studentId === "child-empty").purpose, null);
  assert.ok(records.every(row => row.purpose !== "public_image"));
});

test("missing, inactive, or foreign guardian stops before child and consent reads", async () => {
  for (const guardian of [null, { id: "g-own", user_id: "actor-own", active: false }, { id: "g-own", user_id: "actor-other", active: true }]) {
    const { client, calls } = fixture({ guardian });
    assert.deepEqual(await readFamilyConsents(client, "family-jwt", "actor-own"), []);
    assert.equal(calls.length, 1);
  }
});

test("inactive links, inactive students and foreign children never reach the returned authorization list", async () => {
  const { client, calls } = fixture({
    links: [{ student_id: "child-own", guardian_id: "g-own", active: true }, { student_id: "child-inactive", guardian_id: "g-own", active: false }, { student_id: "child-foreign", guardian_id: "g-other", active: true }],
    students: [{ id: "child-own", given_name: "Ana", family_name: "Escolar", active: false }, { id: "child-foreign", given_name: "Ajeno", family_name: "Escolar", active: true }],
  });
  assert.deepEqual(await readFamilyConsents(client, "family-jwt", "actor-own"), []);
  assert.ok(calls.every(call => call.table !== "consents"));
});

test("consent history paginates beyond 500 while preserving the newest decision", async () => {
  const { client, calls } = fixture({ consents: Array.from({ length: 501 }, (_, index) => consent({ id: `consent-${index}`, granted: index !== 0 })) });
  const records = await readFamilyConsents(client, "family-jwt", "actor-own");
  assert.equal(records.find(row => row.studentId === "child-own").granted, false);
  assert.deepEqual(calls.filter(call => call.table === "consents").map(call => call.options.offset), [0, 500]);
});

test("upstream errors and malformed consent timestamps fail rather than presenting no records", async () => {
  await assert.rejects(readFamilyConsents({ select: async () => { throw new Error("offline"); } }, "family-jwt", "actor-own"));
  const { client } = fixture({ consents: [consent({ recorded_at: "invalid" })] });
  await assert.rejects(readFamilyConsents(client, "family-jwt", "actor-own"));
});
