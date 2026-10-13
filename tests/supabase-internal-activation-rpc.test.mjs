import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sql = await readFile(new URL("../supabase/migrations/20261101000000_school_internal_activation.sql", import.meta.url), "utf8");
const prior = await readFile(new URL("../supabase/migrations/20261024000000_school_accounts_rpcs.sql", import.meta.url), "utf8");
function body(name) {
  const value = sql.match(new RegExp(`create or replace function public\\.${name}\\([^]*?\\n\\$\\$;`, "i"))?.[0];
  assert.ok(value, `missing ${name}`);
  return value;
}
const claim = body("school_claim_internal_activation");
const ready = body("school_internal_activation_ready");

test("SQL32 adds only two narrow functions inside a transaction without widening table access", () => {
  assert.match(sql, /^.*?\bbegin;/s);
  assert.match(sql, /commit;\s*$/);
  assert.equal((sql.match(/create or replace function/gi) ?? []).length, 2);
  assert.doesNotMatch(sql, /create\s+table|alter\s+table|create\s+policy|grant[^;]*\bon\s+table|grant[^;]*\bselect\b/i);
  assert.doesNotMatch(sql, /insert into (?:auth\.users|public\.(?:profiles|user_roles|teachers|guardians))/i);
});

test("claim derives its only target from auth.uid and exposes no arbitrary account parameter", () => {
  assert.match(claim, /school_claim_internal_activation\(p_invitation_nonce uuid\)/);
  assert.match(claim, /v_actor uuid := auth\.uid\(\)/);
  assert.match(claim, /if v_actor is null then\s+raise exception 'forbidden' using errcode = '42501'/);
  assert.match(claim, /auth\.users where id = v_actor for update/);
  assert.match(claim, /public\.profiles where id = v_actor for update/);
  assert.doesNotMatch(claim, /p_auth_user_id|p_actor_id|p_email|p_role/);
});

test("both functions use definer permissions with an empty search_path and authenticated-only execute", () => {
  for (const [name, signature, definition] of [["school_claim_internal_activation", "uuid", claim], ["school_internal_activation_ready", "", ready]]) {
    assert.match(definition, /security definer\s+set search_path = ''/);
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}\\(${signature}\\) from public, anon, authenticated, service_role;`));
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}\\(${signature}\\) to authenticated;`));
  }
  assert.doesNotMatch(sql, /grant execute[^;]*to (?:public|anon|service_role)/i);
});

test("claim shares the account-administration lock and preserves Auth/profile/provision lock order", () => {
  const lock = "perform pg_advisory_xact_lock(hashtext('school:account-administration'));";
  assert.ok(prior.includes(lock));
  const indexes = [claim.indexOf(lock), claim.indexOf("from auth.users"), claim.indexOf("from public.profiles"),
    claim.indexOf("from public.school_account_invitation_provisions"), claim.indexOf("v_now := clock_timestamp();")];
  assert.ok(indexes.every(index => index >= 0));
  assert.deepEqual([...indexes].sort((a, b) => a - b), indexes);
  assert.equal((claim.match(/for update/g) ?? []).length, 3);
  assert.match(claim, /v_now := clock_timestamp\(\);[^]*?not v_profile\.active or not public\.school_actor_active\(\)/);
});

test("claim refuses missing, future, expired, quarantined or previously managed provisions", () => {
  assert.match(claim, /if p_invitation_nonce is null then\s+return jsonb_build_object\('claimed', false\)/);
  assert.match(claim, /v_attempt\.state <> 'provisioned'/);
  assert.match(claim, /v_attempt\.invitation_nonce <> p_invitation_nonce/);
  assert.match(claim, /v_attempt\.provisioned_at > v_now/);
  assert.match(claim, /v_attempt\.provisioned_at <= v_now - interval '30 minutes'/);
  assert.match(claim, /v_auth\.invited_at is null or v_auth\.deleted_at is not null/);
  assert.match(claim, /v_auth\.banned_until > v_now/);
});

