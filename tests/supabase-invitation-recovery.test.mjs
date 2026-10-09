import assert from "node:assert/strict";
import test from "node:test";
import { checkInvitationIdentity } from "../lib/supabase/invitation-recovery.ts";

test("reconoce la identidad aunque Auth devuelva el correo con otra capitalización", async () => {
  const state = await checkInvitationIdentity(" Family@Example.test ", async () => [
    { id: "auth-user", email: "family@example.test" },
  ]);
  assert.equal(state, "present");
});

test("solo considera ausente la identidad cuando la consulta Auth termina correctamente", async () => {
  const state = await checkInvitationIdentity("family@example.test", async () => []);
  assert.equal(state, "absent");
});

test("conserva estado desconocido cuando no se puede confirmar el resultado remoto", async () => {
  const state = await checkInvitationIdentity("family@example.test", async () => {
    throw new Error("synthetic timeout");
  });
  assert.equal(state, "unknown");
  assert.notEqual(state, "absent");
});
