import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canAccessConversation } from "../lib/conversation-access-policy.ts";

const state = {
  guardianUserId: "guardian-user",
  teacherUserId: "teacher-user",
  guardianActive: true,
  teacherActive: true,
  studentActive: true,
  studentGuardianActive: true,
};

test("tutor conversation access is revoked when the student-guardian link is inactive", () => {
  assert.equal(canAccessConversation(state, "guardian-user", ["tutor"]), true);
  assert.equal(canAccessConversation({ ...state, studentGuardianActive: false }, "guardian-user", ["tutor"]), false);
  assert.equal(canAccessConversation({ ...state, studentGuardianActive: null }, "guardian-user", ["tutor"]), false);
  assert.equal(canAccessConversation(state, "another-guardian", ["tutor"]), false);
});

test("only an active conversation participant can read the thread", () => {
  assert.equal(canAccessConversation(state, "teacher-user", ["docente"]), true);
  assert.equal(canAccessConversation({ ...state, guardianActive: false }, "teacher-user", ["docente"]), false);
  assert.equal(canAccessConversation({ ...state, teacherActive: false }, "guardian-user", ["tutor"]), false);
  assert.equal(canAccessConversation({ ...state, studentActive: false }, "guardian-user", ["tutor"]), false);
  assert.equal(canAccessConversation(state, "unrelated-user", ["direccion"]), false);
});

test("conversation list and message-file download routes enforce participant access", async () => {
  const conversationList = await readFile(new URL("../app/api/conversations/route.ts", import.meta.url), "utf8");
  const messageRoute = await readFile(new URL("../app/api/conversations/[id]/messages/route.ts", import.meta.url), "utf8");
  const fileRoute = await readFile(new URL("../app/api/files/[id]/route.ts", import.meta.url), "utf8");

  assert.match(conversationList, /innerJoin\(studentGuardians, and\([\s\S]*?eq\(studentGuardians\.active, true\)\)\)/);
  assert.equal((messageRoute.match(/authorizedConversation\(id, actor\.id, actor\.roles\)/g) ?? []).length, 2);
  assert.match(fileRoute, /if \(file\.purpose === "message"\)[\s\S]*?messages\.fileId[\s\S]*?authorizedConversation\(message\[0\]\.conversationId, actor\.id, actor\.roles\)[\s\S]*?const object = await getSchoolFile\(env, file\.objectKey\)/);
});
