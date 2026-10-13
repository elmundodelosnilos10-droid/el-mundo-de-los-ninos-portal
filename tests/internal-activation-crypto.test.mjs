import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { webcrypto } from "node:crypto";
import {
  createInternalActivationCode,
  readInternalActivationCode,
  sealInternalActivationSession,
  readInternalActivationSession,
  isInternalActivationSecret,
} from "../lib/supabase/internal-activation.ts";

const secret = "synthetic-school-activation-secret-for-tests-2026";
const otherSecret = "another-synthetic-school-activation-secret-for-tests";
const now = Date.UTC(2026, 9, 12, 12);
const identity = {
  id: "12345678-1234-4234-9234-123456789abc",
  email: "teacher@example.test",
  role: "docente",
  nonce: "87654321-4321-4321-a321-cba987654321",
  tokenHash: "a1".repeat(32),
};
const session = {
  id: identity.id, email: identity.email, role: identity.role, nonce: identity.nonce,
  accessToken: "synthetic-access-token-for-test-only", expiresAt: now + 600_000,
};
const failure = "No se pudo validar la activación.";

async function rejectsPrivate(operation) {
  await assert.rejects(operation, error => {
    assert.equal(error.message, failure);
    assert.equal(Object.hasOwn(error, "cause"), false);
    for (const sensitive of [identity.email, identity.tokenHash, session.accessToken, secret, otherSecret]) {
      assert.equal(error.message.includes(sensitive), false);
      assert.equal(error.stack.includes(sensitive), false);
    }
    return true;
  });
}

// Forge authenticated envelopes only with synthetic fixture material to exercise payload validation.
async function envelope(payload, purpose = "acode", email = identity.email, options = {}) {
  const encoder = new TextEncoder();
  const keyMaterial = await webcrypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"]);
  const key = await webcrypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256",
    salt: encoder.encode("el-mundo-de-los-ninos/internal-activation/v1"), info: encoder.encode(options.keyPurpose ?? purpose) },
  keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const aad = encoder.encode(purpose === "acode" ? `school-activation-code.v1\0${email}` : "school-activation-cookie.v1");
  const plaintext = typeof payload === "string" ? encoder.encode(payload) : encoder.encode(JSON.stringify(payload));
  const encrypted = new Uint8Array(await webcrypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad, tagLength: 128 }, key, plaintext));
  return (purpose === "acode" ? "EMDN1." : "EMDNS1.") + Buffer.concat([iv, encrypted]).toString("base64url");
}

function codePayload(changes = {}) {
  return { kind: "code", ...identity, issuedAt: now, expiresAt: now + 1_800_000, ...changes };
}

function sessionPayload(changes = {}) {
  return { kind: "session", ...session, issuedAt: now, ...changes };
}

test("activation encrypts and recovers only the normalized intended identity", async () => {
  const { code, expiresAt } = await createInternalActivationCode({ ...identity, email: " Teacher@Example.test " }, secret, now);
  assert.match(code, /^EMDN1\.[A-Za-z0-9_-]+$/);
  assert.equal(expiresAt, new Date(now + 1_800_000).toISOString());
  assert.deepEqual(await readInternalActivationCode(code, " TEACHER@example.test ", secret, now), { ...identity, expiresAt: now + 1_800_000 });
  assert.ok(code.length <= 2_048);
  const binary = Buffer.from(code.slice(6), "base64url").toString("utf8");
  for (const value of [identity.id, identity.email, identity.role, identity.nonce, identity.tokenHash]) {
    assert.equal(code.includes(value), false);
    assert.equal(binary.includes(value), false);
  }
});

test("code email mismatch fails before a consumer can verify the Auth token", async () => {
  const { code } = await createInternalActivationCode(identity, secret, now);
  let consumerCalls = 0;
  await rejectsPrivate(async () => {
    const value = await readInternalActivationCode(code, "someone-else@example.test", secret, now);
    consumerCalls++;
    return value;
  });
  assert.equal(consumerCalls, 0);
});

test("random IV prevents equal activations and equal cookies from producing equal envelopes", async () => {
  const first = await createInternalActivationCode(identity, secret, now);
  const second = await createInternalActivationCode(identity, secret, now);
  assert.notEqual(first.code, second.code);
  assert.notDeepEqual(Buffer.from(first.code.slice(6), "base64url").subarray(0, 12), Buffer.from(second.code.slice(6), "base64url").subarray(0, 12));
  assert.notEqual(await sealInternalActivationSession(session, secret, now), await sealInternalActivationSession(session, secret, now));
});