test("claim requires exactly one currently assigned admitted role and an active typed school profile", () => {
  assert.match(claim, /cardinality\(v_roles\) is distinct from 1/);
  assert.match(claim, /v_roles\[1\] not in \('docente', 'tutor', 'direccion'\)/);
  assert.match(claim, /role = v_roles\[1\] and assigned_by = v_attempt\.inviter_id/);
  assert.match(claim, /v_roles\[1\] = 'docente'[^]*?public\.teachers where user_id = v_actor and active/);
  assert.match(claim, /v_roles\[1\] = 'tutor'[^]*?public\.guardians where user_id = v_actor and active/);
  assert.doesNotMatch(claim, /insert into public\.user_roles|delete from public\.user_roles|update public\.profiles/i);
});

test("claim binds internal delivery, nonce, email, role and inviter to the current invitation receipt", () => {
  assert.match(claim, /v_email := lower\(btrim\(v_auth\.email\)\)/);
  assert.match(claim, /lower\(btrim\(v_profile\.email\)\) is distinct from v_email/);
  for (const [field, expected] of [["delivery", "'internal'"], ["nonce", "p_invitation_nonce::text"], ["email", "v_email"], ["role", "v_roles[1]"], ["inviter_id", "v_attempt.inviter_id::text"]]) {
    assert.ok(claim.includes(`(v_auth.raw_app_meta_data -> 'school_invitation_receipt' ->> '${field}') is distinct from ${expected}`));
  }
  assert.match(claim, /raw_app_meta_data ->> 'school_activation_completed_nonce'\) = p_invitation_nonce::text/);
});

test("single-use claim is a guarded provisioned-to-managed update with an atomic audit", () => {
  assert.match(claim, /update public\.school_account_invitation_provisions set state = 'managed'\s+where auth_user_id = v_actor and invitation_nonce = p_invitation_nonce and state = 'provisioned'\s+returning true into v_claimed;/);
  assert.match(claim, /returning true into v_claimed;\s+if not found then return jsonb_build_object\('claimed', false\); end if;\s+insert into public\.audit_log/);
  assert.match(claim, /'claim_internal_activation', 'user', v_actor::text, v_now/);
  assert.match(claim, /return jsonb_build_object\('claimed', v_claimed\)/);
  assert.doesNotMatch(claim.replace(/^\s*--.*$/gm, ""), /password|token_hash|refresh_token|access_token/i);
});

test("readiness requires a current active leader and reports the exact SQL32 contract", () => {
  assert.match(ready, /auth\.uid\(\) is null or not public\.school_actor_active\(\) or not public\.school_is_leader\(\)/);
  assert.match(ready, /raise exception 'forbidden' using errcode = '42501'/);
  assert.match(ready, /return jsonb_build_object\('ready', true, 'version', 32\)/);
  assert.doesNotMatch(ready, /school_invitation_receipt|school_account_invitation_provisions/);
});

test("local runtime fixture rolls back only synthetic actors and tests positive, negative and ACL paths", async () => {
  const fixture = await readFile(new URL("./supabase-internal-activation.integration.sql", import.meta.url), "utf8");
  const executable = fixture.replace(/^\s*--.*$/gm, "").trim();
  assert.match(executable, /^begin;/i);
  assert.match(executable, /rollback;$/i);
  assert.doesNotMatch(executable, /\bcommit;|\btruncate\b|\bgrant\b|encrypted_password|https?:\/\//i);
  assert.match(executable, /set local role authenticated/);
  assert.match(executable, /set local role anon/);
  assert.equal((executable.match(/perform public\.school_provision_invited_account/g) ?? []).length, 3);
  for (const message of ["fresh teacher activation was not claimed", "teacher activation was claimed twice", "tutor claim/replay contract failed",
    "activation accepted exact/elapsed 30-minute expiry", "future provision timestamp was accepted", "completed activation marker was accepted",
    "profile/Auth email mismatch accepted", "inactive own account claimed activation", "multiple-role activation was accepted",
    "superadmin activation was accepted", "anon executed activation claim", "successful claims were not audited exactly once"]) {
    assert.ok(executable.includes(message));
  }
});
