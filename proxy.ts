import { env } from "@/lib/runtime/env";
import { NextResponse, type NextRequest } from "next/server";
import {
  createSchoolAuthClient,
  readSupabaseAuthCookies,
  serializeSessionCookies,
} from "@/lib/supabase/auth";
import { isSupabaseAccessTokenNearExpiry, replaceSupabaseSessionCookies } from "@/lib/supabase/session-utils";

export async function proxy(request: NextRequest) {
  if (env.SCHOOL_AUTH_PROVIDER !== "supabase") return NextResponse.next();

  const stored = readSupabaseAuthCookies(request.headers.get("cookie"));
  if (!stored || !isSupabaseAccessTokenNearExpiry(stored.accessToken)) return NextResponse.next();

  try {
    const auth = createSchoolAuthClient(env);
    const session = await auth.refresh(stored.refreshToken);
    await auth.verifyCurrentUser(session.access_token);
    const sessionCookies = serializeSessionCookies(session);
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("cookie", replaceSupabaseSessionCookies(request.headers.get("cookie"), sessionCookies));
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    for (const cookie of sessionCookies) response.headers.append("Set-Cookie", cookie);
    return response;
  } catch {
    // Keep the existing session cookies on transient Auth failures; pages fail closed if validation fails.
    return NextResponse.next();
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
