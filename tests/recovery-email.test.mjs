import assert from "node:assert/strict";
import test from "node:test";
import { buildGmailRawMessage, isRecoveryEmailConfigured, sendPasswordResetEmail } from "../lib/recovery-email.ts";

const gmail = {
  GMAIL_CLIENT_ID: "client-id",
  GMAIL_CLIENT_SECRET: "client-secret",
  GMAIL_REFRESH_TOKEN: "refresh-token",
  GMAIL_SENDER_EMAIL: "escuela@example.test",
};

test("la recuperación admite Gmail completo o Resend completo", () => {
  assert.equal(isRecoveryEmailConfigured(gmail), true);
  assert.equal(isRecoveryEmailConfigured({ RESEND_API_KEY: "resend_key", EMAIL_FROM: "acceso@escuela.mx" }), true);
  assert.equal(isRecoveryEmailConfigured({ RESEND_API_KEY: "resend_key" }), false);
  assert.equal(isRecoveryEmailConfigured({ EMAIL_FROM: "acceso@escuela.mx" }), false);
  assert.equal(isRecoveryEmailConfigured({}), false);
});

test("la recuperación Supabase se habilita con la URL y la clave pública", () => {
  assert.equal(isRecoveryEmailConfigured({
    SCHOOL_AUTH_PROVIDER: "supabase",
    SUPABASE_URL: "https://school.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  }), true);
  assert.equal(isRecoveryEmailConfigured({
    SCHOOL_AUTH_PROVIDER: "supabase",
    SUPABASE_URL: "https://school.supabase.co",
  }), false);
  assert.equal(isRecoveryEmailConfigured({
    SCHOOL_AUTH_PROVIDER: "supabase",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    RESEND_API_KEY: "resend_key",
    EMAIL_FROM: "acceso@escuela.mx",
  }), false);
});

test("no habilita envío con configuración de Gmail parcial o vacía", () => {
  assert.equal(isRecoveryEmailConfigured({ GMAIL_CLIENT_ID: "client-id" }), false);
  assert.equal(isRecoveryEmailConfigured({ ...gmail, GMAIL_REFRESH_TOKEN: " " }), false);
  assert.equal(isRecoveryEmailConfigured({ ...gmail, GMAIL_SENDER_EMAIL: "no es un correo" }), false);
  assert.equal(isRecoveryEmailConfigured({ RESEND_API_KEY: " ", EMAIL_FROM: "acceso@escuela.mx" }), false);
});

test("el mensaje Gmail conserva UTF-8 y codifica la solicitud como base64url", () => {
  const raw = buildGmailRawMessage("familia@example.test", gmail.GMAIL_SENDER_EMAIL, "https://portal.example.test/restablecer?token=prueba");
  const message = Buffer.from(raw, "base64url").toString("utf8");
  assert.match(message, /From: =\?UTF-8\?B\?.+\?= <escuela@example\.test>/);
  assert.match(message, /To: familia@example\.test/);
  assert.match(message, /El enlace caduca en una hora/);
  assert.match(message, /https:\/\/portal\.example\.test\/restablecer\?token=prueba/);
});

test("Gmail obtiene autorización y envía desde la cuenta escolar", async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    if (url === "https://oauth2.googleapis.com/token") {
      return new Response(JSON.stringify({ access_token: "access-token", scope: "https://www.googleapis.com/auth/gmail.send" }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: "synthetic-message-id" }), { status: 200 });
  };

  await sendPasswordResetEmail(gmail, {
    to: "familia@example.test",
    url: "https://portal.example.test/restablecer?token=synthetic",
  }, fakeFetch);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://oauth2.googleapis.com/token");
  assert.equal(calls[1].url, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
  assert.equal(calls[1].init.headers.Authorization, "Bearer access-token");
  const body = JSON.parse(calls[1].init.body);
  const message = Buffer.from(body.raw, "base64url").toString("utf8");
  assert.match(message, /From: =\?UTF-8\?B\?.+\?= <escuela@example\.test>/);
  assert.match(message, /To: familia@example\.test/);
});

test("no intenta enviar si falla la renovación del token de Google", async () => {
  let calls = 0;
  await assert.rejects(
    sendPasswordResetEmail(gmail, { to: "familia@example.test", url: "https://portal.example.test/reset" }, async () => {
      calls += 1;
      return new Response("{}", { status: 401 });
    }),
    /Google no autorizó el envío/,
  );
  assert.equal(calls, 1);
});

test("rechaza tokens que no incluyen el permiso mínimo de envío", async () => {
  let calls = 0;
  await assert.rejects(
    sendPasswordResetEmail(gmail, { to: "familia@example.test", url: "https://portal.example.test/reset" }, async () => {
      calls += 1;
      return new Response(JSON.stringify({ access_token: "access-token", scope: "openid email" }), { status: 200 });
    }),
    /no incluye el permiso de envío/,
  );
  assert.equal(calls, 1);
});

test("Resend permanece disponible como alternativa para dominio verificado", async () => {
  let request;
  await sendPasswordResetEmail({ RESEND_API_KEY: "resend_key", EMAIL_FROM: "Portal <acceso@escuela.mx>" }, {
    to: "familia@example.test",
    url: "https://portal.example.test/restablecer?token=synthetic",
  }, async (url, init) => {
    request = { url, init };
    return new Response("{}", { status: 200 });
  });
  assert.equal(request.url, "https://api.resend.com/emails");
  assert.equal(request.init.headers.Authorization, "Bearer resend_key");
  assert.deepEqual(JSON.parse(request.init.body).to, ["familia@example.test"]);
});
