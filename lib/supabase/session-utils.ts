export function isSupabaseAccessTokenNearExpiry(token: string, now = Date.now(), refreshWindowMs = 120_000) {
  if (!Number.isFinite(now) || !Number.isSafeInteger(refreshWindowMs) || refreshWindowMs < 0 || refreshWindowMs > 600_000) return true;
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return true;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: unknown };
    return typeof payload.exp !== "number" || !Number.isSafeInteger(payload.exp) || payload.exp * 1000 <= now + refreshWindowMs;
  } catch {
    return true;
  }
}

export function replaceSupabaseSessionCookies(existing: string | null, cookies: readonly string[]) {
  const replacedNames = new Set(["__Host-school-access", "__Host-school-refresh"]);
  const parts = (existing ?? "").split(";").map(part => part.trim()).filter(part => {
    const separator = part.indexOf("=");
    return separator > 0 && !replacedNames.has(part.slice(0, separator));
  });
  for (const cookie of cookies) {
    const pair = cookie.split(";", 1)[0];
    if (pair) parts.push(pair);
  }
  return parts.join("; ");
}