test("activation is valid just before expiry and closed at the exact expiry", async () => {
  const { code } = await createInternalActivationCode(identity, secret, now);
  assert.equal((await readInternalActivationCode(code, identity.email, secret, now + 1_799_999)).id, identity.id);
  for (const instant of [now - 1, now + 1_800_000, now + 1_800_001]) {
    await rejectsPrivate(() => readInternalActivationCode(code, identity.email, secret, instant));
  }
});

test("activation rejects a different secret or changes to IV, ciphertext and authentication tag", async () => {
  const { code } = await createInternalActivationCode(identity, secret, now);
  await rejectsPrivate(() => readInternalActivationCode(code, identity.email, otherSecret, now));
  const bytes = Buffer.from(code.slice(6), "base64url");
  for (const index of [0, 12, bytes.length - 1]) {
    const altered = Buffer.from(bytes);
    altered[index] ^= 1;
    await rejectsPrivate(() => readInternalActivationCode(`EMDN1.${altered.toString("base64url")}`, identity.email, secret, now));
  }
});

test("activation input rejects malformed identifiers, nonce, email, hashes and privileged roles", async () => {
  for (const changes of [
    { id: "../accounts/123" }, { id: "12345678-1234-0234-9234-123456789abc" },
    { nonce: "12345678-1234-4234-1234-123456789abc" }, { nonce: "not-a-nonce" },
    { role: "superadmin" }, { role: "admin" }, { role: "alumno" },
    { email: "missing-domain" }, { email: "a\n@example.test" }, { email: "a..b@example.test" },
    { email: `${"a".repeat(65)}@example.test` }, { email: `${"a".repeat(255)}@example.test` },
    { tokenHash: "a".repeat(55) }, { tokenHash: "a".repeat(57) }, { tokenHash: "a".repeat(65) },
    { tokenHash: "G".repeat(64) }, { tokenHash: "A".repeat(64) }, { tokenHash: "a ".repeat(32) },
    { refreshToken: "private-refresh-token" },
  ]) await rejectsPrivate(() => createInternalActivationCode({ ...identity, ...changes }, secret, now));
});

test("both supported Auth hash lengths and all admitted school roles survive encryption", async () => {
  for (const role of ["docente", "tutor", "direccion"]) {
    for (const length of [56, 64]) {
      const value = { ...identity, role, tokenHash: "b".repeat(length) };
      const { code } = await createInternalActivationCode(value, secret, now);
      assert.deepEqual(await readInternalActivationCode(code, identity.email, secret, now), { ...value, expiresAt: now + 1_800_000 });
    }
  }
});

test("UUID versions one through eight are accepted only with the RFC variant", async () => {
  for (const version of "12345678") {
    const value = { ...identity, id: `12345678-1234-${version}234-9234-123456789abc` };
    const { code } = await createInternalActivationCode(value, secret, now);
    assert.equal((await readInternalActivationCode(code, identity.email, secret, now)).id, value.id);
  }
});

test("secret must be independent, bounded and free from whitespace or control characters", async () => {
  const jwt = `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from('{"role":"service_role"}').toString("base64url")}.${"x".repeat(43)}`;
  for (const value of ["", "x".repeat(42), "x".repeat(257), ` ${secret}`, `${secret}\n`, `${secret}\0`, `${secret}\u0085`,
    `sb_secret_${"x".repeat(43)}`, `sb_publishable_${"x".repeat(43)}`, jwt]) {
    assert.equal(isInternalActivationSecret(value), false);
    await rejectsPrivate(() => createInternalActivationCode(identity, value, now));
    await rejectsPrivate(() => sealInternalActivationSession(session, value, now));
  }
  for (const length of [43, 256]) {
    const value = "k".repeat(length);
    assert.equal(isInternalActivationSecret(value), true);
    const { code } = await createInternalActivationCode(identity, value, now);
    assert.equal((await readInternalActivationCode(code, identity.email, value, now)).id, identity.id);
  }
});

