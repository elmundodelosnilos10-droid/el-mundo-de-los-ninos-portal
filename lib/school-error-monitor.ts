/** Server-only, bounded error categories. Never serialize an error or request. */
export const SCHOOL_ERROR_WINDOW_MS = 60_000;
export const SCHOOL_ERROR_MAX_LINES = 20;
export const SCHOOL_ERROR_MAX_COUNTER = 1_000_000;
type Router = "app" | "pages" | "unknown";
type RouteKind = "render" | "route" | "action" | "proxy" | "middleware" | "unknown";
type Counters = { emitted: number; suppressed: number; deduped: number };
type ErrorRecord = { event: "school_server_request_error"; router: Router; routeKind: RouteKind; timestamp: string };
type SummaryRecord = { event: "school_server_error_summary"; emitted: number; suppressed: number; deduped: number; timestamp: string };
const increment = (value: number) => Math.min(SCHOOL_ERROR_MAX_COUNTER, value + 1);
function ownPrimitive(context: unknown, key: "routerKind" | "routeType") {
  try {
    if (!context || (typeof context !== "object" && typeof context !== "function")) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(context, key);
    return descriptor && typeof descriptor.value === "string" ? descriptor.value : undefined;
  } catch { return undefined; } // Never invoke an accessor or serialize an unsafe context.
}
function categories(context: unknown): { router: Router; routeKind: RouteKind } {
  const router = ownPrimitive(context, "routerKind");
  const kind = ownPrimitive(context, "routeType");
  return {
    router: router === "App Router" ? "app" : router === "Pages Router" ? "pages" : "unknown",
    routeKind: kind === "render" || kind === "route" || kind === "action" || kind === "proxy" || kind === "middleware" ? kind : "unknown",
  };
}
/** No timers, network, persistent storage, global console patches or client data.
 * Injected clock/sink are solely for deterministic local tests. Limits are fixed.
 */
export function createSchoolErrorMonitor({
  now = Date.now,
  sink = (line: string) => { console.error(line); },
}: { now?: () => number; sink?: (line: string) => void } = {}) {
  let windowStart: number | null = null;
  let attempts = 0;
  let counters: Counters = { emitted: 0, suppressed: 0, deduped: 0 };
  let seen = new WeakSet<object>();
  function write(record: ErrorRecord | SummaryRecord) {
    attempts++;
    try { sink(JSON.stringify(record)); return true; } catch { return false; }
  }
  function record(error: unknown, context: unknown) {
    try {
      const instant = now();
      if (!Number.isSafeInteger(instant) || instant < 0 || instant > 8_640_000_000_000_000) return;
      if (windowStart === null) windowStart = instant;
      // A backwards wall clock never replenishes a full budget.
      if (instant - windowStart >= SCHOOL_ERROR_WINDOW_MS) {
        const previous = counters;
        windowStart = instant; attempts = 0; counters = { emitted: 0, suppressed: 0, deduped: 0 }; seen = new WeakSet<object>();
        if (previous.suppressed > 0 || previous.deduped > 0) {
          const accepted = write({ event: "school_server_error_summary", ...previous, timestamp: new Date(instant).toISOString() });
          if (!accepted) counters.suppressed = increment(counters.suppressed);
        }
      }
      // Only weak identity is used: no message, stack, name, digest, cause or other property.
      let identity: object | undefined;
      if (error !== null && (typeof error === "object" || typeof error === "function")) {
        if (seen.has(error)) { counters.deduped = increment(counters.deduped); return; }
        identity = error;
      }
      if (attempts >= SCHOOL_ERROR_MAX_LINES) { counters.suppressed = increment(counters.suppressed); return; }
      // At most twenty weak identities per window; dropped events add no entries.
      if (identity) seen.add(identity);
      if (write({ event: "school_server_request_error", ...categories(context), timestamp: new Date(instant).toISOString() })) counters.emitted = increment(counters.emitted);
      else counters.suppressed = increment(counters.suppressed);
    } catch { /* Monitoring must never fail a request or log its own error. */ }
  }
  return { record };
}
const serverMonitor = createSchoolErrorMonitor();
export function recordSchoolRequestError(error: unknown, context: unknown) { serverMonitor.record(error, context); }
