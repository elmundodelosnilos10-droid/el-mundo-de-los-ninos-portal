import type { NextConfig } from "next";
import { permitsIsolatedSupabaseHttp } from "./lib/supabase/local-http-test-policy.ts";

const nextConfig: NextConfig = {
  // Keep ws's optional native-addon detection in Node. Bundling an absent
  // bufferutil as an empty module can break masking of Realtime join frames.
  serverExternalPackages: ["ws"],
  // NextURL normally rewrites loopback IPs to localhost. Keep the actual
  // Origin/URL identical for the isolated HTTP harness without weakening CSRF.
  ...(permitsIsolatedSupabaseHttp(process.env.APP_ORIGIN ?? "")
    ? { skipMiddlewareUrlNormalize: true } : {}),
  // Keep Sites-only Vite/Worker build sources out of Next type checking.
  typescript: { tsconfigPath: "tsconfig.next.json" },
};

export default nextConfig;
