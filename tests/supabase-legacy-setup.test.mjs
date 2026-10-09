import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url);

function loadSetup(file, environment) {
  const stats = { databaseCalls: 0, authCalls: 0 };
  const dependencies = {
    "@/lib/runtime/env": { env: environment }, "drizzle-orm": {}, "@/db/schema": {}, "zod": require("zod"),
    "@/db": { getDb() { stats.databaseCalls++; throw Error("Legacy DB must not be touched"); } },
    "@/lib/auth": { getAuth() { stats.authCalls++; throw Error("Legacy Auth must not be touched"); } },
    "@/lib/access": { errorResponse: (status, message) => Response.json({ error: message }, { status }) },
  };
  const moduleCache = new Map();
  function load(path) {
    if (moduleCache.has(path)) return moduleCache.get(path).exports;
    const sandboxModule = { exports: {} }; moduleCache.set(path, sandboxModule);
    const source = ts.transpileModule(fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const requireMock = name => {
      if (dependencies[name]) return dependencies[name];
      if (name === "@/lib/supabase/auth-route-utils") return load("lib/supabase/auth-route-utils.ts");
      throw Error(`Unexpected dependency ${name}`);
    };
    vm.runInContext(source, vm.createContext({ module: sandboxModule, exports: sandboxModule.exports, require: requireMock, Response, URL, TextEncoder }), { filename: path });
    return sandboxModule.exports;
  }
  return { stats, ...load(file) };
}

for (const file of ["app/api/setup/route.ts", "app/api/school-password-setup/route.ts"]) {
  test(`${file}: Supabase mode rejects legacy bootstrap before credentials, bodies or D1/Auth writes`, async () => {
    for (const environment of [{ SCHOOL_AUTH_PROVIDER: "supabase" }, { SCHOOL_AUTH_PROVIDER: "d1", SCHOOL_DATA_PROVIDER: "supabase" }]) {
      const runtime = loadSetup(file, environment);
      const response = await runtime.POST(new Request("https://portal.example.test/api/setup", { method: "POST", headers: { origin: "https://portal.example.test" }, body: "invalid-json" }));
      assert.equal(response.status, 409);
      assert.equal(runtime.stats.databaseCalls, 0);
      assert.equal(runtime.stats.authCalls, 0);
      assert.doesNotMatch(await response.text(), /aún no está conectado|Legacy DB|Legacy Auth/);
    }
  });
}

test("legacy setup remains gated by its existing private token when both providers use D1", async () => {
  const runtime = loadSetup("app/api/setup/route.ts", { SCHOOL_AUTH_PROVIDER: "d1", SCHOOL_DATA_PROVIDER: "d1" });
  const response = await runtime.POST(new Request("https://portal.example.test/api/setup", { method: "POST", headers: { origin: "https://portal.example.test" } }));
  assert.equal(response.status, 403);
  assert.equal(runtime.stats.databaseCalls, 0);
  assert.equal(runtime.stats.authCalls, 0);
});
