import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mutations = [
  ["PATCH", "../app/api/notifications/route.ts"],
  ["POST", "../app/api/files/route.ts"],
  ["PATCH", "../app/api/submissions/[id]/route.ts"],
  ["POST", "../app/api/tasks/route.ts"],
  ["POST", "../app/api/tasks/[id]/submissions/route.ts"],
  ["DELETE", "../app/api/materials/[id]/route.ts"],
  ["POST", "../app/api/materials/[id]/replace/route.ts"],
  ["POST", "../app/api/conversations/route.ts"],
  ["POST", "../app/api/conversations/[id]/messages/route.ts"],
  ["POST", "../app/api/conversations/[id]/messages/read/route.ts"],
  ["POST", "../app/api/announcements/route.ts"],
  ["POST", "../app/api/announcements/[id]/read/route.ts"],
];

test("school task, file, message, and notification mutations require a same-origin request before processing", async t => {
  for (const [method, relativePath] of mutations) {
    await t.test(`${method} ${relativePath}`, async () => {
      const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
      assert.match(source, /import\s+\{\s*isSameOriginAuthRequest\s*\}\s+from\s+"@\/lib\/supabase\/auth-route-utils";/);
      const handlerStartsWithGuard = new RegExp(
        `export async function ${method}\\([^\\n]*\\) \\{\\n\\s*if \\(!isSameOriginAuthRequest\\(request\\)\\) return errorResponse\\(403, "Solicitud no válida\\."\\);`,
      );
      assert.match(source, handlerStartsWithGuard);
    });
  }
});
