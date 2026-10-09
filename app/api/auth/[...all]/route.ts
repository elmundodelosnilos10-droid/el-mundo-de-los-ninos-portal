import { env } from "@/lib/runtime/env";
import { getAuth } from "@/lib/auth";
import { handleSupabaseAuthRequest } from "@/lib/supabase/auth-route";

async function handle(request: Request) {
  if (env.SCHOOL_AUTH_PROVIDER === "supabase") return handleSupabaseAuthRequest(request);
  const path = new URL(request.url).pathname;
  const allowed = new Set([
    "POST /api/auth/sign-in/email",
    "POST /api/auth/sign-out",
    "GET /api/auth/get-session",
    "POST /api/auth/request-password-reset",
    "POST /api/auth/reset-password",
    "POST /api/auth/change-password",
  ]);
  const resetLinkGet = request.method === "GET" && /^\/api\/auth\/reset-password\/[A-Za-z0-9_-]+$/.test(path);
  if (!allowed.has(`${request.method} ${path}`) && !resetLinkGet) return new Response(null, { status: 404 });
  return getAuth().handler(request);
}

export { handle as GET, handle as POST };
