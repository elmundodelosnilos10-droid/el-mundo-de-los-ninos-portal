export type SchoolLoginUser = { id: string; name: string; email: string };

export function isSameOriginAuthRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  try {
    return origin === new URL(origin).origin && origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

/** Keep bearer credentials exclusively in HttpOnly cookies, never response JSON. */
export function createSchoolLoginPayload(account: SchoolLoginUser) {
  return { user: account };
}

export function isPasswordRecoveryRateLimit(operation: string, status?: number) {
  return operation === "password_recovery" && status === 429;
}
