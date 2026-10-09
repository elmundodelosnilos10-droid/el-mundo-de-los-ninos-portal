import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createSupabaseDatabaseClient } from "../lib/supabase/database.ts";
import { readConsentDirectory, readPrivacyDirectory, recordConsent, submitPrivacyRequest, updatePrivacyRequest, publishPrivacyNotice } from "../lib/supabase/privacy-administration.ts";

const id = "d1000000-0000-4000-8000-000000000001";
const leader = { id, roles: ["superadmin"], supabaseAuth: { userId: id, accessToken: "synthetic-privacy-jwt" } };
const tutor = { ...leader, roles: ["tutor"] };
function fake(result) {
  const calls = [];
  const client = createSupabaseDatabaseClient({ url: "https://school-test.supabase.co", publishableKey: "sb_publishable_test" }, async (url, init) => {
    calls.push({ path: new URL(url).pathname, body: JSON.parse(init.body), headers: init.headers });
    return Response.json(result);
  });
  return { client, calls };
}

test("consent and privacy directories use current JWT invoker RPCs", async () => {
  const consent = fake({ items: [], students: [], guardians: [] });
  assert.deepEqual(await readConsentDirectory(consent.client, leader), { items: [], students: [], guardians: [] });
  const privacy = fake({ items: [], students: [] });
  await readPrivacyDirectory(privacy.client, tutor);
  assert.equal(consent.calls[0].path, "/rest/v1/rpc/school_consent_directory");
  assert.equal(privacy.calls[0].path, "/rest/v1/rpc/school_privacy_request_directory");
  assert.ok([...consent.calls, ...privacy.calls].every(call => call.headers.Authorization === "Bearer synthetic-privacy-jwt"));
});

test("consent RPC carries evidence and decision but no actor, timestamps or arbitrary insert", async () => {
  const { client, calls } = fake({ id, saved: true });
  await recordConsent(client, leader, { studentId: id, guardianId: id, purpose: "class_recording", granted: false, noticeVersion: "school-approved", evidenceReference: "file-1" });
  assert.deepEqual(calls[0].body, { p_student_id: id, p_guardian_id: id, p_purpose: "class_recording", p_granted: false, p_notice_version: "school-approved", p_evidence_reference: "file-1", p_expires_at: null });
});

test("family submission and direction response keep requester identity in database", async () => {
  const submit = fake({ id, status: "recibida" });
  await submitPrivacyRequest(submit.client, tutor, { studentId: id, kind: "eliminacion", details: "Synthetic request details" });
  assert.deepEqual(submit.calls[0].body, { p_student_id: id, p_kind: "eliminacion", p_details: "Synthetic request details" });
  const update = fake({ id, status: "respondida" });
  await updatePrivacyRequest(update.client, leader, id, { status: "respondida", responseNote: "Synthetic response" });
  assert.deepEqual(update.calls[0].body, { p_id: id, p_status: "respondida", p_response_note: "Synthetic response" });
});

test("publishing passes explicit school approval and preserves the API DTO", async () => {
  const { client, calls } = fake({ id, version: "v1", publishedAt: "2026-10-08T10:00:00Z" });
  const input = { version: "v1", approvalConfirmed: true };
  await publishPrivacyNotice(client, leader, input);
  assert.deepEqual(calls[0].body, { p_content: input });
});

test("invalid role or mismatched identity fails before contacting Supabase", async () => {
  const { client, calls } = fake({});
  await assert.rejects(readConsentDirectory(client, tutor));
  await assert.rejects(publishPrivacyNotice(client, { ...leader, roles: ["direccion"] }, {}));
  await assert.rejects(submitPrivacyRequest(client, { ...tutor, supabaseAuth: { userId: "another", accessToken: "x" } }, { studentId: id, kind: "acceso", details: "synthetic" }));
  await assert.rejects(updatePrivacyRequest(client, tutor, id, { status: "cerrada" }));
  assert.equal(calls.length, 0);
});

test("uncertain or malformed results never claim successful writes", async () => {
  const { client } = fake({});
  await assert.rejects(readConsentDirectory(client, leader));
  await assert.rejects(readPrivacyDirectory(client, tutor));
  await assert.rejects(recordConsent(client, leader, { studentId: id, guardianId: id, purpose: "public_image", granted: true, noticeVersion: "v1", evidenceReference: "file" }));
  await assert.rejects(updatePrivacyRequest(client, leader, id, { status: "respondida" }));
});

test("SQL enforces linked active family, approved notice, audited transitions and no direct evidence writes", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20261026000000_school_privacy_rpcs.sql", import.meta.url), "utf8");
  assert.equal([...sql.matchAll(/insert into public\.audit_log/g)].length, 4);
  assert.equal([...sql.matchAll(/insert into public\.notifications/g)].length, 2);
  assert.match(sql, /g\.user_id = auth\.uid\(\)/);
  assert.match(sql, /approved_notice_required/);
  assert.match(sql, /p_expires_at <= v_now/);
  assert.match(sql, /select \* into v_item.*for update/);
  assert.match(sql, /invalid_transition/);
  assert.match(sql, /school_has_role\(array\['superadmin'\]/);
  assert.match(sql, /approvalConfirmed/);
  assert.match(sql, /revoke insert, update, delete on public\.consents, public\.privacy_notices, public\.privacy_requests from authenticated/);
});

test("Supabase route branches precede D1 instantiation and pages use server verified actors", async () => {
  for (const file of ["app/api/consents/route.ts", "app/api/privacy-requests/route.ts", "app/api/privacy-requests/[id]/route.ts", "app/api/privacy-notice/route.ts"]) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    for (const handler of source.split(/export async function /).slice(1)) {
      assert.ok(handler.indexOf('env.SCHOOL_DATA_PROVIDER === "supabase"') < handler.indexOf("getDb()"), file);
    }
  }
  for (const file of ["app/consentimientos/page.tsx", "app/privacidad/page.tsx"]) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /getSchoolPageActor/);
    assert.doesNotMatch(source, /getDb\(|accessToken/);
  }
});
