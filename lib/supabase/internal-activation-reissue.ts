import type { Actor } from "../access";
import type { createSchoolAuthClient, AuthUser } from "./auth";
import type { createSchoolDatabaseClient } from "./database";
import { createInternalActivationCode, isInternalActivationSecret } from "./internal-activation.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const roles = ["docente", "tutor", "direccion"] as const;
type Reservation = { id: string; name: string; email: string; role: typeof roles[number]; nonce: string; previousNonce: string; inviterId: string };
export class InternalActivationReissueError extends Error {
  readonly code: "forbidden" | "not_pending" | "unavailable" | "reissue_uncertain";
  constructor(code: InternalActivationReissueError["code"]) { super(`Internal activation reissue failed (${code})`); this.name = "InternalActivationReissueError"; this.code = code; }
}
function record(value: unknown): Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function reservation(value: unknown, target: string, nonce: string): Reservation | null {
  const row = record(value);
  if (row.reserved !== true || row.id !== target || row.nonce !== nonce
    || typeof row.previousNonce !== "string" || !uuid.test(row.previousNonce) || row.previousNonce === nonce
    || typeof row.inviterId !== "string" || !uuid.test(row.inviterId)
    || typeof row.name !== "string" || row.name.trim().length < 2 || row.name.length > 100
    || typeof row.email !== "string" || row.email !== row.email.trim().toLowerCase() || row.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)
    || !roles.includes(row.role as typeof roles[number])) return null;
  return row as unknown as Reservation;
}
function pendingIdentity(user: AuthUser, expected: Reservation, nonce: string) {
  const receipt = record(user.app_metadata?.school_invitation_receipt);
  return user.id === expected.id && typeof user.email === "string" && user.email.trim().toLowerCase() === expected.email
    && typeof user.invited_at === "string" && Number.isFinite(Date.parse(user.invited_at))
    && (user.email_confirmed_at === undefined || user.email_confirmed_at === null || user.email_confirmed_at === "")
    && (user.last_sign_in_at === undefined || user.last_sign_in_at === null || user.last_sign_in_at === "")
    && !user.app_metadata?.school_activation_completed_nonce
    && receipt.nonce === nonce && receipt.email === expected.email && receipt.role === expected.role
    && receipt.inviter_id === expected.inviterId && receipt.delivery === "internal";
}

/** No password, identity, role or email is changed. Unknown replies may follow
 * committed reservation/finalization; never restore an old nonce or retry here. */
export async function reissueInternalActivation(
  authFactory: () => ReturnType<typeof createSchoolAuthClient>, database: ReturnType<typeof createSchoolDatabaseClient>,
  actor: Actor, target: string, secret: string,
) {
  if (!actor.supabaseAuth || actor.supabaseAuth.userId !== actor.id || !actor.roles.some(role => role === "superadmin" || role === "direccion") || target === actor.id || !uuid.test(target)) throw new InternalActivationReissueError("forbidden");
  if (!isInternalActivationSecret(secret)) throw new InternalActivationReissueError("unavailable");
  const nonce = crypto.randomUUID();
  let started;
  try { started = await database.rpc(actor.supabaseAuth.accessToken, "school_begin_internal_activation_reissue", { p_auth_user_id: target, p_replacement_nonce: nonce }); }
  catch { throw new InternalActivationReissueError("reissue_uncertain"); }
  if (started.data.length === 1 && record(started.data[0]).reserved === false && Object.keys(record(started.data[0])).length === 1) throw new InternalActivationReissueError("not_pending");
  const expected = started.data.length === 1 ? reservation(started.data[0], target, nonce) : null;
  if (!expected || expected.role === "direccion" && !actor.roles.includes("superadmin") || expected.inviterId !== actor.id && !actor.roles.includes("superadmin")) throw new InternalActivationReissueError("reissue_uncertain");
  try {
    const auth = authFactory();
    const generated = await auth.admin.generateInviteLink({ email: expected.email });
    if (!pendingIdentity(generated.user, expected, expected.previousNonce) || !/^(?:[0-9a-f]{56}|[0-9a-f]{64})$/.test(generated.tokenHash)) throw Error();
    const metadata = generated.user.app_metadata ?? {};
    const stamped = await auth.admin.updateUser(target, { app_metadata: { ...metadata,
      school_invitation_receipt: { ...record(metadata.school_invitation_receipt), nonce, email: expected.email, role: expected.role, inviter_id: expected.inviterId, delivery: "internal" },
    } });
    if (!pendingIdentity(stamped, expected, nonce)) throw Error();
    // A local sealing failure must not reopen the reserved invitation.
    const code = await createInternalActivationCode({ id: target, email: expected.email, role: expected.role, nonce, tokenHash: generated.tokenHash }, secret);
    const finished = await database.rpc(actor.supabaseAuth.accessToken, "school_finish_internal_activation_reissue", { p_auth_user_id: target, p_replacement_nonce: nonce });
    const confirmed = finished.data.length === 1 ? record(finished.data[0]) : {};
    if (confirmed.finished !== true || confirmed.id !== target || confirmed.email !== expected.email || confirmed.role !== expected.role || confirmed.nonce !== nonce) throw Error();
    return { id: target, invited: false, activation: { ...code, activationPath: "/activar-cuenta" } };
  } catch { throw new InternalActivationReissueError("reissue_uncertain"); }
}
