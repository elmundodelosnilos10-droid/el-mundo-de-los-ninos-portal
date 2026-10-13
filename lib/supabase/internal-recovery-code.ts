/** Pure assisted-recovery envelopes and CAS plans. No Auth/DB operation occurs
 * here. Authorization MUST come from a locked, authenticated school RPC, never
 * from HTTP input. Encryption neither proves a person's identity nor consumes
 * a code: the persistent RPC predicates and actual recovery OTP are mandatory. */
export type InternalRecoveryRole = "docente" | "tutor" | "direccion";
export type InternalRecoveryPurpose = "password_reset" | "confirmed_activation_completion";
export type InternalRecoveryState = "reserved" | "issued" | "verifying" | "changing" | "completed" | "cancelled" | "uncertain";

export type InternalRecoveryAuthorization = {
  caseId: string;
  nonce: string;
  reservedAt: number;
  issuer: { id: string; active: boolean; roles: readonly string[]; hasMfa: boolean; assuranceLevel: "aal1" | "aal2" };
  target: {
    id: string; email: string; active: boolean; roles: readonly string[];
    emailConfirmed: boolean; passwordPresent: boolean; hasMfa: boolean;
    hasExternalIdentity: boolean; protectedAccount: boolean;
    credentialState: "established" | "confirmed_unclaimed" | "claimed_or_uncertain" | "unconfirmed";
    /** State observed under the reservation lock, before retiring an unclaimed
     * invitation. A later managed state alone cannot prove safe completion. */
    priorProvisionState: "managed" | "provisioned" | "reissuing" | "quarantined";
    passwordChangeUncertain: boolean;
  };
  verification: { method: "presencial"; reference: string; verifiedAt: number };
};

export type InternalRecoveryIdentity = {
  id: string; email: string; role: InternalRecoveryRole; caseId: string; nonce: string;
  purpose: InternalRecoveryPurpose; issuerId: string; verificationReference: string;
  ownerVerifiedAt: number; tokenHash: string;
};
export type InternalRecoveryCode = InternalRecoveryIdentity & { issuedAt: number; expiresAt: number };
type RecoveryBase = Omit<InternalRecoveryIdentity, "tokenHash">;
export type InternalRecoverySession = RecoveryBase & {
  codeIssuedAt: number; codeExpiresAt: number; sessionId: string;
  accessToken: string; expiresAt: number;
};
export type InternalRecoveryCaseSnapshot = RecoveryBase & {
  state: InternalRecoveryState; issuedAt: number; expiresAt: number; tokenDigest: string;
  /** Recomputed from current Auth/profile/roles by the private RPC. A supplied
   * boolean or a stale JavaScript snapshot is not an authorization proof. */
  eligibility: "eligible" | "blocked";
};
type ClaimIdentity = { caseId: string; nonce: string; targetId: string };
export type InternalRecoveryCodeClaimPlan = Readonly<ClaimIdentity & { expectedState: "issued"; nextState: "verifying"; tokenDigest: string }>;
export type InternalRecoveryPasswordClaimPlan = Readonly<ClaimIdentity & { expectedState: "verifying"; nextState: "changing"; sessionId: string }>;
export type InternalRecoveryClaimPlan = InternalRecoveryCodeClaimPlan | InternalRecoveryPasswordClaimPlan;

export const INTERNAL_RECOVERY_LIMITS = Object.freeze({
  codeLength: 2_048, sessionLength: 3_800, codeTtlMs: 30 * 60_000,
  sessionTtlMs: 10 * 60_000, reservationTtlMs: 5 * 60_000, verificationTtlMs: 10 * 60_000,
});
const CODE_PREFIX = "EMDNR1.";
const SESSION_PREFIX = "EMDNRS1.";
const FAILURE = "No se pudo validar la recuperación.";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const salt = encoder.encode("el-mundo-de-los-ninos/internal-recovery/v1");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tokenHashPattern = /^(?:[0-9a-f]{56}|[0-9a-f]{64})$/;
const digestPattern = /^[0-9a-f]{64}$/;
const baseFields = ["id", "email", "role", "caseId", "nonce", "purpose", "issuerId", "verificationReference", "ownerVerifiedAt"] as const;
const sessionFields = [...baseFields, "codeIssuedAt", "codeExpiresAt", "sessionId", "accessToken", "expiresAt"] as const;
type JsonRecord = Record<string, unknown>;
type Purpose = "code" | "session" | "receipt";

