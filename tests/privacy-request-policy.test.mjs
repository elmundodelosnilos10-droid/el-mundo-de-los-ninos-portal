import assert from "node:assert/strict";
import test from "node:test";
import { canTransitionPrivacyRequest } from "../lib/privacy-request-policy.ts";

test("una solicitud recibida pasa a revisión, respuesta o cierre", () => {
  assert.equal(canTransitionPrivacyRequest("recibida", "en_revision"), true);
  assert.equal(canTransitionPrivacyRequest("recibida", "respondida"), true);
  assert.equal(canTransitionPrivacyRequest("recibida", "cerrada"), true);
});

test("una solicitud en revisión puede responderse o cerrarse", () => {
  assert.equal(canTransitionPrivacyRequest("en_revision", "respondida"), true);
  assert.equal(canTransitionPrivacyRequest("en_revision", "cerrada"), true);
});

test("una solicitud respondida solo puede cerrarse", () => {
  assert.equal(canTransitionPrivacyRequest("respondida", "cerrada"), true);
  assert.equal(canTransitionPrivacyRequest("respondida", "en_revision"), false);
  assert.equal(canTransitionPrivacyRequest("respondida", "respondida"), false);
});

test("una solicitud cerrada no admite más cambios", () => {
  assert.equal(canTransitionPrivacyRequest("cerrada", "en_revision"), false);
  assert.equal(canTransitionPrivacyRequest("cerrada", "respondida"), false);
  assert.equal(canTransitionPrivacyRequest("cerrada", "cerrada"), false);
});
