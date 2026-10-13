import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createHash, webcrypto } from "node:crypto";
import {
  createInternalRecoveryCode, readInternalRecoveryCode, sealInternalRecoverySession, readInternalRecoverySession,
  validateInternalRecoveryAuthorization, isInternalRecoverySecret, internalRecoveryTokenDigest,
  planInternalRecoveryCodeConsumption, planInternalRecoveryPasswordClaim, INTERNAL_RECOVERY_LIMITS,
} from "../lib/supabase/internal-recovery-code.ts";
import { createInternalActivationCode, readInternalActivationCode, sealInternalActivationSession, readInternalActivationSession } from "../lib/supabase/internal-activation.ts";

const secret = "synthetic-internal-recovery-application-secret-only";
const otherSecret = "second-synthetic-internal-recovery-application-secret";
const now = Date.UTC(2026, 9, 12, 16);
const authorization = {
  caseId: "c1234567-1234-4234-9234-123456789abc", nonce: "b1234567-1234-4234-a234-123456789abc", reservedAt: now,
  issuer: { id: "a1234567-1234-4234-9234-123456789abc", active: true, roles: ["superadmin"], hasMfa: false, assuranceLevel: "aal1" },
  target: { id: "12345678-1234-4234-9234-123456789abc", email: "teacher@example.test", active: true, roles: ["docente"],
    emailConfirmed: true, passwordPresent: true, hasMfa: false, hasExternalIdentity: false, protectedAccount: false,
    credentialState: "established", priorProvisionState: "managed", passwordChangeUncertain: false },
  verification: { method: "presencial", reference: "d1234567-1234-4234-9234-123456789abc", verifiedAt: now },
};
const recoveryHash = "a1".repeat(32);
const base = validateInternalRecoveryAuthorization(authorization, now);
const codePayload = changes => ({ kind: "recovery-code", ...base, tokenHash: recoveryHash, issuedAt: now, expiresAt: now + 1_800_000, ...changes });
const session = { ...base, codeIssuedAt: now, codeExpiresAt: now + 1_800_000,
  sessionId: "e1234567-1234-4234-9234-123456789abc", accessToken: "synthetic-owner-recovery-access-token-only", expiresAt: now + 600_000 };
const failure = "No se pudo validar la recuperación.";
const sessionPayload = changes => ({ kind: "recovery-session", ...session, issuedAt: now, ...changes });
function patched(changes) { const result = structuredClone(authorization); changes(result); return result; }
async function rejectsPrivate(operation) {
  await assert.rejects(async () => operation(), error => {
    assert.equal(error.message, failure); assert.equal(Object.hasOwn(error, "cause"), false);
    for (const value of [base.email, base.id, base.nonce, base.caseId, base.verificationReference, recoveryHash, session.accessToken, secret, otherSecret]) {
      assert.equal(error.message.includes(value), false); assert.equal(error.stack.includes(value), false);
    }
    return true;
  });
}
async function envelope(payload, purpose = "code", options = {}) {
  const encoder = new TextEncoder();
  const material = await webcrypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"]);
  const derived = await webcrypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: encoder.encode("el-mundo-de-los-ninos/internal-recovery/v1"), info: encoder.encode(options.keyPurpose ?? purpose) },
    material, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const aad = encoder.encode(purpose === "code" ? `school-recovery-code.v1\0${options.email ?? base.email}` : "school-recovery-cookie.v1");
  const bytes = typeof payload === "string" ? encoder.encode(payload) : encoder.encode(JSON.stringify(payload));
  const encrypted = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad, tagLength: 128 }, derived, bytes);
  return (purpose === "code" ? "EMDNR1." : "EMDNRS1.") + Buffer.concat([iv, new Uint8Array(encrypted)]).toString("base64url");
}
async function fixture() {
  const created = await createInternalRecoveryCode(authorization, recoveryHash, secret, now);
  const identity = await readInternalRecoveryCode(created.code, base.email, secret, now);
  const { tokenHash: removed, ...receipt } = identity; assert.equal(removed, recoveryHash);
  const snapshot = { ...receipt, state: "issued", tokenDigest: await internalRecoveryTokenDigest(recoveryHash, secret), eligibility: "eligible" };
  return { ...created, identity, snapshot };
}