function fail(): never { throw new Error(FAILURE); }
function clock(value: number) { if (!Number.isSafeInteger(value) || value < 0) fail(); return value; }
function record(value: unknown, fields: readonly string[]): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const row = value as JsonRecord;
  if (Object.keys(row).length !== fields.length || !fields.every(field => Object.hasOwn(row, field))) fail();
  return row;
}
function identifier(value: unknown, canonical = false) {
  if (typeof value !== "string" || !uuid.test(value)) fail();
  const normalized = value.toLowerCase(); if (canonical && value !== normalized) fail(); return normalized;
}
function email(value: unknown, canonical = false) {
  if (typeof value !== "string" || value.length > 512) fail();
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(normalized)) fail();
  const local = normalized.split("@", 1)[0];
  if (local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..") || canonical && normalized !== value) fail();
  return normalized;
}
function singleRole(value: unknown) {
  if (!Array.isArray(value) || value.length !== 1 || !["docente", "tutor", "direccion"].includes(value[0])) fail();
  return value[0] as InternalRecoveryRole;
}
function instant(value: unknown) { if (typeof value !== "number") fail(); return clock(value); }
function expiry(value: unknown, issuedAt: number, now: number, ttl: number) {
  const result = instant(value);
  if (issuedAt > now || result <= now || result <= issuedAt || result > issuedAt + ttl || result > now + ttl) fail();
  return result;
}
function verificationTime(value: unknown, issuedAt: number) {
  const verifiedAt = instant(value);
  if (verifiedAt > issuedAt || issuedAt - verifiedAt > INTERNAL_RECOVERY_LIMITS.verificationTtlMs) fail();
  return verifiedAt;
}
function base(row: JsonRecord, canonical = false): RecoveryBase {
  const id = identifier(row.id, canonical), issuerId = identifier(row.issuerId, canonical);
  const caseId = identifier(row.caseId, canonical), nonce = identifier(row.nonce, canonical);
  if (id === issuerId || caseId === nonce || !["docente", "tutor", "direccion"].includes(row.role as string)
    || row.purpose !== "password_reset" && row.purpose !== "confirmed_activation_completion") fail();
  return { id, email: email(row.email, canonical), role: row.role as InternalRecoveryRole, caseId, nonce,
    purpose: row.purpose, issuerId, verificationReference: identifier(row.verificationReference, canonical), ownerVerifiedAt: instant(row.ownerVerifiedAt) };
}

/** Shape/eligibility validation only. Its input must be a trusted reservation
 * result with identity verification recorded by the school superadministrator. */
