/** Server-only exception for an explicitly opted-in, isolated local test stack.
 * HTTPS remains mandatory in production, on Vercel and without the opt-in.
 * Literal loopback IPs avoid DNS/hosts-file resolution or abbreviated IP URLs.
 */
export function permitsIsolatedSupabaseHttp(
  value: string,
  environment: Record<string, string | undefined> = typeof process === "undefined" ? {} : process.env,
) {
  if ((environment.NODE_ENV !== "development" && environment.NODE_ENV !== "test")
    || environment.SCHOOL_LOCAL_SUPABASE_HTTP !== "isolated-test"
    || environment.VERCEL !== undefined) return false;
  if (!/^http:\/\/(127\.0\.0\.1|\[::1\]):[1-9][0-9]{0,4}\/?$/.test(value)) return false;
  const port = Number(value.match(/:(\d+)\/?$/)?.[1]);
  return Number.isSafeInteger(port) && port >= 1 && port <= 65535;
}
