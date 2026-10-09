/** School privileges are assigned through user-JWT RPCs, never Auth metadata. */
import type { Actor } from "../access";
import type { createSchoolAuthClient } from "./auth";
import type { createSchoolDatabaseClient } from "./database";

type AuthClient = ReturnType<typeof createSchoolAuthClient>;
type DatabaseClient = ReturnType<typeof createSchoolDatabaseClient>;
export type InvitedSchoolRole = "direccion" | "docente" | "tutor";

export class SchoolAccountAdministrationError extends Error {
  readonly code: "forbidden" | "already_exists" | "unavailable" | "invitation_uncertain" | "provisioning_blocked" | "provisioning_uncertain";
  constructor(code: SchoolAccountAdministrationError["code"]) {
    super(`School account administration failed (${code})`);
    this.name = "SchoolAccountAdministrationError";
    this.code = code;
  }
}

function actorJwt(actor: Actor) {
  if (!actor.supabaseAuth || actor.supabaseAuth.userId !== actor.id
    || !actor.roles.some(role => role === "superadmin" || role === "direccion")) {
    throw new SchoolAccountAdministrationError("forbidden");
  }
  return actor.supabaseAuth.accessToken;
}

/**
 * Fresh Auth identity first, then a trusted receipt, then the authorized RPC.
 * An uncertain Auth response is never reconciled by automatically granting a
 * role to whatever identity happens to have the requested email afterward.
 */
export async function inviteSchoolAccount(
  auth: AuthClient,
  database: DatabaseClient,
  actor: Actor,
  input: { name: string; email: string; role: InvitedSchoolRole },
  appOrigin: string | undefined,
) {
  const jwt = actorJwt(actor);
  if (input.role === "direccion" && !actor.roles.includes("superadmin")) throw new SchoolAccountAdministrationError("forbidden");
  const email = input.email.trim().toLowerCase();
  let redirectTo: string;
  try {
    if (!appOrigin) throw new Error();
    const origin = new URL(appOrigin);
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error();
    redirectTo = new URL("/restablecer", origin).toString();
  } catch { throw new SchoolAccountAdministrationError("unavailable"); }

  let before;
  try { before = await auth.admin.listUsers({ perPage: 1000, maxPages: 100 }); }
  catch { throw new SchoolAccountAdministrationError("unavailable"); }
  if (before.some(user => user.email?.trim().toLowerCase() === email)) throw new SchoolAccountAdministrationError("already_exists");
  const previousIds = new Set(before.map(user => user.id));
  const nonce = crypto.randomUUID();
  let invited;
  try { invited = await auth.admin.inviteUserByEmail({ email, redirectTo, user_metadata: { name: input.name } }); }
  catch { throw new SchoolAccountAdministrationError("invitation_uncertain"); }
  if (previousIds.has(invited.id) || invited.email?.trim().toLowerCase() !== email
    || typeof invited.invited_at !== "string" || !Number.isFinite(Date.parse(invited.invited_at))) {
    throw new SchoolAccountAdministrationError("invitation_uncertain");
  }

  // The receipt records this server attempt, not access rights. app_metadata is
  // Auth-admin controlled; raw_user_meta_data is editable and cannot prove it.
  try {
    const stamped = await auth.admin.updateUser(invited.id, { app_metadata: {
      ...(invited.app_metadata ?? {}),
      school_invitation_receipt: { nonce, inviter_id: actor.id, email },
    } });
    const receipt = stamped.app_metadata?.school_invitation_receipt as Record<string, unknown> | undefined;
    if (stamped.id !== invited.id || stamped.email?.trim().toLowerCase() !== email
      || !receipt || receipt.nonce !== nonce || receipt.inviter_id !== actor.id || receipt.email !== email) throw new Error();
  } catch { throw new SchoolAccountAdministrationError("invitation_uncertain"); }

  try {
    const result = await database.rpc(jwt, "school_provision_invited_account", {
      p_auth_user_id: invited.id, p_expected_email: email, p_name: input.name,
      p_role: input.role, p_invitation_nonce: nonce,
    });
    const account = result.data[0];
    if (!account || account.id !== invited.id || account.role !== input.role || account.active !== true) throw new Error();
    return { id: invited.id, invited: true };
  } catch {
    // If provision committed before the response was lost, remove only the
    // fresh privileges from this same receipt. Never delete the Auth identity.
    try {
      const quarantine = await database.rpc(jwt, "school_quarantine_invited_account", {
        p_auth_user_id: invited.id, p_invitation_nonce: nonce,
      });
      if (quarantine.data[0]?.quarantined !== true) throw new Error();
    } catch { throw new SchoolAccountAdministrationError("provisioning_uncertain"); }
    throw new SchoolAccountAdministrationError("provisioning_blocked");
  }
}

export async function updateSchoolAccount(
  database: DatabaseClient,
  actor: Actor,
  targetId: string,
  changes: { role?: InvitedSchoolRole; active?: boolean; name?: string; email?: string },
) {
  const jwt = actorJwt(actor);
  if (targetId === actor.id || changes.role === "direccion" && !actor.roles.includes("superadmin")) {
    throw new SchoolAccountAdministrationError("forbidden");
  }
  const result = await database.rpc(jwt, "school_update_account", {
    p_auth_user_id: targetId, p_role: changes.role ?? null,
    p_active: changes.active ?? null, p_name: changes.name ?? null,
    p_expected_email: changes.email?.trim().toLowerCase() ?? null,
  });
  const updated = result.data[0];
  if (!updated || updated.id !== targetId || updated.updated !== true) throw new SchoolAccountAdministrationError("unavailable");
  return updated;
}