test("assisted recovery requires an active superadministrator and documented in-person verification", async () => {
  assert.deepEqual(validateInternalRecoveryAuthorization(authorization, now), base);
  const candidates = [
    patched(v => v.issuer.active = false), patched(v => v.issuer.roles = ["direccion"]), patched(v => v.issuer.roles = []),
    patched(v => v.issuer.roles = ["superadmin", "direccion"]), patched(v => v.issuer.id = v.target.id),
    patched(v => v.verification.method = "email-known"), patched(v => delete v.verification.reference),
    patched(v => v.verification.reference = "person-document-number"), patched(v => v.verification.verifiedAt = now + 1),
    patched(v => v.verification.verifiedAt = now - 600_001), patched(v => v.reservedAt = now + 1),
    patched(v => { v.reservedAt = now - 300_001; v.verification.verifiedAt = v.reservedAt; }),
    { email: base.email }, { ...authorization, verified: true },
  ];
  for (const value of candidates) await rejectsPrivate(() => createInternalRecoveryCode(value, recoveryHash, secret, now));
});

test("issuer MFA assurance is retained while target MFA/external identities/protected master remain excluded", async () => {
  assert.ok(validateInternalRecoveryAuthorization(patched(v => { v.issuer.hasMfa = true; v.issuer.assuranceLevel = "aal2"; }), now));
  for (const value of [patched(v => v.issuer.hasMfa = true), patched(v => v.issuer.assuranceLevel = "unknown"),
    patched(v => delete v.issuer.hasMfa), patched(v => v.target.hasMfa = true), patched(v => v.target.hasExternalIdentity = true),
    patched(v => v.target.protectedAccount = true), patched(v => v.target.roles = ["superadmin"]),
    patched(v => v.target.roles = ["docente", "superadmin"]), patched(v => v.target.roles = ["alumno"]),
    patched(v => v.target.roles = []), patched(v => delete v.target.hasMfa)]) {
    await rejectsPrivate(() => validateInternalRecoveryAuthorization(value, now));
  }
});

test("only established credentials or confirmed-but-unclaimed activation receive a code", async () => {
  const unclaimed = patched(v => { v.target.credentialState = "confirmed_unclaimed"; v.target.passwordPresent = false; v.target.priorProvisionState = "provisioned"; });
  assert.equal(validateInternalRecoveryAuthorization(unclaimed, now).purpose, "confirmed_activation_completion");
  const decoded = await readInternalRecoveryCode((await createInternalRecoveryCode(unclaimed, recoveryHash, secret, now)).code, base.email, secret, now);
  assert.equal(decoded.purpose, "confirmed_activation_completion");
  for (const value of [patched(v => v.target.active = false), patched(v => v.target.emailConfirmed = false),
    patched(v => v.target.passwordPresent = false), patched(v => v.target.passwordChangeUncertain = true),
    patched(v => v.target.credentialState = "claimed_or_uncertain"), patched(v => v.target.credentialState = "unconfirmed"),
    patched(v => v.target.priorProvisionState = "reissuing"), patched(v => v.target.priorProvisionState = "quarantined"),
    patched(v => v.target.priorProvisionState = "provisioned"), patched(v => { v.target.credentialState = "confirmed_unclaimed"; v.target.passwordPresent = false; }),
    patched(v => { v.target.credentialState = "confirmed_unclaimed"; v.target.priorProvisionState = "provisioned"; })]) {
    await rejectsPrivate(() => createInternalRecoveryCode(value, recoveryHash, secret, now));
  }
});

