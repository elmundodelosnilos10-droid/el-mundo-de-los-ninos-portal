import assert from "node:assert/strict";
import test from "node:test";
import { SCHOOL_UPLOAD_MAX_BODY_BYTES, SCHOOL_UPLOAD_MAX_FILE_BYTES, readSchoolUploadResponse } from "../lib/school-upload-limits.ts";
import { checkDeclaredRequestSize, MAX_MULTIPART_OVERHEAD_BYTES, readMultipartFormDataLimited } from "../lib/upload-request-guard.ts";

const limit = SCHOOL_UPLOAD_MAX_BODY_BYTES;

test("permite solicitudes cuyo tamaño no está declarado", () => {
  assert.equal(checkDeclaredRequestSize(null, limit), null);
});

test("permite cargas hasta el límite incluido", () => {
  assert.equal(checkDeclaredRequestSize(String(limit), limit), null);
  assert.equal(checkDeclaredRequestSize("1048576", limit), null);
});

test("rechaza antes de analizar formularios multipart que declaran exceso", () => {
  assert.equal(checkDeclaredRequestSize(String(limit + 1), limit), "too_large");
  assert.equal(checkDeclaredRequestSize("999999999999999999999999", limit), "too_large");
});

test("rechaza encabezados Content-Length malformados", () => {
  for (const value of ["", "-1", "1.5", "1, 2", " 12"]) {
    assert.equal(checkDeclaredRequestSize(value, limit), "invalid");
  }
});

test("aplica el límite al flujo multipart aunque no declare Content-Length", async () => {
  const body = `--limit-test\r\nContent-Disposition: form-data; name="file"; filename="grande.txt"\r\nContent-Type: text/plain\r\n\r\n${"x".repeat(2048)}\r\n--limit-test--\r\n`;
  const request = new Request("https://school.example/api/files", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=limit-test" }, body });
  assert.equal(request.headers.get("content-length"), null);
  const parsed = await readMultipartFormDataLimited(request, 1024);
  assert.deepEqual(parsed, { form: null, tooLarge: true });
});

test("permite formularios multipart dentro del límite", async () => {
  const body = new FormData();
  body.set("title", "Actividad de prueba");
  const request = new Request("https://school.example/api/files", { method: "POST", body });
  const parsed = await readMultipartFormDataLimited(request, 1024);
  assert.equal(parsed.tooLarge, false);
  assert.equal(parsed.form?.get("title"), "Actividad de prueba");
});


test("new upload limit is exactly 4 MiB plus 64 KiB and cannot be widened by a caller", async () => {
  assert.equal(SCHOOL_UPLOAD_MAX_FILE_BYTES, 4194304);
  assert.equal(MAX_MULTIPART_OVERHEAD_BYTES, 65536);
  assert.equal(limit, 4259840);
  assert.ok(limit < 4500000);
  assert.equal(checkDeclaredRequestSize(String(limit + 1), 25 * 1024 * 1024), "too_large");
  const bytes = new Uint8Array(limit + 1);
  const request = new Request("https://school.example/api/files", { method: "POST", body: bytes });
  assert.equal((await readMultipartFormDataLimited(request, 25 * 1024 * 1024)).tooLarge, true);
});

test("upload response parser handles a platform text/html 413 and malformed response honestly", async () => {
  await assert.rejects(readSchoolUploadResponse(new Response("platform diagnostic", { status: 413 })), /hasta 4 MB/);
  await assert.rejects(readSchoolUploadResponse(new Response("private diagnostic", { status: 502 })), /No se pudo confirmar/);
  assert.deepEqual(await readSchoolUploadResponse(Response.json({ id: "synthetic" }, { status: 201 })), { id: "synthetic" });
});
