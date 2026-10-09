import assert from "node:assert/strict";
import { test } from "node:test";
import { isFileScannerConfigured, scanUploadedFile } from "../lib/file-scanner.ts";

const config = { url: "https://scanner.example.test/scan", token: "synthetic-token" };
const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

test("configuración incompleta bloquea y no contacta un servicio", async () => {
  let called = false;
  assert.equal(isFileScannerConfigured({ url: config.url }), false);
  const result = await scanUploadedFile({ url: config.url }, "application/pdf", bytes, async () => { called = true; return new Response(); });
  assert.equal(result, "unavailable");
  assert.equal(called, false);
});

test("el veredicto sintético solo funciona con host local y bandera de pruebas", async () => {
  assert.equal(await scanUploadedFile({ applicationUrl: "http://localhost:5173", localTestMode: true }, "application/pdf", bytes), "clean");
  assert.equal(await scanUploadedFile({ applicationUrl: "http://localhost:5173", localTestMode: true }, "application/pdf", new TextEncoder().encode("SYNTHETIC-INFECTED-MARKER")), "infected");
  assert.equal(await scanUploadedFile({ applicationUrl: "https://school.example", localTestMode: true }, "application/pdf", bytes), "unavailable");
});

test("envía bytes saneados y tipo con token, y acepta solo estado limpio", async () => {
  let captured;
  const result = await scanUploadedFile(config, "application/pdf", bytes, async (url, init) => {
    captured = { url, init, body: [...new Uint8Array(init.body)] };
    return Response.json({ status: "clean" });
  });
  assert.equal(result, "clean");
  assert.equal(captured.url, config.url);
  assert.deepEqual(captured.body, [...bytes]);
  assert.equal(captured.init.headers.Authorization, "Bearer synthetic-token");
  assert.equal(captured.init.headers["Content-Type"], "application/pdf");
  assert.equal(captured.init.redirect, "error");
  assert.equal(Object.keys(captured.init.headers).some(key => /student|email|filename/i.test(key)), false);
});

test("rechaza veredicto infectado", async () => {
  assert.equal(await scanUploadedFile(config, "application/pdf", bytes, async () => Response.json({ status: "infected" })), "infected");
});

test("cualquier HTTP, JSON o veredicto desconocido falla cerrado", async () => {
  assert.equal(await scanUploadedFile(config, "application/pdf", bytes, async () => new Response("", { status: 502 })), "unavailable");
  assert.equal(await scanUploadedFile(config, "application/pdf", bytes, async () => new Response("not-json")), "unavailable");
  assert.equal(await scanUploadedFile(config, "application/pdf", bytes, async () => Response.json({ status: "unknown" })), "unavailable");
});

test("la expiración falla cerrada", async () => {
  const result = await scanUploadedFile(config, "application/pdf", bytes, (_url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true });
  }), 1);
  assert.equal(result, "unavailable");
});

test("HTTP solo se permite en loopback local", async () => {
  let calls = 0;
  const local = await scanUploadedFile({ url: "http://127.0.0.1:5177/scan", token: "synthetic-token" }, "application/pdf", bytes, async () => { calls++; return Response.json({ status: "clean" }); });
  const publicHttp = await scanUploadedFile({ url: "http://scanner.example.test/scan", token: "synthetic-token" }, "application/pdf", bytes, async () => { calls++; return Response.json({ status: "clean" }); });
  const credentialsInUrl = await scanUploadedFile({ url: "https://user:pass@scanner.example.test/scan", token: "synthetic-token" }, "application/pdf", bytes, async () => { calls++; return Response.json({ status: "clean" }); });
  const queryCredential = await scanUploadedFile({ url: "https://scanner.example.test/scan?token=secret", token: "synthetic-token" }, "application/pdf", bytes, async () => { calls++; return Response.json({ status: "clean" }); });
  assert.equal(local, "clean");
  assert.equal(publicHttp, "unavailable");
  assert.equal(credentialsInUrl, "unavailable");
  assert.equal(queryCredential, "unavailable");
  assert.equal(calls, 1);
});