test("all ordinary singleton roles are admitted without deriving roles from the email", async () => {
  for (const role of ["docente", "tutor", "direccion"]) {
    const grant = patched(v => v.target.roles = [role]);
    const code = await createInternalRecoveryCode(grant, recoveryHash, secret, now);
    assert.equal((await readInternalRecoveryCode(code.code, base.email, secret, now)).role, role);
  }
});

test("code normalizes identifiers and email, encrypts the receipt and never embeds credentials as plaintext", async () => {
  const grant = patched(v => { v.target.email = " Teacher@Example.Test "; v.target.id = v.target.id.toUpperCase(); });
  const value = await createInternalRecoveryCode(grant, recoveryHash, secret, now);
  assert.match(value.code, /^EMDNR1\.[A-Za-z0-9_-]+$/); assert.ok(value.code.length <= 2_048);
  assert.equal(value.expiresAt, new Date(now + 1_800_000).toISOString());
  assert.deepEqual(await readInternalRecoveryCode(value.code, " TEACHER@example.test ", secret, now), { ...base, tokenHash: recoveryHash, issuedAt: now, expiresAt: now + 1_800_000 });
  const bytes = Buffer.from(value.code.slice(7), "base64url").toString("utf8");
  for (const field of [base.id, base.email, base.nonce, base.caseId, base.issuerId, base.verificationReference, recoveryHash]) {
    assert.equal(value.code.includes(field), false); assert.equal(bytes.includes(field), false);
  }
});

test("known email alone and wrong-email codes fail before any hypothetical provider call", async () => {
  const { code } = await fixture(); let providerCalls = 0;
  await rejectsPrivate(async () => { await readInternalRecoveryCode(code, "someone-else@example.test", secret, now); providerCalls++; });
  await rejectsPrivate(async () => { await createInternalRecoveryCode({ email: base.email }, recoveryHash, secret, now); providerCalls++; });
  assert.equal(providerCalls, 0);
});

test("random IVs produce different code/cookie envelopes for the same authorized case", async () => {
  const one = await createInternalRecoveryCode(authorization, recoveryHash, secret, now), two = await createInternalRecoveryCode(authorization, recoveryHash, secret, now);
  assert.notEqual(one.code, two.code);
  assert.notDeepEqual(Buffer.from(one.code.slice(7), "base64url").subarray(0, 12), Buffer.from(two.code.slice(7), "base64url").subarray(0, 12));
  assert.notEqual(await sealInternalRecoverySession(session, secret, now), await sealInternalRecoverySession(session, secret, now));
});

test("code expiry is closed exactly at thirty minutes and rejects a backwards clock", async () => {
  const { code } = await fixture();
  assert.equal((await readInternalRecoveryCode(code, base.email, secret, now + 1_799_999)).id, base.id);
  for (const instant of [now - 1, now + 1_800_000, now + 1_800_001]) await rejectsPrivate(() => readInternalRecoveryCode(code, base.email, secret, instant));
});

test("code rejects wrong keys and changes to IV, ciphertext or authentication tag", async () => {
  const { code } = await fixture(); await rejectsPrivate(() => readInternalRecoveryCode(code, base.email, otherSecret, now));
  const bytes = Buffer.from(code.slice(7), "base64url");
  for (const index of [0, 12, bytes.length - 1]) { const altered = Buffer.from(bytes); altered[index] ^= 1; await rejectsPrivate(() => readInternalRecoveryCode("EMDNR1." + altered.toString("base64url"), base.email, secret, now)); }
});

