import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_COMMUNICATION_HOURS, isWithinCommunicationHours } from "../lib/communication-hours-policy.ts";

test("el horario queda abierto hasta que la escuela lo active", () => {
  assert.equal(isWithinCommunicationHours(DEFAULT_COMMUNICATION_HOURS, new Date("2026-06-07T05:00:00Z")), true);
});

test("aplica días y límites de hora inclusivo al inicio y exclusivo al final", () => {
  const settings = { enabled: true, weekdays: [1, 2, 3, 4, 5], startTime: "08:00", endTime: "15:00" };
  assert.equal(isWithinCommunicationHours(settings, new Date("2026-06-01T14:00:00Z")), true);
  assert.equal(isWithinCommunicationHours(settings, new Date("2026-06-01T20:59:00Z")), true);
  assert.equal(isWithinCommunicationHours(settings, new Date("2026-06-01T21:00:00Z")), false);
  assert.equal(isWithinCommunicationHours(settings, new Date("2026-06-07T16:00:00Z")), false);
});

test("interpreta el horario usando la zona de Ciudad de México", () => {
  const settings = { enabled: true, weekdays: [1, 2, 3, 4, 5], startTime: "08:00", endTime: "17:00" };
  assert.equal(isWithinCommunicationHours(settings, new Date("2026-06-01T13:59:00Z")), false);
  assert.equal(isWithinCommunicationHours(settings, new Date("2026-06-01T14:00:00Z")), true);
});
