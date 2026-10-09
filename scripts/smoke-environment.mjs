import path from "node:path";

// All mutable Wrangler state belongs to the disposable run, even if a parent
// process inherited paths from a live preview. No registry is shared with it.
export function createSmokeEnvironment(scratch, parent = process.env) {
  const runtimeRoot = path.join(scratch, "runtime");
  return {
    ...parent,
    CLOUDFLARE_CF_FETCH_ENABLED: "false",
    WRANGLER_SEND_METRICS: "false",
    WRANGLER_WRITE_LOGS: "false",
    SITES_RUNTIME_ROOT: runtimeRoot,
    WRANGLER_LOG_PATH: path.join(runtimeRoot, "wrangler", "logs"),
    WRANGLER_REGISTRY_PATH: path.join(runtimeRoot, "wrangler", "dev-registry"),
    MINIFLARE_REGISTRY_PATH: path.join(runtimeRoot, "wrangler", "registry"),
  };
}
