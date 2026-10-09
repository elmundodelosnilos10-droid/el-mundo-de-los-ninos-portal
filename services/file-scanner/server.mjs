import http from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { clamdCommand, scanClamdStream, verifyLoadedDatabase } from "./clamd.mjs";

function integer(value, fallback, min, max) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error("Invalid scanner configuration");
  return parsed;
}

export async function loadScannerConfig(env = process.env) {
  if (env.SCANNER_TOKEN && env.SCANNER_TOKEN_FILE) throw new Error("Configure only one scanner token source");
  const token = (env.SCANNER_TOKEN_FILE ? await readFile(env.SCANNER_TOKEN_FILE, "utf8") : env.SCANNER_TOKEN ?? "").trim();
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(token)) throw new Error("Scanner requires a private token of at least 43 characters");
  const host = env.CLAMD_HOST ?? "clamav";
  if (!/^[A-Za-z0-9.-]{1,253}$/.test(host)) throw new Error("Invalid scanner daemon configuration");
  const engineVersion = env.CLAMD_ENGINE_VERSION ?? "1.4.6";
  if (!/^\d+\.\d+\.\d+$/.test(engineVersion)) throw new Error("Invalid scanner engine configuration");
  return {
    token, endpoint: { host, port: integer(env.CLAMD_PORT, 3310, 1, 65535) }, engineVersion,
    port: integer(env.PORT, 8080, 1, 65535), maxBytes: integer(env.MAX_SCAN_BYTES, 20 * 1024 * 1024, 6, 20 * 1024 * 1024),
    requestTimeoutMs: integer(env.REQUEST_TIMEOUT_MS, 12_000, 100, 12_000), maxConcurrent: integer(env.MAX_CONCURRENT_SCANS, 2, 1, 2),
    maxDatabaseAgeMs: integer(env.MAX_DATABASE_AGE_HOURS, 24, 1, 24) * 3_600_000,
  };
}

export function createScannerServer(config) {
  const secretHash = createHash("sha256").update(config.token).digest();
  let active = 0;
  const server = http.createServer({ maxHeaderSize: 8192, connectionsCheckingInterval: 1000 }, async (request, response) => {
    const send = (code, status) => {
      if (!response.destroyed && !response.writableEnded) {
        response.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", Connection: "close" });
        response.end(JSON.stringify({ status }));
      }
    };
    // Node's server-side fetch adds Sec-Fetch-Mode: cors itself. Browsers add
    // Origin and/or Site/Dest/User; those are rejected, with no CORS response.
    if (request.headers.origin || ["sec-fetch-site", "sec-fetch-dest", "sec-fetch-user"].some(key => request.headers[key] !== undefined)
      || (request.headers["sec-fetch-mode"] !== undefined && request.headers["sec-fetch-mode"] !== "cors")) return send(403, "unavailable");
    const provided = request.headers.authorization;
    if (typeof provided !== "string" || !/^Bearer [A-Za-z0-9_-]{43,128}$/.test(provided)
      || !timingSafeEqual(secretHash, createHash("sha256").update(provided.slice(7)).digest())) return send(401, "unavailable");
    const health = request.method === "GET" && request.url === "/health";
    const scan = request.method === "POST" && request.url === "/scan";
    if (!health && !scan) return send(404, "unavailable");
    if (active >= config.maxConcurrent) return send(503, "unavailable");
    if (scan && (request.headers["content-encoding"] || /^multipart\//i.test(request.headers["content-type"] ?? "")
      || !/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i.test(request.headers["content-type"] ?? ""))) return send(415, "unavailable");
    const length = request.headers["content-length"];
    if (length !== undefined && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > config.maxBytes || (scan && Number(length) <= 5))) return send(413, "unavailable");
    active++;
    const controller = new AbortController();
    const deadline = Date.now() + config.requestTimeoutMs;
    const abort = () => controller.abort();
    const timer = setTimeout(() => { abort(); send(503, "unavailable"); request.destroy(); }, config.requestTimeoutMs);
    request.once("aborted", abort);
    response.once("close", () => { if (!response.writableEnded) abort(); });
    const budget = cap => {
      const remaining = deadline - Date.now();
      if (remaining <= 0 || controller.signal.aborted) throw new Error();
      return Math.min(cap, remaining);
    };
    try {
      verifyLoadedDatabase(await clamdCommand(config.endpoint, "VERSION", budget(2000), controller.signal), config);
      if (health) {
        if (await clamdCommand(config.endpoint, "PING", budget(2000), controller.signal) !== "PONG") throw new Error();
        budget(1);
        return send(200, "ready");
      }
      const status = await scanClamdStream(config.endpoint, request, {
        maxBytes: config.maxBytes, expectedBytes: length === undefined ? undefined : Number(length), timeoutMs: budget(8000), signal: controller.signal,
      });
      verifyLoadedDatabase(await clamdCommand(config.endpoint, "VERSION", budget(2000), controller.signal), config);
      budget(1);
      send(200, status);
    } catch { send(503, "unavailable"); }
    finally {
      clearTimeout(timer);
      request.removeListener("aborted", abort);
      active--;
    }
  });
  server.maxConnections = 32;
  server.headersTimeout = Math.min(5000, config.requestTimeoutMs);
  server.requestTimeout = config.requestTimeoutMs;
  server.setTimeout(config.requestTimeoutMs, socket => socket.destroy());
  server.keepAliveTimeout = 1000;
  server.maxRequestsPerSocket = 1;
  server.on("checkContinue", (_request, response) => { response.writeHead(417, { Connection: "close" }); response.end(); });
  server.on("clientError", (_error, socket) => { socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"); });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const config = await loadScannerConfig();
    const server = createScannerServer(config);
    server.listen(config.port, "0.0.0.0");
    server.on("error", () => { process.stderr.write("Scanner startup failed.\n"); process.exitCode = 1; });
    const shutdown = () => { server.close(); server.closeAllConnections(); };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  } catch { process.stderr.write("Scanner configuration failed.\n"); process.exitCode = 1; }
}
