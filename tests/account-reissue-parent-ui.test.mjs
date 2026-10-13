import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../app/cuentas/account-manager.tsx", import.meta.url), "utf8");
const start = source.indexOf("  function canMutate() {");
const end = source.indexOf("  async function change(", start);
assert.ok(start > 0 && end > start);

function harness() {
  const updates = [];
  const context = {
    alive: { current: true }, access: { current: true },
    mutationLock: { current: false }, reviewLock: { current: false },
    listRequest: { current: null }, lifecycle: { current: 7 },
    setBusy: value => updates.push(["busy", value]),
    setError: () => {}, setMessage: () => {},
    setActivationReceipt: () => {}, setCopyMessage: () => {},
  };
  const begin = vm.runInNewContext(`${source.slice(start, end)}; beginReissueOperation;`, context);
  return { context, updates, begin };
}

test("reissuing a pending activation acquires the same synchronous lock as account edits", () => {
  const { context, begin, updates } = harness();
  const release = begin();
  assert.equal(typeof release, "function");
  assert.equal(context.mutationLock.current, true);
  assert.equal(begin(), null);
  assert.deepEqual(updates, [["busy", true]]);
  release(); release();
  assert.equal(context.mutationLock.current, false);
  assert.deepEqual(updates, [["busy", true], ["busy", false]]);
});

test("pending reads, revoked access and uncertain results prevent another reissue", () => {
  for (const [reference, value] of [["listRequest", {}], ["reviewLock", true], ["access", false], ["alive", false], ["mutationLock", true]]) {
    const { context, begin, updates } = harness();
    context[reference].current = value;
    assert.equal(begin(), null);
    assert.deepEqual(updates, []);
  }
});

test("a stale child release cannot unlock a later account operation", () => {
  const { context, begin, updates } = harness();
  const release = begin();
  context.lifecycle.current++;
  context.mutationLock.current = true;
  release();
  assert.equal(context.mutationLock.current, true);
  assert.deepEqual(updates, [["busy", true]]);
});

test("release after revoked access does not update the removed account interface", () => {
  const { context, begin, updates } = harness();
  const release = begin();
  context.access.current = false;
  release();
  assert.deepEqual(updates, [["busy", true]]);
});

test("only active unprotected accounts render the control and unrelated changes clear its private receipt", () => {
  assert.match(source, /useInternalActivation && person\.active && !protectedAccount && <InternalReissueControl/);
  assert.match(source, /person\.id === actorId \|\| person\.role === "superadmin"/);
  assert.match(source, /contextKey=\{`\$\{activationContext\}:\$\{person\.role\}:\$\{person\.active\}:\$\{reissueContextVersion\}`\}/);
  assert.match(source, /key=\{`\$\{activationContext\}:\$\{person\.id\}:\$\{person\.email\}:\$\{person\.role\}:\$\{person\.active\}:\$\{reissueContextVersion\}`\}/);
  assert.match(source.slice(end), /setReissueContextVersion\(value => value \+ 1\)/);
  assert.doesNotMatch(source.slice(start, end), /setReissueContextVersion/);
  assert.match(source, /onUnauthorized=\{revokeAccess\}/);
  assert.match(source, /onUncertain=\{requireReview\}/);
});
