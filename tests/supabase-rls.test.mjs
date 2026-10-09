import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schema = await readFile(new URL("../supabase/migrations/20261008000000_school_schema.sql", import.meta.url), "utf8");
const policies = await readFile(new URL("../supabase/migrations/20261008000002_school_rls_policies.sql", import.meta.url), "utf8");
const executableSql = policies.replace(/--.*$/gm, "");
const schemaTables = [...schema.matchAll(/create table public\.(\w+)/gi)].map((match) => match[1]).sort();
const policyHeaders = [...policies.matchAll(/create policy\s+(\w+)\s+on\s+public\.(\w+)\s+for\s+(select|insert|update|delete|all)\s+to\s+(\w+)/gi)];
const policyTables = [...new Set(policyHeaders.map((match) => match[2]))].sort();

test("cada tabla escolar tiene RLS forzado y una política explícita para authenticated", () => {
  assert.deepEqual(policyTables, schemaTables);
  assert.match(policies, /force row level security/gi);
  assert.ok(policyHeaders.length >= schemaTables.length);
  assert.ok(policyHeaders.every((match) => match[4].toLowerCase() === "authenticated"));
  const names = policyHeaders.map((match) => match[1]);
  assert.equal(new Set(names).size, names.length, "los nombres de políticas deben ser únicos");
});

test("no hay políticas abiertas ni permisos directos para anon o PUBLIC", () => {
  assert.doesNotMatch(executableSql, /create\s+policy[^;]*\bto\s+(public|anon|service_role)\b/is);
  assert.doesNotMatch(executableSql, /using\s*\(\s*true\s*\)|with\s+check\s*\(\s*true\s*\)/i);
  assert.match(executableSql, /revoke all on table[\s\S]*?from public, anon, authenticated/i);
  assert.doesNotMatch(executableSql, /service_role/i);
});

test("las funciones de autorización usan auth.uid, SECURITY DEFINER y search_path vacío", () => {
  const functions = [...policies.matchAll(/create function public\.(\w+)\([\s\S]*?\$\$;/gi)];
  assert.ok(functions.length >= 10);
  assert.match(policies, /security definer[\s\S]*?set search_path = ''/i);
  assert.match(policies, /auth\.uid\(\)/i);
  for (const [, name] of functions) {
    assert.match(policies, new RegExp(`revoke all on function public\\.${name}\\(`, "i"), `${name} debe retirar EXECUTE a PUBLIC`);
  }
});

test("mensajes y notificaciones solo dejan cambiar el recibo de lectura", () => {
  assert.match(policies, /revoke update on table public\.messages from authenticated;\s*grant update \(read_at\) on table public\.messages to authenticated/i);
  assert.match(policies, /revoke insert, delete, update on table public\.notifications from authenticated;[\s\S]*?grant update \(read_at\) on table public\.notifications to authenticated/i);
  assert.doesNotMatch(policies, /create\s+policy\s+\w+\s+on public\.notifications\s+for insert/i);
  assert.match(policies, /revoke insert, update, delete on table public\.audit_log from authenticated/i);
  assert.doesNotMatch(policies, /create\s+policy\s+\w+\s+on public\.audit_log\s+for insert/i);
});
