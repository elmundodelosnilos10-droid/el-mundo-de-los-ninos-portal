import type { Actor } from "@/lib/access";
import type { createSchoolDatabaseClient } from "./database";

type Client = ReturnType<typeof createSchoolDatabaseClient>;
type PrivacyActor = Pick<Actor, "id" | "roles" | "supabaseAuth">;
export type ConsentDirectory = { items: Record<string, unknown>[]; students: Record<string, unknown>[]; guardians: Record<string, unknown>[] };
export type PrivacyDirectory = { items: Record<string, unknown>[]; students?: Record<string, unknown>[] };

function token(actor: PrivacyActor, roles: string[]) {
  if (!actor.supabaseAuth || actor.supabaseAuth.userId !== actor.id || !actor.roles.some(role => roles.includes(role))) throw new Error("Privacy identity unavailable");
  return actor.supabaseAuth.accessToken;
}

export async function readConsentDirectory(client: Client, actor: PrivacyActor): Promise<ConsentDirectory> {
  const result = await client.rpc<ConsentDirectory>(token(actor, ["superadmin", "direccion"]), "school_consent_directory", {});
  const body = result.data[0];
  if (!body || !Array.isArray(body.items) || !Array.isArray(body.students) || !Array.isArray(body.guardians)) throw new Error("Consent directory unavailable");
  return body;
}

export async function readPrivacyDirectory(client: Client, actor: PrivacyActor): Promise<PrivacyDirectory> {
  const result = await client.rpc<PrivacyDirectory>(token(actor, ["superadmin", "direccion", "tutor"]), "school_privacy_request_directory", {});
  const body = result.data[0];
  if (!body || !Array.isArray(body.items) || (body.students !== undefined && !Array.isArray(body.students))) throw new Error("Privacy directory unavailable");
  return body;
}

export async function recordConsent(client: Client, actor: PrivacyActor, input: { studentId: string; guardianId: string; purpose: string; granted: boolean; noticeVersion: string; evidenceReference: string; expiresAt?: string | null }) {
  const result = await client.rpc<{ id: string; saved: boolean }>(token(actor, ["superadmin", "direccion"]), "school_record_consent", {
    p_student_id: input.studentId, p_guardian_id: input.guardianId, p_purpose: input.purpose,
    p_granted: input.granted, p_notice_version: input.noticeVersion, p_evidence_reference: input.evidenceReference, p_expires_at: input.expiresAt ?? null,
  });
  const body = result.data[0];
  if (!body || typeof body.id !== "string" || body.saved !== true) throw new Error("Consent recording unconfirmed");
  return body;
}

export async function submitPrivacyRequest(client: Client, actor: PrivacyActor, input: { studentId: string; kind: string; details: string }) {
  const result = await client.rpc<{ id: string; status: string }>(token(actor, ["tutor"]), "school_submit_privacy_request", { p_student_id: input.studentId, p_kind: input.kind, p_details: input.details });
  const body = result.data[0];
  if (!body || typeof body.id !== "string" || body.status !== "recibida") throw new Error("Privacy request unconfirmed");
  return body;
}

export async function updatePrivacyRequest(client: Client, actor: PrivacyActor, id: string, input: { status: string; responseNote?: string }) {
  const result = await client.rpc<{ id: string; status: string }>(token(actor, ["superadmin", "direccion"]), "school_update_privacy_request", { p_id: id, p_status: input.status, p_response_note: input.responseNote ?? null });
  const body = result.data[0];
  if (!body || body.id !== id || body.status !== input.status) throw new Error("Privacy update unconfirmed");
  return body;
}

export async function publishPrivacyNotice(client: Client, actor: PrivacyActor, input: Record<string, unknown>) {
  const result = await client.rpc<{ id: string; version: string; publishedAt: string }>(token(actor, ["superadmin"]), "school_publish_privacy_notice", { p_content: input });
  const body = result.data[0];
  if (!body || typeof body.id !== "string" || body.version !== input.version || typeof body.publishedAt !== "string" || Number.isNaN(Date.parse(body.publishedAt))) throw new Error("Privacy publication unconfirmed");
  return body;
}
