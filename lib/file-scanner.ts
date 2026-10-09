export type FileScanResult = "clean" | "infected" | "unavailable";

export type FileScannerConfig = {
  url?: string;
  token?: string;
  applicationUrl?: string;
  localTestMode?: boolean;
};

export function isFileScannerConfigured(config: FileScannerConfig) {
  const url = config.url?.trim() ?? "";
  return Boolean(url && config.token?.trim() && isAllowedScannerUrl(url));
}

function isAllowedScannerUrl(value: string) {
  try {
    const url = new URL(value);
    const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    return !url.username && !url.password && !url.hash && !url.search && (url.protocol === "https:" || (loopback && url.protocol === "http:"));
  } catch {
    return false;
  }
}

/**
 * Send only the sanitized file bytes and MIME type to the school's private
 * scanner. Its endpoint must return {"status":"clean"} or
 * {"status":"infected"}. Any missing, malformed, redirected, failed or timed
 * out scan is unavailable and must be treated as a rejection by the caller.
 */
export async function scanUploadedFile(
  config: FileScannerConfig,
  contentType: string,
  bytes: Uint8Array,
  fetcher: typeof fetch = fetch,
  timeoutMs = 15_000,
): Promise<FileScanResult> {
  const url = config.url?.trim() ?? "";
  const token = config.token?.trim() ?? "";
  if (!url || !token) {
    // Synthetic verdicts are available only for local smoke tests. A deployed
    // school hostname can never enable this path, even if the flag is set.
    try {
      const host = new URL(config.applicationUrl ?? "").hostname;
      const localApplication = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
      if (config.localTestMode && localApplication) {
        const marker = new TextDecoder().decode(bytes).includes("SYNTHETIC-INFECTED-MARKER");
        return marker ? "infected" : "clean";
      }
    } catch {
      return "unavailable";
    }
    return "unavailable";
  }
  if (!isAllowedScannerUrl(url)) return "unavailable";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const response = await fetcher(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": contentType,
      },
      body,
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) return "unavailable";
    const text = await response.text();
    if (text.length > 1024) return "unavailable";
    const result: unknown = JSON.parse(text);
    if (!result || typeof result !== "object" || !("status" in result)) return "unavailable";
    const status = result.status;
    if (status === "clean") return "clean";
    if (status === "infected") return "infected";
    return "unavailable";
  } catch {
    return "unavailable";
  } finally {
    clearTimeout(timeout);
  }
}