test("secret preflight is synchronous and rejects non-string configuration before creating identities", () => {
  for (const value of [undefined, null, 123, false, {}, [], new String(secret)]) {
    assert.equal(isInternalActivationSecret(value), false);
  }
  assert.equal(isInternalActivationSecret(secret), true);
  const inviteCalls = [];
  function provision(configuredSecret) {
    if (!isInternalActivationSecret(configuredSecret)) return "configuration-required";
    inviteCalls.push("invite");
    return "ready";
  }
  assert.equal(provision("not-configured"), "configuration-required");
  assert.deepEqual(inviteCalls, []);
  assert.equal(provision(secret), "ready");
  assert.deepEqual(inviteCalls, ["invite"]);
});

test("malformed, oversized and noncanonical code envelopes fail without revealing details", async () => {
  const { code } = await createInternalActivationCode(identity, secret, now);
  for (const value of [null, "", "../secret", "EMDN2.token", "EMDN1.a", "EMDN1.!!!!", "EMDN1." + "x".repeat(2_048),
    code + "=", code + "\n", code.replace("EMDN1.", "EMDNS1."), "EMDN1." + Buffer.alloc(29).toString("base64url")]) {
    await rejectsPrivate(() => readInternalActivationCode(value, identity.email, secret, now));
  }
  // Change only unused base64 bits; accepting this would produce a second spelling for the same token.
  const bytes = Buffer.alloc(31, 1);
  const canonical = bytes.toString("base64url");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const altered = canonical.slice(0, -1) + alphabet[alphabet.indexOf(canonical.at(-1)) + 1];
  assert.deepEqual(Buffer.from(altered, "base64url"), bytes);
  await rejectsPrivate(() => readInternalActivationCode(`EMDN1.${altered}`, identity.email, secret, now));
});

test("authenticated code plaintext still requires the exact schema and correct kind", async () => {
  const valid = codePayload();
  const { nonce: omittedNonce, ...withoutNonce } = valid;
  assert.ok(omittedNonce);
  const candidates = [null, [], "not-json", { ...valid, kind: "session" }, { ...valid, role: "superadmin" },
    { ...valid, email: "Teacher@example.test" }, { ...valid, email: "someone-else@example.test" },
    { ...valid, tokenHash: "x".repeat(64) }, { ...valid, id: "broken" }, { ...valid, nonce: "broken" },
    { ...valid, extra: "ignored-value" }, withoutNonce];
  for (const value of candidates) {
    await rejectsPrivate(async () => readInternalActivationCode(await envelope(value), identity.email, secret, now));
  }
});

test("authenticated code expiry must remain a bounded integer with a valid issuance time", async () => {
  for (const changes of [{ expiresAt: now }, { expiresAt: now + 1_800_001 }, { expiresAt: now + 0.5 },
    { expiresAt: String(now + 60_000) }, { issuedAt: now + 1 }, { issuedAt: -1 },
    { issuedAt: now - 1, expiresAt: now + 1_800_000 }, { issuedAt: "yesterday" }]) {
    await rejectsPrivate(async () => readInternalActivationCode(await envelope(codePayload(changes)), identity.email, secret, now));
  }
});

test("cookies encrypt opaque access tokens with their own prefix and bounded expiry", async () => {
  const value = await sealInternalActivationSession({ ...session, email: " TEACHER@EXAMPLE.TEST " }, secret, now);
  assert.match(value, /^EMDNS1\.[A-Za-z0-9_-]+$/);
  assert.ok(value.length <= 3_800);
  assert.deepEqual(await readInternalActivationSession(value, secret, now), session);
  const plaintext = Buffer.from(value.slice(7), "base64url").toString("utf8");
  for (const sensitive of [session.email, session.accessToken, session.id, session.nonce]) {
    assert.equal(value.includes(sensitive), false);
    assert.equal(plaintext.includes(sensitive), false);
  }
});

test("cookies fail at exact expiry, before issuance, with a wrong key and after tampering", async () => {
  const value = await sealInternalActivationSession(session, secret, now);
  assert.equal((await readInternalActivationSession(value, secret, now + 599_999)).id, session.id);
  for (const instant of [now - 1, now + 600_000, now + 600_001]) {
    await rejectsPrivate(() => readInternalActivationSession(value, secret, instant));
  }
  await rejectsPrivate(() => readInternalActivationSession(value, otherSecret, now));
  const bytes = Buffer.from(value.slice(7), "base64url");
  bytes[bytes.length - 1] ^= 1;
  await rejectsPrivate(() => readInternalActivationSession(`EMDNS1.${bytes.toString("base64url")}`, secret, now));
});

