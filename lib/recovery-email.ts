type RecoveryEmailConfig = {
  SCHOOL_AUTH_PROVIDER?: string;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  GMAIL_CLIENT_ID?: string;
  GMAIL_CLIENT_SECRET?: string;
  GMAIL_REFRESH_TOKEN?: string;
  GMAIL_SENDER_EMAIL?: string;
};

type RecoveryEmail = { to: string; url: string };
type Fetcher = typeof fetch;

const gmailConfigKeys = [
  "GMAIL_CLIENT_ID",
  "GMAIL_CLIENT_SECRET",
  "GMAIL_REFRESH_TOKEN",
  "GMAIL_SENDER_EMAIL",
] as const;

function value(config: RecoveryEmailConfig, key: keyof RecoveryEmailConfig) {
  const item = config[key];
  return typeof item === "string" ? item.trim() : "";
}

export function isRecoveryEmailConfigured(config: RecoveryEmailConfig) {
  if (value(config, "SCHOOL_AUTH_PROVIDER") === "supabase") {
    return Boolean(value(config, "SUPABASE_URL") && value(config, "SUPABASE_PUBLISHABLE_KEY"));
  }

  const gmailValues = gmailConfigKeys.map(key => value(config, key));
  if (gmailValues.every(Boolean) && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(gmailValues[3])) return true;
  if (gmailValues.some(Boolean)) return false;
  return Boolean(value(config, "RESEND_API_KEY") && value(config, "EMAIL_FROM"));
}

function assertHeaderSafe(input: string, label: string) {
  if (!input || /[\r\n<>]/.test(input)) throw new Error(`Configuración de correo no válida (${label}).`);
}

function base64(input: string) {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64Url(input: string) {
  return base64(input).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function buildGmailRawMessage(to: string, from: string, url: string) {
  assertHeaderSafe(to, "destinatario");
  assertHeaderSafe(from, "remitente");
  assertHeaderSafe(url, "enlace");
  const displayName = base64("El Mundo de los Niños");
  const body = `Solicitaste cambiar la contraseña de tu cuenta escolar.\n\nAbre este enlace para crear una nueva contraseña:\n${url}\n\nEl enlace caduca en una hora. Si no hiciste esta solicitud, ignora este correo.`;
  const raw = [
    `From: =?UTF-8?B?${displayName}?= <${from}>`,
    `To: ${to}`,
    "Subject: Recupera el acceso al Portal Escolar",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
  ].join("\r\n");
  return base64Url(raw);
}

async function sendWithGmail(config: RecoveryEmailConfig, { to, url }: RecoveryEmail, fetcher: Fetcher) {
  const clientId = value(config, "GMAIL_CLIENT_ID");
  const clientSecret = value(config, "GMAIL_CLIENT_SECRET");
  const refreshToken = value(config, "GMAIL_REFRESH_TOKEN");
  const sender = value(config, "GMAIL_SENDER_EMAIL");
  if (!clientId || !clientSecret || !refreshToken || !sender) {
    throw new Error("La integración de Gmail está incompleta.");
  }

  const tokenResponse = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!tokenResponse.ok) throw new Error("Google no autorizó el envío del correo.");
  const tokenBody = await tokenResponse.json() as { access_token?: unknown; scope?: unknown };
  if (typeof tokenBody.access_token !== "string" || !tokenBody.access_token) {
    throw new Error("Google no devolvió autorización para enviar el correo.");
  }
  if (typeof tokenBody.scope === "string" && !tokenBody.scope.split(/\s+/).includes("https://www.googleapis.com/auth/gmail.send")) {
    throw new Error("La autorización de Google no incluye el permiso de envío de correo.");
  }

  const sendResponse = await fetcher("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenBody.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: buildGmailRawMessage(to, sender, url) }),
  });
  if (!sendResponse.ok) throw new Error("Gmail no pudo enviar el correo de recuperación.");
}

async function sendWithResend(config: RecoveryEmailConfig, { to, url }: RecoveryEmail, fetcher: Fetcher) {
  const apiKey = value(config, "RESEND_API_KEY");
  const from = value(config, "EMAIL_FROM");
  if (!apiKey || !from) throw new Error("El correo de recuperación no está configurado.");
  const response = await fetcher("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "Recupera el acceso al Portal Escolar",
      html: `<p>Solicitaste cambiar la contraseña de tu cuenta escolar.</p><p><a href="${url}">Crear una nueva contraseña</a></p><p>El enlace caduca en una hora. Si no hiciste esta solicitud, puedes ignorar este correo.</p>`,
      text: `Solicitaste cambiar la contraseña. Abre este enlace para crear una nueva: ${url}\nEl enlace caduca en una hora. Si no hiciste esta solicitud, ignora este correo.`,
    }),
  });
  if (!response.ok) throw new Error("No se pudo enviar el correo de recuperación.");
}

export async function sendPasswordResetEmail(
  config: RecoveryEmailConfig,
  email: RecoveryEmail,
  fetcher: Fetcher = fetch,
) {
  const gmailValues = gmailConfigKeys.map(key => value(config, key));
  if (gmailValues.some(Boolean)) {
    await sendWithGmail(config, email, fetcher);
    return;
  }
  await sendWithResend(config, email, fetcher);
}

export { buildGmailRawMessage };