test("malformed identities, hashes and structured inputs fail with private generic errors", async () => {
  for (const grant of [patched(v => v.target.id = "../account"), patched(v => v.nonce = "broken"), patched(v => v.caseId = v.nonce),
    patched(v => v.issuer.id = "bad"), patched(v => v.target.email = "a..b@example.test"), patched(v => v.target.email = "a\n@example.test"),
    patched(v => v.target.email = "a".repeat(65) + "@example.test"), patched(v => v.target.email = "a".repeat(255) + "@example.test"),
    patched(v => v.target.refreshToken = "not-allowed")]) await rejectsPrivate(() => createInternalRecoveryCode(grant, recoveryHash, secret, now));
  for (const value of ["a".repeat(55), "a".repeat(57), "A".repeat(64), "x".repeat(64), null]) await rejectsPrivate(() => createInternalRecoveryCode(authorization, value, secret, now));
  for (const length of [56, 64]) assert.equal((await readInternalRecoveryCode((await createInternalRecoveryCode(authorization, "b".repeat(length), secret, now)).code, base.email, secret, now)).tokenHash.length, length);
});

test("UUID versions one through eight and RFC variants normalize consistently", async () => {
  for (const version of "12345678") {
    const grant = patched(v => v.target.id = `12345678-1234-${version}234-9234-123456789abc`);
    assert.equal(validateInternalRecoveryAuthorization(grant, now).id, grant.target.id);
  }
  for (const id of ["12345678-1234-0234-9234-123456789abc", "12345678-1234-4234-1234-123456789abc"]) await rejectsPrivate(() => validateInternalRecoveryAuthorization(patched(v => v.target.id = id), now));
});

test("secret preflight excludes provider keys, JWTs, controls and unbounded material", async () => {
  const jwt = `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from('{"role":"service_role"}').toString("base64url")}.${"x".repeat(43)}`;
  for (const value of [null, undefined, false, 123, {}, new String(secret), "", "x".repeat(42), "x".repeat(257), " " + secret, secret + "\n", secret + "\u0085", "sb_secret_" + "x".repeat(43), "sb_publishable_" + "x".repeat(43), jwt]) {
    assert.equal(isInternalRecoverySecret(value), false); await rejectsPrivate(() => createInternalRecoveryCode(authorization, recoveryHash, value, now));
  }
  for (const length of [43, 256]) assert.equal(isInternalRecoverySecret("k".repeat(length)), true);
});

test("keyed receipt differs from a public hash and changes with key/token material", async () => {
  const digest = await internalRecoveryTokenDigest(recoveryHash, secret); assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(await internalRecoveryTokenDigest(recoveryHash, secret), digest);
  assert.notEqual(digest, createHash("sha256").update(recoveryHash).digest("hex"));
  assert.notEqual(digest, await internalRecoveryTokenDigest(recoveryHash, otherSecret));
  assert.notEqual(digest, await internalRecoveryTokenDigest("b".repeat(64), secret));
  await rejectsPrivate(() => internalRecoveryTokenDigest("bad", secret));
});

test("envelopes reject noncanonical base64, wrong prefixes and oversized/truncated forms", async () => {
  const { code } = await fixture();
  for (const value of [null, "", "../private", "EMDNR2.token", "EMDNR1.a", "EMDNR1.!!!!", code + "=", code + "\n", "EMDNR1." + "x".repeat(2_048), "EMDNR1." + Buffer.alloc(29).toString("base64url")]) await rejectsPrivate(() => readInternalRecoveryCode(value, base.email, secret, now));
  const bytes = Buffer.alloc(31, 1), canonical = bytes.toString("base64url"), alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const alternate = canonical.slice(0, -1) + alphabet[alphabet.indexOf(canonical.at(-1)) + 1]; assert.deepEqual(Buffer.from(alternate, "base64url"), bytes);
  await rejectsPrivate(() => readInternalRecoveryCode("EMDNR1." + alternate, base.email, secret, now));
});

test("authenticated code plaintext still enforces purpose, role, proof and exact schema", async () => {
  for (const payload of [null, [], "not-json", codePayload({ kind: "invite" }), codePayload({ purpose: "magiclink" }),
    codePayload({ role: "superadmin" }), codePayload({ issuerId: base.id }), codePayload({ nonce: base.caseId }),
    codePayload({ email: "Teacher@example.test" }), codePayload({ id: "broken" }), codePayload({ ownerVerifiedAt: now + 1 }),
    codePayload({ ownerVerifiedAt: now - 600_001 }), codePayload({ verificationReference: "undocumented" }),
    codePayload({ extra: true }), codePayload({ tokenHash: "x".repeat(64) })]) await rejectsPrivate(async () => readInternalRecoveryCode(await envelope(payload), base.email, secret, now));
});

