import { readFile } from "node:fs/promises";
try {
  const token = (await readFile(process.env.SCANNER_TOKEN_FILE ?? "/run/secrets/file_scan_token", "utf8")).trim();
  const response = await fetch(`http://127.0.0.1:${process.env.PORT ?? "8080"}/health`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000), redirect: "error",
  });
  const body = await response.json();
  if (!response.ok || body.status !== "ready") process.exitCode = 1;
} catch { process.exitCode = 1; }
