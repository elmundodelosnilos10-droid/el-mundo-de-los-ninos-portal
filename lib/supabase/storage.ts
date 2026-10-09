import { permitsIsolatedSupabaseHttp } from "./local-http-test-policy.ts";

/**
 * Private Supabase Storage adapter for server-side Cloudflare Worker code.
 *
 * This module deliberately accepts only a server environment object with a
 * Supabase secret key. Do not import it into a Client Component or pass a
 * publishable/anon key. Authorization to a student or group remains the
 * caller's responsibility; this adapter only handles private object IO.
 */

export type SupabaseStorageEnvironment = {
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_STORAGE_BUCKET?: string;
};

export type PrivateStorageConfig = {
  url?: string;
  serviceRoleKey?: string;
  bucket?: string;
};

export type UploadOptions = {
  contentType: string;
  maxBytes?: number;
};

export type PrivateDownload = {
  body: ReadableStream<Uint8Array> | null;
  contentType: string;
  sizeBytes: number | null;
  response: Response;
};

export type PrivateStorageClient = ReturnType<typeof createPrivateStorageClient>;

const DEFAULT_BUCKET = "school-files";
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_DOCUMENT_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_SIGNED_URL_SECONDS = 60 * 60;
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
]);

export class SupabaseStorageError extends Error {
  readonly code: "not_configured" | "invalid_input" | "rejected" | "unavailable";
  readonly operation: "upload" | "download" | "delete" | "signed_url";
  readonly status?: number;

  constructor(
    code: "not_configured" | "invalid_input" | "rejected" | "unavailable",
    operation: "upload" | "download" | "delete" | "signed_url",
    status?: number,
  ) {
    super(`Supabase private storage ${operation} failed (${code})`);
    this.name = "SupabaseStorageError";
    this.code = code;
    this.operation = operation;
    this.status = status;
  }
}

/** Build a client from Cloudflare's server-only env binding object. */
export function createSchoolStorageClient(
  environment: SupabaseStorageEnvironment,
  fetcher: typeof fetch = fetch,
) {
  return createPrivateStorageClient({
    url: environment.SUPABASE_URL,
    serviceRoleKey: environment.SUPABASE_SECRET_KEY,
    bucket: environment.SUPABASE_STORAGE_BUCKET,
  }, fetcher);
}

/** Injectable factory used by server routes and mock-based tests. */
export function createPrivateStorageClient(
  config: PrivateStorageConfig,
  fetcher: typeof fetch = fetch,
) {
  const operationUrl = (operation: PrivateStorageErrorOperation) => {
    const url = safeBaseUrl(config.url, operation);
    const bucket = safeBucket(config.bucket ?? DEFAULT_BUCKET, operation);
    const key = config.serviceRoleKey?.trim();
    if (!key || /[\r\n]/.test(key)) throw storageError("not_configured", operation);
    return { url, bucket, key };
  };

  function headers(key: string, extra: Record<string, string> = {}) {
    // New sb_secret_ keys are accepted through apikey. Legacy service_role
    // JWTs still require the Authorization bearer header.
    return {
      apikey: key,
      ...(/^sb_secret_/.test(key) ? {} : { Authorization: `Bearer ${key}` }),
      ...extra,
    };
  }

  function objectUrl(base: URL, bucket: string, objectKey: string, op: PrivateStorageErrorOperation) {
    const segments = safeObjectKey(objectKey, op).split("/").map(encodeURIComponent);
    return new URL(`/storage/v1/object/${encodeURIComponent(bucket)}/${segments.join("/")}`, base);
  }

  async function upload(objectKey: string, bytesInput: Uint8Array | ArrayBuffer, options: UploadOptions) {
    const operation = "upload" as const;
    const { url, bucket, key } = operationUrl(operation);
    const bytes = bytesInput instanceof Uint8Array ? bytesInput : new Uint8Array(bytesInput);
    const contentType = validateUpload(bytes, options);
    const response = await fetcher(objectUrl(url, bucket, objectKey, operation), {
      method: "POST",
      headers: headers(key, {
        "Content-Type": contentType,
        "Cache-Control": "private, no-store",
        "x-upsert": "false",
      }),
      body: bytes as BodyInit,
      redirect: "error",
    }).catch(() => { throw storageError("unavailable", operation); });
    if (!response.ok) throw storageError("rejected", operation, response.status);
  }

  async function download(objectKey: string): Promise<PrivateDownload> {
    const operation = "download" as const;
    const { url, bucket, key } = operationUrl(operation);
    const response = await fetcher(objectUrl(url, bucket, objectKey, operation), {
      method: "GET",
      headers: headers(key, { Accept: "application/octet-stream" }),
      redirect: "error",
    }).catch(() => { throw storageError("unavailable", operation); });
    if (!response.ok) throw storageError("rejected", operation, response.status);

    const contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
    const lengthHeader = response.headers.get("content-length");
    const sizeBytes = lengthHeader && /^\d+$/.test(lengthHeader) ? Number(lengthHeader) : null;
    const maxBytes = contentType.startsWith("audio/") ? MAX_AUDIO_BYTES : MAX_DOCUMENT_IMAGE_BYTES;
    if (!ALLOWED_MIME_TYPES.has(contentType) || (lengthHeader !== null && sizeBytes === null) ||
        (sizeBytes !== null && (!Number.isSafeInteger(sizeBytes) || sizeBytes > maxBytes))) {
      await response.body?.cancel().catch(() => undefined);
      throw storageError("rejected", operation, 502);
    }

    let bytesRead = 0;
    const limitedBody = response.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytesRead += chunk.byteLength;
        if (bytesRead > maxBytes) throw storageError("rejected", operation, 502);
        controller.enqueue(chunk);
      },
    })) ?? null;

    // Return only safe response headers. In particular, never forward a
    // Location or cache header supplied by the Storage API to the browser.
    const safeResponse = new Response(limitedBody, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff",
        ...(sizeBytes === null ? {} : { "Content-Length": String(sizeBytes) }),
      },
    });
    return { body: safeResponse.body, contentType, sizeBytes, response: safeResponse };
  }

  async function remove(objectKey: string) {
    const operation = "delete" as const;
    const { url, bucket, key } = operationUrl(operation);
    const response = await fetcher(objectUrl(url, bucket, objectKey, operation), {
      method: "DELETE",
      headers: headers(key),
      redirect: "error",
    }).catch(() => { throw storageError("unavailable", operation); });
    if (!response.ok) throw storageError("rejected", operation, response.status);
  }

  async function createSignedUrl(objectKey: string, expiresInSeconds = 300): Promise<string> {
    const operation = "signed_url" as const;
    const { url, bucket, key } = operationUrl(operation);
    safeObjectKey(objectKey, operation);
    if (!Number.isSafeInteger(expiresInSeconds) || expiresInSeconds < 1 || expiresInSeconds > MAX_SIGNED_URL_SECONDS) {
      throw storageError("invalid_input", operation);
    }
    const endpoint = objectUrl(url, bucket, objectKey, operation);
    endpoint.pathname = endpoint.pathname.replace("/object/", "/object/sign/");
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: headers(key, { "Content-Type": "application/json", Accept: "application/json" }),
      body: JSON.stringify({ expiresIn: expiresInSeconds }),
      redirect: "error",
    }).catch(() => { throw storageError("unavailable", operation); });
    if (!response.ok) throw storageError("rejected", operation, response.status);
    const payload: unknown = await response.json().catch(() => null);
    if (!payload || typeof payload !== "object" || !("signedURL" in payload) || typeof payload.signedURL !== "string") {
      throw storageError("rejected", operation, 502);
    }
    return validateSignedUrl(payload.signedURL, url, bucket, objectKey);
  }

  return { upload, download, remove, createSignedUrl };
}