test("authenticated code timestamps are bounded integers with future/expired issuance rejected", async () => {
  for (const changes of [{ expiresAt: now }, { expiresAt: now + 1_800_001 }, { expiresAt: now + .5 }, { expiresAt: String(now + 1) },
    { issuedAt: now + 1 }, { issuedAt: -1 }, { issuedAt: "yesterday" }, { issuedAt: now - 1 }]) {
    await rejectsPrivate(async () => readInternalRecoveryCode(await envelope(codePayload(changes)), base.email, secret, now));
  }
});

test("cookies preserve a bounded owner recovery session without normal access/refresh credentials", async () => {
  const value = await sealInternalRecoverySession(session, secret, now);
  assert.match(value, /^EMDNRS1\.[A-Za-z0-9_-]+$/); assert.ok(value.length <= 3_800);
  assert.deepEqual(await readInternalRecoverySession(value, secret, now), session);
  const decoded = Buffer.from(value.slice(8), "base64url").toString("utf8");
  for (const part of [base.email, session.sessionId, session.accessToken, base.caseId]) { assert.equal(value.includes(part), false); assert.equal(decoded.includes(part), false); }
  await rejectsPrivate(() => sealInternalRecoverySession({ ...session, refreshToken: "never-store" }, secret, now));
  await rejectsPrivate(() => sealInternalRecoverySession({ ...session, tokenHash: recoveryHash }, secret, now));
});

test("cookie lifetime never extends past code expiry or ten minutes", async () => {
  const short = { ...session, codeExpiresAt: now + 1_000, expiresAt: now + 1_000 };
  const cookie = await sealInternalRecoverySession(short, secret, now);
  assert.equal((await readInternalRecoverySession(cookie, secret, now + 999)).id, base.id);
  await rejectsPrivate(() => readInternalRecoverySession(cookie, secret, now + 1_000));
  const regular = await sealInternalRecoverySession(session, secret, now);
  for (const instant of [now - 1, now + 600_000, now + 600_001]) await rejectsPrivate(() => readInternalRecoverySession(regular, secret, instant));
  for (const changes of [{ expiresAt: now }, { expiresAt: now + 600_001 }, { codeExpiresAt: now + 1, expiresAt: now + 2 }, { codeIssuedAt: now + 1 },
    { codeExpiresAt: now + 1_800_001 }, { sessionId: "broken" }, { accessToken: "short" }, { accessToken: "with space" }, { accessToken: "x".repeat(16_385) }, { accessToken: "x".repeat(16_384) }]) await rejectsPrivate(() => sealInternalRecoverySession({ ...session, ...changes }, secret, now));
});

test("cookie rejects tampering, wrong keys and strict malformed payloads", async () => {
  const cookie = await sealInternalRecoverySession(session, secret, now); await rejectsPrivate(() => readInternalRecoverySession(cookie, otherSecret, now));
  const bytes = Buffer.from(cookie.slice(8), "base64url"); bytes[12] ^= 1;
  await rejectsPrivate(() => readInternalRecoverySession("EMDNRS1." + bytes.toString("base64url"), secret, now));
  for (const changes of [{ kind: "recovery-code" }, { role: "superadmin" }, { email: "Teacher@example.test" }, { issuedAt: now + 1 },
    { issuedAt: now - 1 }, { accessToken: "a\nprivate" }, { sessionId: "bad" }, { expiresAt: now + 600_001 }, { extra: true }]) await rejectsPrivate(async () => readInternalRecoverySession(await envelope(sessionPayload(changes), "session"), secret, now));
  for (const value of [null, "", "EMDNRS1.a", cookie + "=", cookie + "\n", "EMDNRS1." + "x".repeat(3_800)]) await rejectsPrivate(() => readInternalRecoverySession(value, secret, now));
});