test("cookie creation rejects oversized ciphertext, invalid tokens, excessive expiry and extra fields", async () => {
  for (const changes of [{ expiresAt: now }, { expiresAt: now + 600_001 }, { expiresAt: NaN },
    { accessToken: "short" }, { accessToken: "x".repeat(16_385) }, { accessToken: "x".repeat(16_384) },
    { accessToken: "token\nprivate" }, { accessToken: "token private" }, { accessToken: "tokenéprivate" },
    { role: "superadmin" }, { refreshToken: "must-not-be-stored" }]) {
    await rejectsPrivate(() => sealInternalActivationSession({ ...session, ...changes }, secret, now));
  }
  const minimal = { ...session, accessToken: "12345678", expiresAt: now + 1 };
  assert.deepEqual(await readInternalActivationSession(await sealInternalActivationSession(minimal, secret, now), secret, now), minimal);
});

test("authenticated cookie plaintext is strict even if an attacker knows test key material", async () => {
  for (const changes of [{ kind: "code" }, { role: "superadmin" }, { email: "Teacher@example.test" },
    { id: "broken" }, { nonce: "broken" }, { accessToken: "tiny" }, { accessToken: "has space" },
    { accessToken: false }, { expiresAt: now }, { expiresAt: now + 600_001 }, { issuedAt: now + 1 },
    { issuedAt: now - 1 }, { extra: "unexpected" }]) {
    await rejectsPrivate(async () => readInternalActivationSession(await envelope(sessionPayload(changes), "cookie"), secret, now));
  }
});

test("purpose-separated HKDF and AAD prevent exchanging code and cookie envelopes", async () => {
  const { code } = await createInternalActivationCode(identity, secret, now);
  const cookie = await sealInternalActivationSession(session, secret, now);
  await rejectsPrivate(() => readInternalActivationCode(cookie.replace("EMDNS1.", "EMDN1."), identity.email, secret, now));
  await rejectsPrivate(() => readInternalActivationSession(code.replace("EMDN1.", "EMDNS1."), secret, now));
  await rejectsPrivate(async () => readInternalActivationCode(await envelope(codePayload(), "acode", identity.email, { keyPurpose: "cookie" }), identity.email, secret, now));
  await rejectsPrivate(async () => readInternalActivationSession(await envelope(sessionPayload(), "cookie", identity.email, { keyPurpose: "acode" }), secret, now));
});

test("cookie reader rejects malformed, oversized and noncanonical forms", async () => {
  const cookie = await sealInternalActivationSession(session, secret, now);
  for (const value of [undefined, "", "EMDNS1.a", "EMDNS1.???", "EMDNS2.private", cookie + "=", cookie + "\n",
    "EMDNS1." + "x".repeat(3_800), "EMDNS1." + Buffer.alloc(29).toString("base64url")]) {
    await rejectsPrivate(() => readInternalActivationSession(value, secret, now));
  }
});

test("all public operations reject unsafe clock values using the same private error", async () => {
  const { code } = await createInternalActivationCode(identity, secret, now);
  const cookie = await sealInternalActivationSession(session, secret, now);
  for (const instant of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await rejectsPrivate(() => createInternalActivationCode(identity, secret, instant));
    await rejectsPrivate(() => readInternalActivationCode(code, identity.email, secret, instant));
    await rejectsPrivate(() => sealInternalActivationSession(session, secret, instant));
    await rejectsPrivate(() => readInternalActivationSession(cookie, secret, instant));
  }
  await rejectsPrivate(() => createInternalActivationCode(identity, secret, Number.MAX_SAFE_INTEGER));
});

test("crypto helper has no provider calls, environment reads, Node-only crypto or credential logs", async () => {
  const source = await readFile(new URL("../lib/supabase/internal-activation.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /node:crypto|process\.env|console\.|\bfetch\s*\(/);
  assert.match(source, /crypto\.subtle\.deriveKey/);
  assert.match(source, /crypto\.getRandomValues\(new Uint8Array\(12\)\)/);
});
