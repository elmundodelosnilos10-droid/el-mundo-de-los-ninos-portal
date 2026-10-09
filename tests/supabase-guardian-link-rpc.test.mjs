import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../supabase/migrations/20261011000000_guardian_link_rpc.sql", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/students/[id]/guardians/route.ts", import.meta.url), "utf8");

function functionBody(name) {
  const start = migration.indexOf(`create or replace function public.${name}(`);
  assert.notEqual(start, -1, `falta la función ${name}`);
  const end = migration.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `no termina la función ${name}`);
  return migration.slice(start, end + 5);
}

test("RPC de vinculación valida identidad, rol, tutor, alumno y grupo activos", () => {
  const body = functionBody("school_link_guardian");
  assert.match(body, /security definer/i);
  assert.match(body, /set search_path = ''/i);
  assert.match(body, /auth\.uid\(\)/i);
  assert.match(body, /p\.active\s*=\s*true/i);
  assert.match(body, /r\.role in \('direccion', 'superadmin'\)/i);
  assert.match(body, /g\.active\s*=\s*true/i);
  assert.match(body, /r\.role\s*=\s*'tutor'/i);
  assert.match(body, /s\.active\s*=\s*true/i);
  assert.match(body, /e\.ended_at is null/i);
  assert.match(body, /g\.active\s*=\s*true[\s\S]*?y\.active\s*=\s*true/i);
});

test("RPC vincula y registra auditoría atómicamente, con rechazo de duplicados y permisos acotados", () => {
  const body = functionBody("school_link_guardian");
  assert.match(body, /from public\.student_guardians sg[\s\S]*?raise exception[\s\S]*?errcode = '23505'/i);
  assert.match(body, /insert into public\.student_guardians/i);
  assert.match(body, /insert into public\.audit_log[\s\S]*?values \(pg_catalog\.gen_random_uuid\(\), v_actor, 'link_guardian'/i);
  assert.match(migration, /revoke all on function public\.school_link_guardian\(uuid, uuid, text, boolean\) from public, anon, authenticated;/i);
  assert.match(migration, /grant execute on function public\.school_link_guardian\(uuid, uuid, text, boolean\) to authenticated;/i);
});

test("RPC de desvinculación exige liderazgo y audita solo si eliminó la relación", () => {
  const body = functionBody("school_unlink_guardian");
  assert.match(body, /security definer/i);
  assert.match(body, /set search_path = ''/i);
  assert.match(body, /auth\.uid\(\)/i);
  assert.match(body, /r\.role in \('direccion', 'superadmin'\)/i);
  assert.match(body, /delete from public\.student_guardians/i);
  assert.match(body, /if v_deleted then[\s\S]*?insert into public\.audit_log[\s\S]*?'unlink_guardian'/i);
});

test("la ruta usa RPC con el JWT de Supabase solo cuando el proveedor está activado y conserva D1 por defecto", () => {
  assert.match(route, /if \(env\.SCHOOL_DATA_PROVIDER === "supabase"\)/);
  assert.match(route, /import \{ isSameOriginAuthRequest \} from "@\/lib\/supabase\/auth-route-utils"/);
  assert.match(route, /actor\.supabaseAuth\.accessToken, "school_link_guardian"/);
  assert.match(route, /actor\.supabaseAuth\.accessToken, "school_unlink_guardian"/);
  assert.match(route, /export async function POST\([\s\S]*?if \(!isSameOriginAuthRequest\(request\)\)/);
  assert.match(route, /export async function DELETE\([\s\S]*?if \(!isSameOriginAuthRequest\(request\)\)/);
  assert.match(route, /const db = getDb\(\)/);
  assert.match(route, /db\.insert\(studentGuardians\)/);
  assert.match(route, /export async function DELETE\(/);
});
