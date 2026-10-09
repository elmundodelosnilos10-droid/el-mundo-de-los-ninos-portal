"use client";

type AuthResult<T = unknown> = { data: T | null; error: { message: string } | null };

async function post<T>(path: string, body?: unknown): Promise<AuthResult<T>> {
  try {
    const response = await fetch(`/api/auth/${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null) as T | { message?: string } | null;
    if (!response.ok) {
      const message = payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
        ? payload.message
        : "No se pudo completar la solicitud.";
      return { data: null, error: { message } };
    }
    return { data: payload as T, error: null };
  } catch {
    return { data: null, error: { message: "No fue posible conectar con la escuela." } };
  }
}

/** Small same-origin auth client so the portal can switch providers server-side. */
export const authClient = {
  signIn: {
    email: (input: { email: string; password: string }) => post("sign-in/email", input),
  },
  signOut: () => post("sign-out"),
  requestPasswordReset: (input: { email: string; redirectTo: string }) => post("request-password-reset", input),
  resetPassword: (input: { newPassword: string; token: string }) => post("reset-password", input),
  changePassword: (input: { currentPassword: string; newPassword: string; revokeOtherSessions?: boolean }) => post("change-password", input),
};
