function concat(parts: Uint8Array[]) {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

function readText(bytes: Uint8Array, start: number, end: number) {
  return new TextDecoder().decode(bytes.subarray(start, end));
}

function stripJpegMetadata(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const parts = [bytes.subarray(0, 2)];
  let offset = 2;
  let foundEnd = false;
  while (offset < bytes.length) {
    const start = offset;
    if (bytes[offset] !== 0xff) return null;
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      parts.push(bytes.subarray(start, offset));
      foundEnd = true;
      break;
    }
    if (marker === 0x00) return null;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(bytes.subarray(start, offset));
      continue;
    }
    if (offset + 2 > bytes.length) return null;
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    const end = offset + segmentLength;
    const remove = (marker >= 0xe1 && marker <= 0xef && marker !== 0xe2 && marker !== 0xee) || marker === 0xfe;
    if (!remove) parts.push(bytes.subarray(start, end));
    offset = end;

    if (marker === 0xda) {
      const scanStart = offset;
      let cursor = scanStart;
      while (cursor < bytes.length) {
        if (bytes[cursor] !== 0xff) { cursor++; continue; }
        let markerOffset = cursor + 1;
        while (markerOffset < bytes.length && bytes[markerOffset] === 0xff) markerOffset++;
        if (markerOffset >= bytes.length) return null;
        const scanMarker = bytes[markerOffset];
        if (scanMarker === 0x00 || (scanMarker >= 0xd0 && scanMarker <= 0xd7)) { cursor = markerOffset + 1; continue; }
        parts.push(bytes.subarray(scanStart, cursor));
        offset = cursor;
        break;
      }
      if (cursor >= bytes.length) return null;
    }
  }
  if (!foundEnd || offset !== bytes.length) return null;
  return concat(parts);
}

function stripPngMetadata(bytes: Uint8Array): Uint8Array | null {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 20 || signature.some((byte, index) => bytes[index] !== byte)) return null;
  const parts = [bytes.subarray(0, 8)];
  let offset = 8;
  let foundEnd = false;
  const privateChunks = new Set(["eXIf", "tEXt", "zTXt", "iTXt"]);
  while (offset + 12 <= bytes.length) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
    const end = offset + 12 + length;
    if (end > bytes.length) return null;
    const type = readText(bytes, offset + 4, offset + 8);
    if (!privateChunks.has(type)) parts.push(bytes.subarray(offset, end));
    offset = end;
    if (type === "IEND") { foundEnd = true; break; }
  }
  if (!foundEnd || offset !== bytes.length) return null;
  return concat(parts);
}

function stripWebpMetadata(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 20 || readText(bytes, 0, 4) !== "RIFF" || readText(bytes, 8, 12) !== "WEBP") return null;
  const declaredSize = new DataView(bytes.buffer, bytes.byteOffset + 4, 4).getUint32(0, true);
  if (declaredSize + 8 !== bytes.length) return null;
  const parts = [bytes.subarray(0, 12)];
  let offset = 12;
  let vp8xFlagsOffset: number | null = null;
  while (offset + 8 <= bytes.length) {
    const chunkStart = offset;
    const type = readText(bytes, offset, offset + 4);
    const size = new DataView(bytes.buffer, bytes.byteOffset + offset + 4, 4).getUint32(0, true);
    const dataStart = offset + 8;
    const end = dataStart + size + (size & 1);
    if (end > bytes.length) return null;
    if (type === "VP8X") {
      if (size < 10) return null;
      const chunk = bytes.slice(chunkStart, end);
      chunk[8] &= ~0x03;
      vp8xFlagsOffset = parts.reduce((total, part) => total + part.length, 0) + 8;
      parts.push(chunk);
    } else if (type !== "EXIF" && type !== "XMP ") parts.push(bytes.subarray(chunkStart, end));
    offset = end;
  }
  if (offset !== bytes.length) return null;
  const output = concat(parts);
  new DataView(output.buffer, output.byteOffset + 4, 4).setUint32(0, output.length - 8, true);
  if (vp8xFlagsOffset !== null) output[vp8xFlagsOffset] &= ~0x03;
  return output;
}

export function stripImageMetadata(type: string, bytes: Uint8Array): Uint8Array | null {
  if (type === "image/jpeg") return stripJpegMetadata(bytes);
  if (type === "image/png") return stripPngMetadata(bytes);
  if (type === "image/webp") return stripWebpMetadata(bytes);
  return bytes;
}
