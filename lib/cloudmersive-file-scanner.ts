import type { FileScanResult } from "./file-scanner";

/** Optional adapter only; no environment, registration or production selection. */
export type CloudmersiveFileScannerConfig = {
  enabled?: boolean;
  region?: "north-america-public";
  endpoint?: string;
  apiKey?: string;
  /** Set to the approved plan's limit; this is not its commercial entitlement. */
  maxFileBytes?: number;
};

// Only the publicly documented endpoint is supported. Premium region-specific
// endpoints must be verified and added explicitly; never infer their hostnames.
// https://api.cloudmersive.com/configure-endpoint-client-configuration.asp
// https://api.cloudmersive.com/postman.asp (North America public endpoint)
export const CLOUDMERSIVE_PUBLIC_ENDPOINT = "https://api.cloudmersive.com";
export const CLOUDMERSIVE_ADAPTER_MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 16 * 1024;
const filenames: Readonly<Record<string, string>> = Object.freeze({
  "application/pdf": "upload.pdf",
  "image/jpeg": "upload.jpg",
  "image/png": "upload.png",
  "image/webp": "upload.webp",
  "audio/mpeg": "upload.mp3",
  "audio/ogg": "upload.ogg",
  "audio/wav": "upload.wav",
});

function settings(config: CloudmersiveFileScannerConfig) {
  if (config.enabled !== true || config.region !== "north-america-public"
    || config.endpoint !== CLOUDMERSIVE_PUBLIC_ENDPOINT) return null;
  // Header-safe bounded input without inventing a provider key format.
  const apiKey = config.apiKey;
  if (typeof apiKey !== "string" || !/^[\x21-\x7e]{1,256}$/.test(apiKey)) return null;
  const maxFileBytes = config.maxFileBytes ?? CLOUDMERSIVE_ADAPTER_MAX_FILE_BYTES;
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 6
    || maxFileBytes > CLOUDMERSIVE_ADAPTER_MAX_FILE_BYTES) return null;
  return { apiKey, maxFileBytes };
}

export function isCloudmersiveFileScannerConfigured(config: CloudmersiveFileScannerConfig) {
  return settings(config) !== null;
}

async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))
    || Number(length) > MAX_RESPONSE_BYTES)) throw new Error();
  if (!response.body) throw new Error();
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  let completed = false;
  try {
    while (true) {
      if (signal.aborted) throw new Error();
      const { value, done } = await reader.read();
      if (signal.aborted) throw new Error();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw new Error();
      chunks.push(value);
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    const result: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
    completed = true;
    return result;
  } finally {
    signal.removeEventListener("abort", cancel);
    if (!completed) cancel();
    reader.releaseLock();
  }
}

// https://api.cloudmersive.com/docs/virus.asp and /virus/docs/v1/swagger:
// POST /virus/scan/file, multipart inputFile, Apikey header, VirusScanResult.
function verdict(value: unknown): FileScanResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "unavailable";
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => key !== "CleanResult" && key !== "FoundViruses")
    || typeof result.CleanResult !== "boolean") return "unavailable";
  // FoundViruses is optional in the official schema, but if present must be
  // its documented array, never an error string/null or an alternate verdict.
  const found = result.FoundViruses;
  if (found !== undefined && (!Array.isArray(found) || found.length > 128)) return "unavailable";
  const detections: unknown[] = found === undefined ? [] : found as unknown[];
  for (const detection of detections) {
    if (!detection || typeof detection !== "object" || Array.isArray(detection)) return "unavailable";
    const item = detection as Record<string, unknown>;
    if (Object.keys(item).some(key => key !== "FileName" && key !== "VirusName")
      || typeof item.VirusName !== "string" || !item.VirusName.trim() || item.VirusName.length > 512
      || (item.FileName !== undefined && (typeof item.FileName !== "string" || item.FileName.length > 512))) return "unavailable";
  }
  if (result.CleanResult) return detections.length === 0 ? "clean" : "unavailable";
  // An incomplete negative result blocks the upload without inventing a
  // positive infection when the provider returned no detection information.
  return detections.length > 0 ? "infected" : "unavailable";
}

/**
 * Uses only Web APIs (Node/Workers). Callers retain their own 4 MiB portal cap
 * and authorization/sanitization; the adapter's 20 MiB ceiling does not raise it.
 * Only a reviewed provider/region/plan should be explicitly enabled. This basic
 * scan is not PDF CDR or a guarantee that every threat will be detected.
 */
export async function scanCloudmersiveFile(
  config: CloudmersiveFileScannerConfig,
  contentType: string,
  bytes: Uint8Array,
  fetcher: typeof fetch = fetch,
  timeoutMs = 15_000,
): Promise<FileScanResult> {
  const selected = settings(config);
  if (!selected || !Object.hasOwn(filenames, contentType) || !(bytes instanceof Uint8Array)
    || bytes.byteLength < 6 || bytes.byteLength > selected.maxFileBytes
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15_000) return "unavailable";
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<FileScanResult>(resolve => {
    timer = setTimeout(() => { controller.abort(); resolve("unavailable"); }, timeoutMs);
  });
  const operation = async (): Promise<FileScanResult> => {
    let response: Response | undefined;
    try {
      const body = new FormData();
      // Fixed MIME-derived name; never the user's filename or school metadata.
      const copy = new Uint8Array(bytes.byteLength); copy.set(bytes);
      body.append("inputFile", new Blob([copy.buffer], { type: contentType }), filenames[contentType]);
      response = await fetcher(`${CLOUDMERSIVE_PUBLIC_ENDPOINT}/virus/scan/file`, {
        method: "POST", headers: { Apikey: selected.apiKey, Accept: "application/json" }, body,
        signal: controller.signal, redirect: "error", credentials: "omit",
        cache: "no-store", referrerPolicy: "no-referrer",
      });
      if (controller.signal.aborted || response.status !== 200 || response.redirected
        || (response.url && response.url !== `${CLOUDMERSIVE_PUBLIC_ENDPOINT}/virus/scan/file`)
        || !/^(application|text)\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers.get("content-type") ?? "")) return "unavailable";
      const result = verdict(await boundedJson(response, controller.signal));
      return controller.signal.aborted ? "unavailable" : result;
    } catch { return "unavailable"; }
    finally {
      if (response?.body && !response.bodyUsed) void response.body.cancel().catch(() => {});
    }
  };
  try { return await Promise.race([operation(), timeout]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