type PrivateStorageErrorOperation = "upload" | "download" | "delete" | "signed_url";

function storageError(
  code: ConstructorParameters<typeof SupabaseStorageError>[0],
  operation: PrivateStorageErrorOperation,
  status?: number,
) {
  return new SupabaseStorageError(code, operation, status);
}

function safeBaseUrl(value: string | undefined, operation: PrivateStorageErrorOperation) {
  if (!value) throw storageError("not_configured", operation);
  try {
    const url = new URL(value);
    if ((url.protocol !== "https:" && !permitsIsolatedSupabaseHttp(value)) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("invalid URL");
    }
    return url;
  } catch {
    throw storageError("not_configured", operation);
  }
}

function safeBucket(value: string, operation: PrivateStorageErrorOperation) {
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(value)) throw storageError("not_configured", operation);
  return value;
}

function safeObjectKey(value: string, operation: PrivateStorageErrorOperation) {
  if (value.length < 1 || value.length > 512 || !value.startsWith("private/")) {
    throw storageError("invalid_input", operation);
  }
  const segments = value.split("/");
  if (segments.some(segment => !segment || segment === "." || segment === ".." || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(segment))) {
    throw storageError("invalid_input", operation);
  }
  return value;
}

function validateUpload(bytes: Uint8Array, options: UploadOptions) {
  const operation = "upload" as const;
  const contentType = options.contentType.trim().toLowerCase();
  const typeLimit = contentType.startsWith("audio/") ? MAX_AUDIO_BYTES : MAX_DOCUMENT_IMAGE_BYTES;
  const requestedLimit = options.maxBytes ?? typeLimit;
  const maxBytes = Math.min(requestedLimit, typeLimit);
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 ||
      bytes.length < 1 || bytes.length > maxBytes || !ALLOWED_MIME_TYPES.has(contentType) || !matchesMagic(contentType, bytes)) {
    throw storageError("invalid_input", operation);
  }
  return contentType;
}

function matchesMagic(type: string, bytes: Uint8Array) {
  if (type === "application/pdf") return ascii(bytes, 0, 5) === "%PDF-";
  if (type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") return ascii(bytes, 0, 8) === "\x89PNG\r\n\x1a\n";
  if (type === "image/webp") return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP";
  if (type === "audio/mpeg") return ascii(bytes, 0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  if (type === "audio/ogg") return ascii(bytes, 0, 4) === "OggS";
  if (type === "audio/wav") return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WAVE";
  return false;
}

function ascii(bytes: Uint8Array, from: number, to: number) {
  return String.fromCharCode(...bytes.slice(from, to));
}

function validateSignedUrl(value: string, base: URL, bucket: string, objectKey: string) {
  const operation = "signed_url" as const;
  try {
    const signed = new URL(value, base);
    const expectedSuffix = `/object/sign/${encodeURIComponent(bucket)}/${safeObjectKey(objectKey, operation).split("/").map(encodeURIComponent).join("/")}`;
    const isExpectedPath = signed.pathname === `/storage/v1${expectedSuffix}` || signed.pathname === expectedSuffix;
    if (signed.origin !== base.origin || !isExpectedPath || !signed.searchParams.has("token") || signed.hash) {
      throw new Error("invalid signed URL");
    }
    return signed.toString();
  } catch {
    throw storageError("rejected", operation, 502);
  }
}