test("recovery code/cookie/receipt purposes cannot be swapped", async () => {
  const { code } = await fixture(), cookie = await sealInternalRecoverySession(session, secret, now);
  await rejectsPrivate(() => readInternalRecoveryCode(cookie.replace("EMDNRS1.", "EMDNR1."), base.email, secret, now));
  await rejectsPrivate(() => readInternalRecoverySession(code.replace("EMDNR1.", "EMDNRS1."), secret, now));
  for (const purpose of ["session", "receipt"]) await rejectsPrivate(async () => readInternalRecoveryCode(await envelope(codePayload(), "code", { keyPurpose: purpose }), base.email, secret, now));
  await rejectsPrivate(async () => readInternalRecoverySession(await envelope(sessionPayload(), "session", { keyPurpose: "code" }), secret, now));
});

test("activation and recovery remain cryptographically distinct even with the same application material", async () => {
  const activationIdentity = { id: base.id, email: base.email, role: base.role, nonce: base.nonce, tokenHash: recoveryHash };
  const activation = await createInternalActivationCode(activationIdentity, secret, now), recovery = await fixture();
  await rejectsPrivate(() => readInternalRecoveryCode(activation.code.replace("EMDN1.", "EMDNR1."), base.email, secret, now));
  await assert.rejects(() => readInternalActivationCode(recovery.code.replace("EMDNR1.", "EMDN1."), base.email, secret, now));
  const activationSession = { id: base.id, email: base.email, role: base.role, nonce: base.nonce, accessToken: session.accessToken, expiresAt: session.expiresAt };
  const cookie = await sealInternalActivationSession(activationSession, secret, now), recoveryCookie = await sealInternalRecoverySession(session, secret, now);
  await rejectsPrivate(() => readInternalRecoverySession(cookie.replace("EMDNS1.", "EMDNRS1."), secret, now));
  await assert.rejects(() => readInternalActivationSession(recoveryCookie.replace("EMDNRS1.", "EMDNS1."), secret, now));
});

test("code-consumption plan binds the private ledger receipt without disclosing tokenHash", async () => {
  const { identity, snapshot } = await fixture();
  const plan = await planInternalRecoveryCodeConsumption(snapshot, identity, secret, now);
  assert.deepEqual(plan, { caseId: base.caseId, nonce: base.nonce, targetId: base.id, expectedState: "issued", nextState: "verifying", tokenDigest: snapshot.tokenDigest });
  assert.equal(Object.isFrozen(plan), true); assert.equal(JSON.stringify(plan).includes(recoveryHash), false);
  assert.equal(snapshot.state, "issued"); // planning does not claim persistent one-use semantics.
});

test("consumption refuses replay/cancel/uncertainty and mismatched or stale authorization before verify", async () => {
  const { identity, snapshot } = await fixture(); let verifyCalls = 0;
  const candidates = ["reserved", "verifying", "changing", "completed", "cancelled", "uncertain"].map(state => ({ ...snapshot, state }));
  candidates.push({ ...snapshot, eligibility: "blocked" }, { ...snapshot, tokenDigest: "a".repeat(64) },
    { ...snapshot, nonce: session.sessionId }, { ...snapshot, caseId: session.sessionId }, { ...snapshot, role: "tutor" },
    { ...snapshot, email: "other@example.test" }, { ...snapshot, issuerId: session.sessionId },
    { ...snapshot, verificationReference: session.sessionId }, { ...snapshot, expiresAt: now + 1 });
  for (const current of candidates) await rejectsPrivate(async () => { await planInternalRecoveryCodeConsumption(current, identity, secret, now); verifyCalls++; });
  await rejectsPrivate(() => planInternalRecoveryCodeConsumption(snapshot, identity, otherSecret, now));
  await rejectsPrivate(() => planInternalRecoveryCodeConsumption(snapshot, identity, secret, now + 1_800_000));
  assert.equal(verifyCalls, 0);
});

