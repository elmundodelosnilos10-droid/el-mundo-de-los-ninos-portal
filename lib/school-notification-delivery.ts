/** Server-side external notice delivery. No provider is enabled by default. */
import { createHash, createECDH, ECDH } from "node:crypto";
import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
type PushResolver = (hostname: string, options: { all: true; verbatim: true }) => Promise<LookupAddress[]>;
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import webpush from "web-push";

export type ExternalNoticeEnvironment = {
  SCHOOL_NOTIFICATION_EMAIL_PROVIDER?: string; SCHOOL_NOTIFICATION_PUSH_PROVIDER?: string;
  SCHOOL_NOTIFICATION_RESEND_KEY?: string; SCHOOL_NOTIFICATION_EMAIL_FROM?: string;
  SCHOOL_NOTIFICATION_VAPID_PUBLIC_KEY?: string; SCHOOL_NOTIFICATION_VAPID_PRIVATE_KEY?: string;
  SCHOOL_NOTIFICATION_VAPID_SUBJECT?: string; APP_ORIGIN?: string;
};
export type DeliveryResult = { state: "accepted" | "uncertain" | "rejected"; code: "provider_accepted" | "transport_uncertain" | "provider_rejected" | "subscription_gone" | "invalid_destination" | "not_configured" };
export type PushDestination = { endpoint: string; keys: { p256dh: string; auth: string } };
export const EXTERNAL_NOTICE_TEXT = "Tienes un aviso en tu portal escolar. Inicia sesión para consultarlo.";
export const PUSH_HOSTS = new Set(["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rejected = (code: DeliveryResult["code"]): DeliveryResult => ({ state: "rejected", code });

export function externalNoticeOrigin(value: unknown) {
  if (typeof value !== "string") throw Error("External notice origin unavailable");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash || isIP(url.hostname) || /(^|[.])(localhost|local|internal)$/i.test(url.hostname) || !/^[a-z0-9.-]+$/i.test(url.hostname) || !url.hostname.includes(".")) throw Error("External notice origin unavailable");
  return url.origin;
}
export function validatePushDestination(value: unknown): PushDestination {
  if (!value || typeof value !== "object") throw Error("Invalid push destination");
  const row = value as Record<string, unknown>;
  if (typeof row.endpoint !== "string" || row.endpoint.length > 4096) throw Error("Invalid push destination");
  const url = new URL(row.endpoint);
  if (url.protocol !== "https:" || !PUSH_HOSTS.has(url.hostname) || url.username || url.password || url.port || url.hash || url.search || !/^\/[A-Za-z0-9_./%=-]+$/.test(url.pathname)) throw Error("Invalid push destination");
  if (!row.keys || typeof row.keys !== "object") throw Error("Invalid push destination");
  const keys = row.keys as Record<string, unknown>;
  if (typeof keys.p256dh !== "string" || !/^[A-Za-z0-9_-]{87}$/.test(keys.p256dh) || typeof keys.auth !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(keys.auth)) throw Error("Invalid push destination");
  const publicKey = Buffer.from(keys.p256dh, "base64url");
  if (publicKey.length !== 65 || publicKey[0] !== 4 || Buffer.from(keys.auth, "base64url").length !== 16) throw Error("Invalid push destination");
  try { ECDH.convertKey(publicKey, "prime256v1"); } catch { throw Error("Invalid push destination"); }
  return { endpoint: url.href, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}
export function externalNoticeConfiguration(env: ExternalNoticeEnvironment) {
  let origin = ""; try { origin = externalNoticeOrigin(env.APP_ORIGIN); } catch { /* Closed unless origin is valid. */ }
  const email = env.SCHOOL_NOTIFICATION_EMAIL_PROVIDER === "resend" && Boolean(origin && env.SCHOOL_NOTIFICATION_RESEND_KEY?.trim() && !/[\r\n]/.test(env.SCHOOL_NOTIFICATION_RESEND_KEY ?? "") && env.SCHOOL_NOTIFICATION_EMAIL_FROM?.trim() && !/[\r\n]/.test(env.SCHOOL_NOTIFICATION_EMAIL_FROM));
  let push = false;
  if (env.SCHOOL_NOTIFICATION_PUSH_PROVIDER === "webpush" && origin) {
    try {
      const pub = env.SCHOOL_NOTIFICATION_VAPID_PUBLIC_KEY ?? "", priv = env.SCHOOL_NOTIFICATION_VAPID_PRIVATE_KEY ?? "", subject = env.SCHOOL_NOTIFICATION_VAPID_SUBJECT ?? "";
      if (!/^[A-Za-z0-9_-]{87}$/.test(pub) || !/^[A-Za-z0-9_-]{43}$/.test(priv) || /[\r\n]/.test(subject)) throw Error("Invalid VAPID configuration");
      const curve = createECDH("prime256v1"); curve.setPrivateKey(Buffer.from(priv, "base64url"));
      if (curve.getPublicKey().toString("base64url") !== pub) throw Error("Invalid VAPID configuration");
      if (!/^mailto:[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(subject)) externalNoticeOrigin(subject);
      push = true;
    } catch { /* Invalid keys or contact information do not expose a public capability. */ }
  }
  return { email, webpush: push, publicVapidKey: push ? env.SCHOOL_NOTIFICATION_VAPID_PUBLIC_KEY : undefined };
}
export function opaquePushTopic(jobId: string) {
  if (!uuid.test(jobId)) throw Error("Invalid delivery job");
  return createHash("sha256").update(`school-notice:${jobId}`).digest("base64url").slice(0, 32);
}
function publicAddress(address: string) {
  if (isIP(address) === 4) {
    const [a,b] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0));
  }
  if (isIP(address) === 6) return /^[23][0-9a-f]{0,3}:/i.test(address) && !/^2001:db8:/i.test(address);
  return false;
}
export async function verifyPushHost(hostname: string, resolver: PushResolver = lookup) {
  if (!PUSH_HOSTS.has(hostname)) throw Error("Invalid push destination");
  const answers = await new Promise<LookupAddress[]>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("Push destination lookup unavailable")), 5000); timer.unref();
    resolver(hostname, { all: true, verbatim: true }).then(resolve, reject).finally(() => clearTimeout(timer));
  });
  if (!answers.length || answers.some(answer => !publicAddress(answer.address))) throw Error("Invalid push destination");
  return answers;
}
async function boundedResponse(response: Response) {
  const reader = response.body?.getReader(); if (!reader) throw Error("Invalid provider response");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.length; if (size > 8192) throw Error("Invalid provider response"); chunks.push(item.value); }
  } finally { await reader.cancel().catch(() => undefined); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}