export function validateInternalRecoveryAuthorization(value: InternalRecoveryAuthorization, nowMs = Date.now()): RecoveryBase {
  try {
    const now = clock(nowMs);
    const row = record(value, ["caseId", "nonce", "reservedAt", "issuer", "target", "verification"]);
    const issuer = record(row.issuer, ["id", "active", "roles", "hasMfa", "assuranceLevel"]);
    const target = record(row.target, ["id", "email", "active", "roles", "emailConfirmed", "passwordPresent", "hasMfa", "hasExternalIdentity", "protectedAccount", "credentialState", "priorProvisionState", "passwordChangeUncertain"]);
    const verified = record(row.verification, ["method", "reference", "verifiedAt"]);
    const reservedAt = instant(row.reservedAt), verifiedAt = instant(verified.verifiedAt);
    if (reservedAt > now || now - reservedAt > INTERNAL_RECOVERY_LIMITS.reservationTtlMs
      || verifiedAt > reservedAt || now - verifiedAt > INTERNAL_RECOVERY_LIMITS.verificationTtlMs
      || verified.method !== "presencial" || issuer.active !== true || !Array.isArray(issuer.roles)
      || issuer.roles.length !== 1 || issuer.roles[0] !== "superadmin"
      || typeof issuer.hasMfa !== "boolean" || !["aal1", "aal2"].includes(issuer.assuranceLevel as string)
      || issuer.hasMfa === true && issuer.assuranceLevel !== "aal2"
      || target.active !== true || target.emailConfirmed !== true || target.hasMfa !== false
      || target.hasExternalIdentity !== false || target.protectedAccount !== false || target.passwordChangeUncertain !== false) fail();
    let purpose: InternalRecoveryPurpose;
    if (target.credentialState === "established" && target.passwordPresent === true && target.priorProvisionState === "managed") purpose = "password_reset";
    else if (target.credentialState === "confirmed_unclaimed" && target.passwordPresent === false && target.priorProvisionState === "provisioned") purpose = "confirmed_activation_completion";
    else fail(); // managed without a password never establishes a settled attempt.
    return base({ id: target.id, email: target.email, role: singleRole(target.roles), caseId: row.caseId, nonce: row.nonce,
      purpose, issuerId: issuer.id, verificationReference: verified.reference, ownerVerifiedAt: verifiedAt });
  } catch { return fail(); }
}

export function isInternalRecoverySecret(value: unknown): value is string {
  return typeof value === "string" && value.length >= 43 && value.length <= 256
    && !/[\s\u0000-\u001f\u007f-\u009f]/u.test(value)
    && !/^sb_(?:secret|publishable)_/i.test(value)
    && !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)
    && encoder.encode(value).length >= 32;
}
async function key(secret: string, purpose: Purpose) {
  if (!isInternalRecoverySecret(secret)) fail();
  const material = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"]);
  if (purpose === "receipt") return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: encoder.encode(purpose) }, material,
    { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: encoder.encode(purpose) }, material,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
function encode64(bytes: Uint8Array) {
  let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decode64(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) fail();
  const bytes = Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0));
  if (bytes.length < 30 || encode64(bytes) !== value) fail(); return bytes;
}
function aad(purpose: "code" | "session", boundEmail?: string) {
  return encoder.encode(purpose === "code" ? `school-recovery-code.v1\u0000${boundEmail}` : "school-recovery-cookie.v1");
}
async function seal(payload: JsonRecord, secret: string, purpose: "code" | "session", prefix: string, limit: number, boundEmail?: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(purpose, boundEmail), tagLength: 128 },
    await key(secret, purpose), encoder.encode(JSON.stringify(payload))));
  const bytes = new Uint8Array(iv.length + ciphertext.length); bytes.set(iv); bytes.set(ciphertext, iv.length);
  const result = prefix + encode64(bytes); if (result.length > limit) fail(); return result;
}
async function open(value: string, secret: string, purpose: "code" | "session", prefix: string, limit: number, boundEmail?: string) {
  if (typeof value !== "string" || value.length > limit || !value.startsWith(prefix)) fail();
  const bytes = decode64(value.slice(prefix.length));
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12), additionalData: aad(purpose, boundEmail), tagLength: 128 },
    await key(secret, purpose), bytes.slice(12));
  return JSON.parse(decoder.decode(plaintext)) as unknown;
}
function tokenHash(value: unknown): string { if (typeof value !== "string" || !tokenHashPattern.test(value)) fail(); return value; }

/** A keyed fingerprint prevents a leaked low-entropy OTP digest becoming a
 * public offline oracle. Store this receipt, never the tokenHash, in the ledger. */
