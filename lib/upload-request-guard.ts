import { SCHOOL_UPLOAD_MAX_BODY_BYTES, SCHOOL_UPLOAD_MULTIPART_OVERHEAD_BYTES } from "./school-upload-limits.ts";

export const MAX_MULTIPART_OVERHEAD_BYTES = SCHOOL_UPLOAD_MULTIPART_OVERHEAD_BYTES;

export type DeclaredRequestSizeResult = "invalid" | "too_large" | null;

export function checkDeclaredRequestSize(contentLength: string | null, maxBodyBytes: number): DeclaredRequestSizeResult {
  if (contentLength === null) return null;
  if (!/^\d+$/.test(contentLength)) return "invalid";
  const size = Number(contentLength);
  if (!Number.isSafeInteger(size)) return "too_large";
  return size > Math.min(maxBodyBytes, SCHOOL_UPLOAD_MAX_BODY_BYTES) ? "too_large" : null;
}

/** Bound the incoming multipart stream before asking the runtime to parse it. */
export async function readMultipartFormDataLimited(
  request: Request,
  maxBodyBytes: number,
): Promise<{ form: FormData; tooLarge: false } | { form: null; tooLarge: boolean }> {
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1) throw new RangeError("Invalid multipart body limit");
  maxBodyBytes = Math.min(maxBodyBytes, SCHOOL_UPLOAD_MAX_BODY_BYTES);
  if (!request.body) return { form: null, tooLarge: false };

  const source = request.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await source.read();
      if (done) break;
      if (!value) continue;
      received += value.byteLength;
      if (received > maxBodyBytes) {
        await source.cancel().catch(() => undefined);
        return { form: null, tooLarge: true };
      }
      // Copy stream views to ordinary ArrayBuffer-backed bytes accepted by Blob.
      chunks.push(new Uint8Array(value));
    }
    const boundedRequest = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: new Blob(chunks, { type: request.headers.get("content-type") ?? "" }),
    });
    const form = await boundedRequest.formData();
    return { form, tooLarge: false };
  } catch {
    return { form: null, tooLarge: false };
  }
}
