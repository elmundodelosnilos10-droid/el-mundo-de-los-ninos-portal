import type { NextConfig } from "next";
import { permitsIsolatedSupabaseHttp } from "./lib/supabase/local-http-test-policy.ts";

const nextConfig: NextConfig = {
  // NextURL normally rewrites loopback IPs to localhost. Keep the actual
  // Origin/URL identical for the isolated HTTP harness without weakening CSRF.
  ...(permitsIsolatedSupabaseHttp(process.env.APP_ORIGIN ?? "")
    ? { skipMiddlewareUrlNormalize: true } : {}),
  // Keep Sites-only Vite/Worker build sources out of Next type checking.
  typescript: { tsconfigPath: "tsconfig.next.json" },
};

export default nextConfig;
