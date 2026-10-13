import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const read = name => fs.readFileSync(new URL("../" + name, import.meta.url), "utf8");
function loadTransport(file, dependencies, globals = {}) {
  const compiledModule = { exports: {} };
  const source = ts.transpileModule(read(file), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(source, { module: compiledModule, exports: compiledModule.exports, require: name => {
    assert.ok(Object.hasOwn(dependencies, name), "Unexpected runtime dependency");
    return dependencies[name];
  }, URL, ...globals });
  return compiledModule.exports.schoolRealtimeTransport;
}
function nodeTransport() {
  const calls = [];
  class FixtureWebSocket {
    constructor(address, protocols, options) { calls.push({ address, protocols, options }); this.readyState = 0; }
    close(...args) { calls.push({ close: args }); }
    send(data) { calls.push({ send: data }); }
  }
  return { calls, FixtureWebSocket, Transport: loadTransport("lib/runtime/realtime-transport.ts", { ws: { __esModule: true, default: FixtureWebSocket } }) };
}

test("Node SDK transport delegates to ws with one dedicated bounded Upgrade connection", () => {
  const { calls, FixtureWebSocket, Transport } = nodeTransport();
  const url = new URL("wss://school.example.test/realtime/v1/websocket");
  const socket = new Transport(url, ["synthetic-protocol"]);
  assert.ok(socket instanceof FixtureWebSocket);
  assert.equal(calls[0].address, url);
  assert.deepEqual([...calls[0].protocols], ["synthetic-protocol"]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].options)), {
    agent: false, followRedirects: false, handshakeTimeout: 10000, closeTimeout: 1000, perMessageDeflate: false,
  });
  assert.ok(!Object.hasOwn(calls[0].options, "headers"));
  assert.ok(!Object.hasOwn(calls[0].options, "dispatcher"));
});

test("Node socket lifecycle remains the SDK's ws lifecycle without a separate Agent", () => {
  const { calls, FixtureWebSocket, Transport } = nodeTransport();
  const first = new Transport("ws://127.0.0.1:54321/realtime/v1/websocket");
  const second = new Transport("ws://127.0.0.1:54321/realtime/v1/websocket", "synthetic-protocol");
  assert.notEqual(first, second);
  assert.equal(first.close, FixtureWebSocket.prototype.close);
  first.send("synthetic-encoded-envelope"); first.close(1000);
  assert.equal(calls[2].send, "synthetic-encoded-envelope");
  assert.deepEqual(calls[3].close, [1000]);
  assert.equal(calls[0].protocols, undefined);
  assert.equal(calls[1].protocols, "synthetic-protocol");
});

test("Workers retain their native constructor and import no Node transport at runtime", () => {
  class WorkerSocket {}
  const Transport = loadTransport("lib/runtime/realtime-transport.cloudflare.ts", {}, { WebSocket: WorkerSocket });
  assert.equal(Transport, WorkerSocket);
  const code = read("lib/runtime/realtime-transport.cloudflare.ts");
  assert.doesNotMatch(code, /from\s+["'](?:ws|undici|node:)/);
  assert.doesNotMatch(code, /\bimport\s*\(/);
});

test("Next preserves native ws resolution and its optional-addon fallback", () => {
  const config = read("next.config.ts");
  assert.match(config, /serverExternalPackages:\s*\[\s*["']ws["']\s*\]/);
  assert.doesNotMatch(config, /WS_NO_BUFFER_UTIL|WS_NO_UTF_8_VALIDATE/);
});

test("Vite uses an exact Worker transport alias separate from Node and env targets", () => {
  const code = read("vite.config.ts");
  assert.match(code, /find:\s*["']@\/lib\/runtime\/realtime-transport["']/);
  assert.match(code, /replacement:\s*fileURLToPath\(new URL\(["']\.\/lib\/runtime\/realtime-transport\.cloudflare\.ts["']/);
  assert.match(code, /find:\s*["']@\/lib\/runtime\/env["']/);
  assert.doesNotMatch(code, /find:\s*\/.*realtime-transport/);
});

test("Productive SDK opts into its runtime constructor without changing globals or logging", () => {
  const adapter = read("lib/supabase/realtime.ts");
  assert.match(adapter, /transport:\s*schoolRealtimeTransport/);
  assert.match(adapter, /logger:\s*\(\)\s*=>\s*\{\}/);
  for (const file of ["lib/supabase/realtime.ts", "lib/runtime/realtime-transport.ts", "lib/runtime/realtime-transport.cloudflare.ts"]) {
    const code = read(file);
    assert.doesNotMatch(code, /globalThis\.(?:fetch|WebSocket)\s*=/);
    assert.doesNotMatch(code, /setGlobalDispatcher|console\.|process\.env/);
  }
});
