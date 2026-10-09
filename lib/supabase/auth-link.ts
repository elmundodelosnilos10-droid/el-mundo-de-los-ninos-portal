export type SupabaseAuthLink = {
  token: string;
  kind: "invite" | "recovery" | "password-reset";
};

/** Parse Supabase invite/recovery fragments and Better Auth reset query links. */
export function parseSchoolAuthLink(search: string, hash: string): SupabaseAuthLink | null {
  const query = new URLSearchParams(search);
  const fragment = new URLSearchParams(hash.replace(/^#/, ""));
  if (query.has("error") || query.has("error_code") || fragment.has("error") || fragment.has("error_code")) return null;
  const type = fragment.get("type");
  const token = fragment.get("access_token");
  if (fragment.has("access_token") || fragment.has("type")) {
    if ((type === "invite" || type === "recovery") && token && isOpaqueToken(token)
      && fragment.getAll("access_token").length === 1 && fragment.getAll("type").length === 1) {
      return { token, kind: type };
    }
    return null;
  }
  const queryToken = query.get("token");
  if (queryToken && query.getAll("token").length === 1 && isOpaqueToken(queryToken)) return { token: queryToken, kind: "password-reset" };
  return null;
}

/** Scrub both successful and failed callbacks before the user starts typing. */
export function prepareSchoolAuthLink(currentUrl: string) {
  const url = new URL(currentUrl);
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  const errorCode = fragment.get("error_code") ?? url.searchParams.get("error_code");
  const link = parseSchoolAuthLink(url.search, url.hash);
  url.hash = "";
  for (const name of ["token", "access_token", "refresh_token", "token_hash", "code", "type", "expires_at", "expires_in", "token_type", "error", "error_code", "error_description"]) {
    url.searchParams.delete(name);
  }
  return {
    link,
    cleanPath: `${url.pathname}${url.search}`,
    issue: link ? null : errorCode === "otp_expired" ? "expired" as const : "invalid" as const,
  };
}

function isOpaqueToken(value: string) {
  return value.length > 0 && value.length <= 16_384 && !/[\s\u0000-\u001f\u007f]/.test(value);
}
