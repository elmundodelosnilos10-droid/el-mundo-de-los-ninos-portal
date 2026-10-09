import { env } from "@/lib/runtime/env";
import { actorFromRequest, type Actor } from "@/lib/access";
import { getSchoolSession, readVerifiedSupabaseSchoolAccount } from "./session";

/** Server pages use the same verified identity and authorization as API routes.
 * The JWT stays on the server; pass only display names, roles and authorized
 * DTOs to client components. Supabase mode never consults a D1 account.
 */
export async function getSchoolPageActor(requestHeaders: Headers): Promise<Actor | null> {
  if (env.SCHOOL_DATA_PROVIDER !== "supabase") {
    return actorFromRequest(new Request("https://school.internal/", { headers: requestHeaders }));
  }
  const session = await getSchoolSession(requestHeaders);
  if (!session?.user) return null;
  const context = session.session as typeof session.session & {
    supabaseAuthUserId?: unknown;
    supabaseAccessToken?: unknown;
  };
  if (typeof context.supabaseAuthUserId !== "string" || typeof context.supabaseAccessToken !== "string" ||
      context.supabaseAuthUserId !== session.user.id) return null;
  try {
    const account = readVerifiedSupabaseSchoolAccount(session);
    return account ? {
      id: account.id,
      name: account.name,
      email: account.email,
      roles: [...account.roles],
      supabaseAuth: { userId: context.supabaseAuthUserId, accessToken: context.supabaseAccessToken },
    } : null;
  } catch { return null; }
}
