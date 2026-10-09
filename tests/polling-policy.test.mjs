import assert from "node:assert/strict";
import test from "node:test";
import { chatPollDelayForFailures, CHAT_POLL_BASE_DELAY_MS, CHAT_POLL_MAX_DELAY_MS } from "../lib/polling-policy.ts";

test("el chat consulta cada diez segundos al iniciar y después de recuperarse", () => {
  assert.equal(chatPollDelayForFailures(0), CHAT_POLL_BASE_DELAY_MS);
});

test("los reintentos aumentan gradualmente mientras no haya conexión", () => {
  assert.deepEqual([0, 1, 2, 3].map(chatPollDelayForFailures), [10_000, 20_000, 40_000, 60_000]);
});

test("el intervalo de reintento nunca supera un minuto", () => {
  assert.equal(chatPollDelayForFailures(4), CHAT_POLL_MAX_DELAY_MS);
  assert.equal(chatPollDelayForFailures(100), CHAT_POLL_MAX_DELAY_MS);
});

test("los contadores inválidos no producen intervalos negativos", () => {
  assert.equal(chatPollDelayForFailures(-3), CHAT_POLL_BASE_DELAY_MS);
  assert.equal(chatPollDelayForFailures(Number.NaN), CHAT_POLL_BASE_DELAY_MS);
});
