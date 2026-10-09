import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
const schemaSql = await readFile(new URL("../supabase/migrations/20261008000000_school_schema.sql", import.meta.url), "utf8");
const storageSql = await readFile(new URL("../supabase/migrations/20261008000001_private_storage.sql", import.meta.url), "utf8");
const authHardeningSql = await readFile(new URL("../supabase/migrations/20261009000000_harden_invite_only_auth.sql", import.meta.url), "utf8");
const schoolRpcsSql = await readFile(new URL("../supabase/migrations/20261010000000_school_year_group_rpcs.sql", import.meta.url), "utf8");
const studentRpcsSql = await readFile(new URL("../supabase/migrations/20261010000001_school_student_rpcs.sql", import.meta.url), "utf8");
const supabaseConfig = await readFile(new URL("../supabase/config.toml", import.meta.url), "utf8");
const sourceTables = [...source.matchAll(/export const \w+ = sqliteTable\("([^"]+)"/g)].map((match) => match[1]);
const sourceUserBlock = source.match(/export const user = sqliteTable\("user", \{([\s\S]*?)\n\}\);/)?.[1] ?? "";
const sourceUserColumns = [...sourceUserBlock.matchAll(/^\s*\w+:\s*\w+\("([^"]+)"/gm)].map((match) => match[1]).sort();
const postgresTables = [...schemaSql.matchAll(/create table public\.(\w+)/g)].map((match) => match[1]);
const profilesBlock = schemaSql.match(/create table public\.profiles\s*\(([\s\S]*?)\n\);/i)?.[1] ?? "";
const profileColumns = [...profilesBlock.matchAll(/^\s*(\w+)\s+/gm)].map((match) => match[1]).sort();
const rlsBlock = schemaSql.match(/foreach table_name in array array\[([\s\S]*?)\]\s+loop/);
const rlsTables = [...(rlsBlock?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
const authAndSetupTables = new Set(["user", "session", "account", "verification", "rateLimit", "setup_state"]);

test("la migración traduce todas las tablas escolares del esquema actual", () => {
  const expected = [...sourceTables.filter((name) => !authAndSetupTables.has(name)), "profiles"].sort();
  assert.deepEqual([...postgresTables].sort(), expected);
});

test("cada tabla creada tiene RLS activado y no se agrega acceso público", () => {
  assert.deepEqual([...new Set(rlsTables)].sort(), [...postgresTables].sort());
  assert.match(schemaSql, /enable row level security/);
  assert.doesNotMatch(schemaSql, /create\s+policy\b/i, "no hay políticas directas para clientes hasta definir autorización por rol y grupo");
});

test("perfiles quedan vinculados a Supabase Auth y roles mantienen la lista escolar", () => {
  assert.match(schemaSql, /id uuid primary key references auth\.users\(id\) on delete cascade/i);
  assert.deepEqual(profileColumns, sourceUserColumns, "profiles debe reflejar todas las columnas de user");
  assert.match(schemaSql, /create trigger sync_profile_after_auth_user_change\s+after insert or update on auth\.users/i);
  assert.match(schemaSql, /create function public\.sync_profile_from_auth_user\(\)[\s\S]*?security definer[\s\S]*?set search_path = ''/i);
  assert.match(schemaSql, /revoke all on function public\.sync_profile_from_auth_user\(\) from public, anon, authenticated/i);
  assert.match(schemaSql, /from auth\.users\s+where email is not null\s+on conflict \(id\) do nothing/i);
  assert.match(schemaSql, /role in \('superadmin', 'direccion', 'docente', 'tutor', 'alumno'\)/i);
});

test("el almacenamiento escolar se declara privado con límite de 25 MiB", () => {
  assert.match(storageSql, /values \('school-files', 'school-files', false, 26214400\)/i);
  assert.doesNotMatch(storageSql, /public\s*=\s*true/i);
});

test("el acceso nuevo requiere invitación y no activa perfiles sin rol escolar", () => {
  assert.match(supabaseConfig, /\[auth\][\s\S]*?enable_signup = false/i);
  assert.match(supabaseConfig, /\[auth\.email\][\s\S]*?enable_signup = false/i);
  assert.match(authHardeningSql, /alter column active set default false/i);
  assert.match(authHardeningSql, /sync_profile_from_auth_user\(\)[\s\S]*?\n\s*false,/i);
  assert.match(authHardeningSql, /where not exists \([\s\S]*?public\.user_roles/i);
});

test("las operaciones escolares iniciales validan rol, registran auditoría y limitan EXECUTE", () => {
  for (const name of ["school_create_year", "school_create_group", "school_assign_teacher_to_group"]) {
    const definition = schoolRpcsSql.match(new RegExp(`create function public\\.${name}\\([\\s\\S]*?\\$\\$;`, "i"))?.[0] ?? "";
    assert.match(definition, /security definer[\s\S]*?set search_path = ''/i, `${name} debe ser segura ante search_path`);
    assert.match(definition, /auth\.uid\(\)/i, `${name} debe derivar el actor del JWT`);
    assert.match(definition, /school_is_leader\(\)/i, `${name} debe exigir dirección o superadministración`);
  }
  assert.equal((schoolRpcsSql.match(/insert into public\.audit_log/gi) ?? []).length, 3);
  assert.match(schoolRpcsSql, /revoke all on function public\.school_create_year\([^;]*from public, anon/i);
  assert.match(schoolRpcsSql, /grant execute on function public\.school_create_year\([^;]*to authenticated/i);
  assert.match(schoolRpcsSql, /on conflict \(teacher_id, group_id\) do nothing/i);
});

test("el directorio y el alta de alumnos en Supabase restringen roles y mantienen auditoría atómica", () => {
  for (const name of ["school_list_students", "school_create_student"]) {
    const definition = studentRpcsSql.match(new RegExp(`create function public\\.${name}\\([\\s\\S]*?\\$\\$;`, "i"))?.[0] ?? "";
    assert.match(definition, /security definer[\s\S]*?set search_path = ''/i);
    assert.match(definition, /auth\.uid\(\)/i);
    assert.match(definition, /school_is_leader\(\)/i);
  }
  assert.match(studentRpcsSql, /insert into public\.enrollments[\s\S]*?insert into public\.audit_log/i);
  assert.match(studentRpcsSql, /revoke all on function public\.school_create_student\([^;]*from public, anon/i);
  assert.match(studentRpcsSql, /grant execute on function public\.school_create_student\([^;]*to authenticated/i);
  assert.match(studentRpcsSql, /p_offset not between 0 and 100000/i);
});
