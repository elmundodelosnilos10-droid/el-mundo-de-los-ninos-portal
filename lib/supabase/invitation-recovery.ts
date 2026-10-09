import type { AuthUser } from "./auth";

export type InvitationIdentityState = "present" | "absent" | "unknown";

/**
 * Reconcile an invitation after an ambiguous network failure. `unknown` must
 * be treated like `present`: removing the local reservation could orphan an
 * Auth identity if Supabase accepted the invite but the response was lost.
 */
export async function checkInvitationIdentity(
  email: string,
  listUsers: () => Promise<AuthUser[]>,
): Promise<InvitationIdentityState> {
  try {
    const normalizedEmail = email.trim().toLowerCase();
    const users = await listUsers();
    return users.some(user => user.email?.trim().toLowerCase() === normalizedEmail)
      ? "present"
      : "absent";
  } catch {
    return "unknown";
  }
}
