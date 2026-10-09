import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sql = await readFile(new URL("../supabase/migrations/20261012000000_school_attendance_rpcs.sql", import.meta.url), "utf8");
const executableSql = sql.replace(/--.*$/gm, "");

function functionDefinition(name) {
  return executableSql.match(new RegExp(`create function public\\.${name}\\(([\\s\\S]*?)\\$\\$;`, "i"))?.[0] ?? "";
}

function parameterPattern(signature) {
  return signature.split(",").map(parameter => escapeRegex(parameter.trim()).replaceAll(" ", "\\s+")).join("\\s*,\\s*");
}

function sqlTypes(signature) {
  return signature.split(",").map(parameter => parameter.trim().split(/\s+/).at(-1)).join(", ");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const rpcContracts = [
  ["school_attendance_roster", "p_group_id uuid, p_on_date text"],
  ["school_attendance_history", "p_student_id uuid, p_group_id uuid, p_from text, p_to text"],
  ["school_list_attendance_justifications", "p_group_id uuid, p_on_date text, p_student_id uuid"],
  ["school_record_attendance", "p_group_id uuid, p_on_date text, p_records jsonb"],
  ["school_submit_attendance_justification", "p_id uuid, p_student_id uuid, p_on_date text, p_reason text"],
  ["school_review_attendance_justification", "p_id uuid, p_status text"],
  ["school_attendance_report", "p_group_id uuid, p_from text, p_to text, p_format text"],
];

test("declares the seven attendance RPCs with the route integration signatures", () => {
  for (const [name, signature] of rpcContracts) {
    assert.match(executableSql, new RegExp(`create function public\\.${name}\\(\\s*${parameterPattern(signature)}\\s*\\)\\s*returns jsonb`, "i"), `${name} must retain its documented arguments and JSON result`);
  }
});

test("every callable attendance RPC uses the current JWT and a fixed definer search path", () => {
  for (const [name] of rpcContracts) {
    const definition = functionDefinition(name);
    assert.ok(definition, `${name} must be defined`);
    assert.match(definition, /security definer\s+set search_path = ''/i, `${name} must be SECURITY DEFINER with an empty search_path`);
    assert.match(definition, /auth\.uid\(\)/i, `${name} must derive its actor from the JWT`);
  }
  assert.match(executableSql, /revoke all on function public\.school_attendance_parse_date\(text\) from public, anon, authenticated/i);
});

test("daily attendance validates roster, duplicate IDs, state, reason, and batch size before writing", () => {
  const definition = functionDefinition("school_record_attendance");
  assert.match(definition, /jsonb_array_length\(p_records\) not between 1 and 80/i);
  assert.match(definition, /duplicate_attendance_student/i);
  assert.match(definition, /student_not_enrolled_in_group/i);
  assert.match(definition, /justificada/i);
  assert.match(definition, /char_length\(btrim\(coalesce\(value->>'note'/i);
  assert.match(definition, /for update of e, s/i);
  assert.match(definition, /modified_by = actor_id, modified_at = now_at/i);
  assert.match(definition, /insert into public\.audit_log/i);
});

test("family justifications lock duplicate submissions and review transitions", () => {
  const submit = functionDefinition("school_submit_attendance_justification");
  assert.match(submit, /school_is_guardian_of_student\(p_student_id\)/i);
  assert.match(submit, /for update/i);
  assert.match(submit, /justification_status <> 'rechazada'/i);
  assert.match(submit, /insert into public\.audit_log/i);
  assert.match(submit, /insert into public\.notifications/i);
  assert.match(submit, /on conflict \(dedupe_key\) do nothing/i);

  const review = functionDefinition("school_review_attendance_justification");
  assert.match(review, /from public\.attendance_justifications j where j\.id = p_id for update/i);
  assert.match(review, /request_status <> 'pendiente'/i);
  assert.match(review, /status = 'justificada'/i);
  assert.match(review, /insert into public\.audit_log/i);
  assert.match(review, /insert into public\.notifications/i);
});

test("history and report enforce inclusive 366-day periods; reports stop above 10,000 and audit", () => {
  const history = functionDefinition("school_attendance_history");
  assert.match(history, /to_date - from_date\) \+ 1 > 366/i);
  assert.match(history, /school_is_guardian_of_student\(p_student_id\)/i);
  assert.match(history, /school_is_teacher_of_group\(p_group_id\)/i);
  assert.match(history, /attendancePercent/i);

  const report = functionDefinition("school_attendance_report");
  assert.match(report, /p_group_id is null[\s\S]*?school_is_leader\(\)/i);
  assert.match(report, /to_date - from_date\) \+ 1 > 366/i);
  assert.match(report, /row_count > 10000/i);
  assert.match(report, /insert into public\.audit_log/i);
  assert.match(report, /'items', report_items, 'groupName', selected_group_name/i);
});

test("attendance reads are scoped by role/group/linked child and direct table writes are revoked", () => {
  assert.match(executableSql, /attendance_justified_reason_check[\s\S]*?status <> 'justificada'[\s\S]*?not valid/i);
  assert.match(executableSql, /attendance_justifications_review_state_check[\s\S]*?reviewed_by is not null and reviewed_at is not null[\s\S]*?not valid/i);
  assert.match(executableSql, /create index attendance_on_date_group_idx on public\.attendance\(on_date, group_id\)/i);
  assert.match(executableSql, /drop policy if exists attendance_insert_staff on public\.attendance/i);
  assert.match(executableSql, /drop policy if exists attendance_update_staff on public\.attendance/i);
  assert.match(executableSql, /create policy attendance_read_authorized on public\.attendance for select to authenticated[\s\S]*?school_is_teacher_of_group\(group_id\)[\s\S]*?school_is_guardian_of_student\(student_id\)/i);
  assert.match(executableSql, /revoke insert, update, delete on table public\.attendance from authenticated/i);

  assert.match(executableSql, /drop policy if exists attendance_justifications_update_family on public\.attendance_justifications/i);
  assert.match(executableSql, /drop policy if exists attendance_justifications_review_staff on public\.attendance_justifications/i);
  assert.match(executableSql, /create policy attendance_justifications_read_authorized on public\.attendance_justifications for select to authenticated[\s\S]*?school_is_teacher_of_group\(group_id\)[\s\S]*?school_is_guardian_of_student\(student_id\)/i);
  assert.match(executableSql, /revoke insert, update, delete on table public\.attendance_justifications from authenticated/i);
});

test("business RPCs are revoked from PUBLIC/anon and explicitly granted only to authenticated", () => {
  for (const [name, signature] of rpcContracts) {
    const types = escapeRegex(sqlTypes(signature)).replaceAll(" ", "\\s+");
    assert.match(executableSql, new RegExp(`revoke all on function public\\.${name}\\(\\s*${types}\\s*\\) from public, anon, authenticated`, "i"));
    assert.match(executableSql, new RegExp(`grant execute on function public\\.${name}\\(\\s*${types}\\s*\\) to authenticated`, "i"));
  }
});