test("two plans from one snapshot require an external atomic CAS; only one simulated winner contacts Auth", async () => {
  const { identity, snapshot } = await fixture();
  const plans = await Promise.all([planInternalRecoveryCodeConsumption(snapshot, identity, secret, now), planInternalRecoveryCodeConsumption(snapshot, identity, secret, now)]);
  let storedState = "issued", authCalls = 0;
  // Unit simulation only, NOT evidence that any DB transaction/RPC exists.
  for (const plan of plans) if (storedState === plan.expectedState) { storedState = plan.nextState; authCalls++; }
  assert.equal(storedState, "verifying"); assert.equal(authCalls, 1);
  await rejectsPrivate(() => planInternalRecoveryCodeConsumption({ ...snapshot, state: storedState }, identity, secret, now));
});

test("own-password plan requires a separate verifying-to-changing CAS and matching provisional session", async () => {
  const { snapshot } = await fixture(), current = { ...snapshot, state: "verifying" };
  assert.deepEqual(planInternalRecoveryPasswordClaim(current, session, now), { caseId: base.caseId, nonce: base.nonce, targetId: base.id, expectedState: "verifying", nextState: "changing", sessionId: session.sessionId });
  for (const state of ["reserved", "issued", "changing", "completed", "cancelled", "uncertain"]) await rejectsPrivate(() => planInternalRecoveryPasswordClaim({ ...current, state }, session, now));
  for (const changes of [{ nonce: session.sessionId }, { caseId: session.sessionId }, { role: "tutor" }, { issuerId: session.sessionId }, { codeExpiresAt: now + 1 }]) await rejectsPrivate(() => planInternalRecoveryPasswordClaim(current, { ...session, ...changes }, now));
  await rejectsPrivate(() => planInternalRecoveryPasswordClaim({ ...current, eligibility: "blocked" }, session, now));
  await rejectsPrivate(() => planInternalRecoveryPasswordClaim(current, session, now + 600_000));
});

test("public operations reject unsafe clocks using the same non-sensitive failure", async () => {
  const { code, identity, snapshot } = await fixture(), cookie = await sealInternalRecoverySession(session, secret, now);
  for (const instant of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await rejectsPrivate(() => validateInternalRecoveryAuthorization(authorization, instant));
    await rejectsPrivate(() => createInternalRecoveryCode(authorization, recoveryHash, secret, instant));
    await rejectsPrivate(() => readInternalRecoveryCode(code, base.email, secret, instant));
    await rejectsPrivate(() => sealInternalRecoverySession(session, secret, instant));
    await rejectsPrivate(() => readInternalRecoverySession(cookie, secret, instant));
    await rejectsPrivate(() => planInternalRecoveryCodeConsumption(snapshot, identity, secret, instant));
    await rejectsPrivate(() => planInternalRecoveryPasswordClaim({ ...snapshot, state: "verifying" }, session, instant));
  }
  assert.deepEqual(INTERNAL_RECOVERY_LIMITS, { codeLength: 2_048, sessionLength: 3_800, codeTtlMs: 1_800_000, sessionTtlMs: 600_000, reservationTtlMs: 300_000, verificationTtlMs: 600_000 });
});

test("pure module has no provider/env/DB calls, logging, Node crypto, memory consumption cache or admin reset", async () => {
  const source = await readFile(new URL("../lib/supabase/internal-recovery-code.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /node:crypto|process\.env|console\.|\bfetch\s*\(|admin\.updateUser|new (?:Set|Map)\(/);
  assert.match(source, /crypto\.subtle\.deriveKey/); assert.match(source, /crypto\.getRandomValues\(new Uint8Array\(12\)\)/);
  assert.match(source, /private.*RPC|PRIVATE RPC/); assert.match(source, /presencial/);
});
