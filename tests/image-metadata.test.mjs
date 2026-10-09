import assert from "node:assert/strict";
import test from "node:test";
import { stripImageMetadata } from "../lib/image-metadata.ts";

const encoder = new TextEncoder();
const concat = (...parts) => {
  const output = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
};

function pngChunk(type, data) {
  const typeBytes = encoder.encode(type);
  const contents = concat(typeBytes, data);
  let crc = 0xffffffff;
  for (const byte of contents) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  const chunk = new Uint8Array(12 + data.length);
  new DataView(chunk.buffer).setUint32(0, data.length, false);
  chunk.set(typeBytes, 4); chunk.set(data, 8); new DataView(chunk.buffer).setUint32(8 + data.length, crc, false);
  return chunk;
}

function webpChunk(type, data) {
  const chunk = new Uint8Array(8 + data.length + (data.length & 1));
  chunk.set(encoder.encode(type), 0);
  new DataView(chunk.buffer).setUint32(4, data.length, true);
  chunk.set(data, 8);
  return chunk;
}

test("quita EXIF, XMP y comentarios JPEG, incluidos antes o entre escaneos", () => {
  const exif = concat(encoder.encode("Exif\0\0"), Uint8Array.of(1, 2, 3, 4));
  const app1 = concat(Uint8Array.of(0xff, 0xe1, 0, 12), exif);
  const jpeg = concat(Uint8Array.of(0xff, 0xd8), app1, Uint8Array.of(0xff, 0xda, 0, 2, 0x11, 0xff, 0x00, 0x22, 0xff, 0xd9));
  const sanitized = stripImageMetadata("image/jpeg", jpeg);
  assert.ok(sanitized);
  assert.equal(Buffer.from(sanitized).includes(Buffer.from("Exif")), false);
  assert.deepEqual(Array.from(sanitized), [0xff, 0xd8, 0xff, 0xda, 0, 2, 0x11, 0xff, 0x00, 0x22, 0xff, 0xd9]);
});

test("quita chunks EXIF y de texto PNG sin alterar el resto del archivo", () => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/m+8AAAAASUVORK5CYII=", "base64");
  const withPrivateChunks = concat(
    png.subarray(0, png.length - 12),
    pngChunk("eXIf", encoder.encode("GPS private data")),
    pngChunk("tEXt", encoder.encode("Comment\0private note")),
    png.subarray(png.length - 12),
  );
  const sanitized = stripImageMetadata("image/png", withPrivateChunks);
  assert.ok(sanitized);
  assert.deepEqual(Buffer.from(sanitized), png);
});

test("quita EXIF y XMP de WebP, actualiza los flags y el tamaño RIFF", () => {
  const vp8x = webpChunk("VP8X", Uint8Array.of(0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0));
  const exif = webpChunk("EXIF", encoder.encode("GPS secret"));
  const xmp = webpChunk("XMP ", encoder.encode("<x:xmpmeta/>"));
  const image = webpChunk("VP8 ", Uint8Array.of(1, 2, 3));
  const payload = concat(encoder.encode("WEBP"), vp8x, exif, xmp, image);
  const source = concat(encoder.encode("RIFF"), new Uint8Array(4), payload);
  new DataView(source.buffer).setUint32(4, source.length - 8, true);
  const sanitized = stripImageMetadata("image/webp", source);
  assert.ok(sanitized);
  assert.equal(Buffer.from(sanitized).includes(Buffer.from("EXIF")), false);
  assert.equal(Buffer.from(sanitized).includes(Buffer.from("XMP ")), false);
  assert.equal(sanitized[20] & 0x03, 0);
  assert.equal(new DataView(sanitized.buffer, sanitized.byteOffset + 4, 4).getUint32(0, true), sanitized.length - 8);
});

test("rechaza contenedores de imagen truncados", () => {
  assert.equal(stripImageMetadata("image/jpeg", Uint8Array.of(0xff, 0xd8, 0xff, 0xe1, 0, 20)), null);
  assert.equal(stripImageMetadata("image/png", Uint8Array.of(0x89, 0x50, 0x4e, 0x47)), null);
  assert.equal(stripImageMetadata("image/webp", Uint8Array.of(0x52, 0x49, 0x46, 0x46)), null);
});