export async function internalRecoveryTokenDigest(value: string, secret: string) {
  try {
    const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret, "receipt"), encoder.encode(tokenHash(value))));
    return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  } catch { return fail(); }
}
export async function createInternalRecoveryCode(authorization: InternalRecoveryAuthorization, recoveryTokenHash: string, secret: string, nowMs = Date.now()) {
  try {
    const now = clock(nowMs), identity = validateInternalRecoveryAuthorization(authorization, now);
    const expiresAt = expiry(now + INTERNAL_RECOVERY_LIMITS.codeTtlMs, now, now, INTERNAL_RECOVERY_LIMITS.codeTtlMs);
    const code = await seal({ kind: "recovery-code", ...identity, tokenHash: tokenHash(recoveryTokenHash), issuedAt: now, expiresAt },
      secret, "code", CODE_PREFIX, INTERNAL_RECOVERY_LIMITS.codeLength, identity.email);
    return { code, expiresAt: new Date(expiresAt).toISOString() };
  } catch { return fail(); }
}
export async function readInternalRecoveryCode(value: string, requestedEmail: string, secret: string, nowMs = Date.now()): Promise<InternalRecoveryCode> {
  try {
    const now = clock(nowMs), boundEmail = email(requestedEmail);
    const row = record(await open(value, secret, "code", CODE_PREFIX, INTERNAL_RECOVERY_LIMITS.codeLength, boundEmail),
      ["kind", ...baseFields, "tokenHash", "issuedAt", "expiresAt"]);
    const identity = base(row, true), issuedAt = instant(row.issuedAt);
    if (row.kind !== "recovery-code" || identity.email !== boundEmail) fail();
    verificationTime(identity.ownerVerifiedAt, issuedAt);
    return { ...identity, tokenHash: tokenHash(row.tokenHash), issuedAt,
      expiresAt: expiry(row.expiresAt, issuedAt, now, INTERNAL_RECOVERY_LIMITS.codeTtlMs) };
  } catch { return fail(); }
}
function validatedSession(value: unknown, now: number, canonical = false): InternalRecoverySession {
  const row = record(value, sessionFields), identity = base(row, canonical), codeIssuedAt = instant(row.codeIssuedAt);
  verificationTime(identity.ownerVerifiedAt, codeIssuedAt);
  const codeExpiresAt = expiry(row.codeExpiresAt, codeIssuedAt, now, INTERNAL_RECOVERY_LIMITS.codeTtlMs);
  const expiresAt = instant(row.expiresAt);
  if (expiresAt <= now || expiresAt > now + INTERNAL_RECOVERY_LIMITS.sessionTtlMs || expiresAt > codeExpiresAt
    || typeof row.accessToken !== "string" || row.accessToken.length < 8 || row.accessToken.length > 16_384 || /[^\x21-\x7e]/.test(row.accessToken)) fail();
  return { ...identity, codeIssuedAt, codeExpiresAt, sessionId: identifier(row.sessionId, canonical), accessToken: row.accessToken, expiresAt };
}
export async function sealInternalRecoverySession(value: InternalRecoverySession, secret: string, nowMs = Date.now()) {
  try {
    const now = clock(nowMs), session = validatedSession(value, now);
    return await seal({ kind: "recovery-session", ...session, issuedAt: now }, secret, "session", SESSION_PREFIX, INTERNAL_RECOVERY_LIMITS.sessionLength);
  } catch { return fail(); }
}
export async function readInternalRecoverySession(value: string, secret: string, nowMs = Date.now()): Promise<InternalRecoverySession> {
  try {
    const now = clock(nowMs), row = record(await open(value, secret, "session", SESSION_PREFIX, INTERNAL_RECOVERY_LIMITS.sessionLength), ["kind", ...sessionFields, "issuedAt"]);
    if (row.kind !== "recovery-session") fail();
    const issuedAt = instant(row.issuedAt), input = { ...row }; delete input.kind; delete input.issuedAt;
    const session = validatedSession(input, now, true);
    if (issuedAt < session.codeIssuedAt) fail();
    expiry(session.expiresAt, issuedAt, now, INTERNAL_RECOVERY_LIMITS.sessionTtlMs);
    return session;
  } catch { return fail(); }
}
function snapshot(value: InternalRecoveryCaseSnapshot, now: number) {
  const row = record(value, [...baseFields, "state", "issuedAt", "expiresAt", "tokenDigest", "eligibility"]);
  const identity = base(row, true), issuedAt = instant(row.issuedAt);
  verificationTime(identity.ownerVerifiedAt, issuedAt);
  const expiresAt = expiry(row.expiresAt, issuedAt, now, INTERNAL_RECOVERY_LIMITS.codeTtlMs);
  if (row.eligibility !== "eligible" || typeof row.tokenDigest !== "string" || !digestPattern.test(row.tokenDigest)
    || !["reserved", "issued", "verifying", "changing", "completed", "cancelled", "uncertain"].includes(row.state as string)) fail();
  return { ...identity, issuedAt, expiresAt, tokenDigest: row.tokenDigest, state: row.state as InternalRecoveryState };
}
function sameIdentity(left: RecoveryBase, right: RecoveryBase) {
  return baseFields.every(field => left[field] === right[field]);
}
function sameDigest(left: string, right: string) {
  if (!digestPattern.test(left) || !digestPattern.test(right)) return false;
  let mismatch = 0; for (let i = 0; i < 64; i++) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i); return mismatch === 0;
}

