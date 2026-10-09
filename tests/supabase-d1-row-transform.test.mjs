import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseSupabaseMigrationSchema, transformD1SchoolRows } from "../scripts/supabase-d1-row-transform.mjs";

const schemaSql = await readFile(new URL("../supabase/migrations/20261008000000_school_schema.sql", import.meta.url), "utf8");
const definitions = parseSupabaseMigrationSchema(schemaSql);
const adminUuid = "11111111-1111-4111-8111-111111111111";
const studentUuid = "22222222-2222-4222-8222-222222222222";
const groupUuid = "33333333-3333-4333-8333-333333333333";
const yearUuid = "44444444-4444-4444-8444-444444444444";

function emptySource() {
  return Object.fromEntries(definitions.filter(table => table.name !== "profiles").map(table => [table.name, []]));
}

function admin() {
  return { id: "better-auth-admin", name: "Dirección", email: "direccion@escuela.test", email_verified: 1, active: 1, image: null, created_at: 1_800_000_000, updated_at: 1_800_000_001 };
}

test("convierte identidad, fechas y booleanos y conserva IDs escolares", () => {
  const source = emptySource();
  source.user = [admin()];
  source.user_roles = [{ user_id: "better-auth-admin", role: "direccion", assigned_by: null, assigned_at: 1_800_000_000 }];
  source.school_years = [{ id: yearUuid, name: "2026-2027", starts_on: "2026-08-01", ends_on: "2027-07-31", active: 1 }];
  source.groups = [{ id: groupUuid, year_id: yearUuid, name: "Preescolar A", stage: "preescolar", active: 1 }];
  source.students = [{ id: studentUuid, given_name: "Nombre", family_name: "Prueba", birth_date: "2022-03-12", active: 1, created_at: 1_800_000_000, updated_at: 1_800_000_001 }];
  source.audit_log = [{ id: "55555555-5555-4555-8555-555555555555", actor_id: "better-auth-admin", action: "create_user", entity_type: "user", entity_id: "better-auth-admin", created_at: 1_800_000_000 }];

  const { rowsByTable } = transformD1SchoolRows(source, [{ id: adminUuid, email: "DIRECCION@ESCUELA.TEST" }], definitions);
  assert.equal(rowsByTable.profiles[0].id, adminUuid);
  assert.equal(rowsByTable.profiles[0].active, true);
  assert.equal(rowsByTable.profiles[0].created_at, "2027-01-15T08:00:00.000Z");
  assert.equal(rowsByTable.user_roles[0].user_id, adminUuid);
  assert.equal(rowsByTable.user_roles[0].assigned_at, "2027-01-15T08:00:00.000Z");
  assert.equal(rowsByTable.school_years[0].active, true);
  assert.equal(rowsByTable.groups[0].id, groupUuid);
  assert.equal(rowsByTable.groups[0].year_id, yearUuid);
  assert.equal(rowsByTable.students[0].id, studentUuid);
  assert.equal(rowsByTable.audit_log[0].actor_id, adminUuid);
  assert.equal(rowsByTable.audit_log[0].entity_id, adminUuid);
  assert.equal("user" in rowsByTable, false);
  assert.equal("session" in rowsByTable, false);
});

test("se detiene si no existe la identidad Auth correspondiente", () => {
  const source = emptySource();
  source.user = [admin()];
  assert.throws(() => transformD1SchoolRows(source, [], definitions), /falta una identidad Supabase/);
});

test("rechaza IDs escolares incompatibles con columnas UUID del destino", () => {
  const source = emptySource();
  source.user = [admin()];
  source.students = [{ id: "student-text-id", given_name: "Nombre", family_name: "Prueba", birth_date: null, active: 1, created_at: 1_800_000_000, updated_at: 1_800_000_001 }];
  assert.throws(() => transformD1SchoolRows(source, [{ id: adminUuid, email: "direccion@escuela.test" }], definitions), /UUID válido/);
});

test("detiene la conversión si una tabla de origen tiene columnas distintas", () => {
  const source = emptySource();
  source.user = [admin()];
  source.school_years = [{ id: yearUuid, name: "2026-2027" }];
  assert.throws(() => transformD1SchoolRows(source, [{ id: adminUuid, email: "direccion@escuela.test" }], definitions), /columnas de public.school_years no coinciden/);
});