export async function deliverExternalEmail(env: ExternalNoticeEnvironment, jobId: string, email: unknown, fetcher: typeof fetch = fetch): Promise<DeliveryResult> {
  if (!externalNoticeConfiguration(env).email) return rejected("not_configured");
  if (!uuid.test(jobId) || typeof email !== "string" || email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) return rejected("invalid_destination");
  const origin = externalNoticeOrigin(env.APP_ORIGIN);
  try {
    const response = await fetcher("https://api.resend.com/emails", { method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${env.SCHOOL_NOTIFICATION_RESEND_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `school-notice/${jobId}` },
      body: JSON.stringify({ from: env.SCHOOL_NOTIFICATION_EMAIL_FROM, to: [email], subject: "Aviso del portal escolar", text: `${EXTERNAL_NOTICE_TEXT}\n${origin}/`,
        html: `<p>${EXTERNAL_NOTICE_TEXT}</p><p><a href="${origin}/">Abrir el portal escolar</a></p>` }) });
    if (!response.ok) { await response.body?.cancel(); return response.status >= 500 || response.status === 409 || response.status === 429 ? { state: "uncertain", code: "transport_uncertain" } : rejected("provider_rejected"); }
    const body = await boundedResponse(response);
    return typeof body.id === "string" && uuid.test(body.id) ? { state: "accepted", code: "provider_accepted" } : { state: "uncertain", code: "transport_uncertain" };
  } catch { return { state: "uncertain", code: "transport_uncertain" }; }
}
export async function deliverExternalPush(env: ExternalNoticeEnvironment, jobId: string, destination: unknown,
  dependencies: { fetcher?: typeof fetch; resolver?: PushResolver } = {}): Promise<DeliveryResult> {
  if (!externalNoticeConfiguration(env).webpush) return rejected("not_configured");
  let subscription: PushDestination; let addresses;
  try { subscription = validatePushDestination(destination); opaquePushTopic(jobId); addresses = await verifyPushHost(new URL(subscription.endpoint).hostname, dependencies.resolver); }
  catch { return rejected("invalid_destination"); }
  let details;
  try {
    details = webpush.generateRequestDetails(subscription, JSON.stringify({ title: "Portal escolar", body: EXTERNAL_NOTICE_TEXT, url: `${externalNoticeOrigin(env.APP_ORIGIN)}/`, tag: opaquePushTopic(jobId) }), {
      vapidDetails: { subject: env.SCHOOL_NOTIFICATION_VAPID_SUBJECT!, publicKey: env.SCHOOL_NOTIFICATION_VAPID_PUBLIC_KEY!, privateKey: env.SCHOOL_NOTIFICATION_VAPID_PRIVATE_KEY! },
      TTL: 300, urgency: "normal", topic: opaquePushTopic(jobId), contentEncoding: "aes128gcm",
    });
  } catch { return rejected("invalid_destination"); }
  try {
    // Production HTTPS pins the already checked public DNS address. No redirect,
    // proxy, pooled agent or second DNS lookup can redirect subscription keys.
    const response = dependencies.fetcher
      ? await dependencies.fetcher(subscription.endpoint, { method: "POST", headers: details.headers as Record<string, string>, body: new Uint8Array(Buffer.from(details.body ?? "")), redirect: "error", signal: AbortSignal.timeout(20_000) })
      : await new Promise<{ status: number; body?: ReadableStream<Uint8Array> }>((resolve, reject) => {
        const address = addresses[0];
        const outgoing = httpsRequest(subscription.endpoint, { method: "POST", headers: details.headers, agent: false, signal: AbortSignal.timeout(20_000),
          lookup: (_hostname, options, callback) => {
            if (typeof options === "object" && options.all) callback(null, [address]);
            else callback(null, address.address, address.family);
          },
        }, incoming => { const status = incoming.statusCode ?? 0; incoming.destroy(); resolve({ status }); });
        outgoing.once("error", reject); outgoing.end(details.body);
      });
    await response.body?.cancel();
    if (response.status === 201 || response.status === 202) return { state: "accepted", code: "provider_accepted" };
    if (response.status === 404 || response.status === 410) return rejected("subscription_gone");
    return response.status >= 500 || response.status === 429 ? { state: "uncertain", code: "transport_uncertain" } : rejected("provider_rejected");
  } catch { return { state: "uncertain", code: "transport_uncertain" }; }
}