/** Return a CAS predicate only. Both callers can obtain a plan from the same
 * stale snapshot. The PRIVATE RPC must atomically compare and update it before
 * /verify; only the winning transaction may contact Auth. No process cache. */
export async function planInternalRecoveryCodeConsumption(value: InternalRecoveryCaseSnapshot, candidate: InternalRecoveryCode, secret: string, nowMs = Date.now()): Promise<InternalRecoveryCodeClaimPlan> {
  try {
    const now = clock(nowMs), current = snapshot(value, now);
    const row = record(candidate, [...baseFields, "tokenHash", "issuedAt", "expiresAt"]);
    const identity = base(row, true), issuedAt = instant(row.issuedAt);
    verificationTime(identity.ownerVerifiedAt, issuedAt);
    const expiresAt = expiry(row.expiresAt, issuedAt, now, INTERNAL_RECOVERY_LIMITS.codeTtlMs);
    if (current.state !== "issued" || !sameIdentity(current, identity) || current.issuedAt !== issuedAt || current.expiresAt !== expiresAt
      || !sameDigest(current.tokenDigest, await internalRecoveryTokenDigest(tokenHash(row.tokenHash), secret))) fail();
    return Object.freeze({ caseId: current.caseId, nonce: current.nonce, targetId: current.id, expectedState: "issued", nextState: "verifying", tokenDigest: current.tokenDigest });
  } catch { return fail(); }
}

/** The second persistent CAS is mandatory before a single own-user password
 * PUT. The RPC must check auth.uid(), current eligibility and the actual session;
 * a plan is neither proof of recovery OTP verification nor a completed change. */
export function planInternalRecoveryPasswordClaim(value: InternalRecoveryCaseSnapshot, candidate: InternalRecoverySession, nowMs = Date.now()): InternalRecoveryPasswordClaimPlan {
  try {
    const now = clock(nowMs), current = snapshot(value, now), session = validatedSession(candidate, now, true);
    if (current.state !== "verifying" || !sameIdentity(current, session)
      || current.issuedAt !== session.codeIssuedAt || current.expiresAt !== session.codeExpiresAt) fail();
    return Object.freeze({ caseId: current.caseId, nonce: current.nonce, targetId: current.id, expectedState: "verifying", nextState: "changing", sessionId: session.sessionId });
  } catch { return fail(); }
}
