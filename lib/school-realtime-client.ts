/** Same-origin invalidation signals only. School sessions and database JWTs
 * remain in the server; no student data or credentials are cached here. */
export type SchoolRealtimeStatus = "connected" | "connecting" | "reconnecting" | "disabled" | "unauthorized";
export type SchoolRealtimeUpdate =
  | { type: "status"; status: SchoolRealtimeStatus }
  | { type: "invalidate"; scope: "notifications" | "messages" | "communication" | "all"; conversationId?: string };
type Listener = (update: SchoolRealtimeUpdate) => void;
type StreamEvent = { data?: string };
type EventStream = {
  addEventListener(name: string, callback: (event: StreamEvent) => void): void;
  close(): void;
};
export type SchoolRealtimeRuntime = {
  fetcher: typeof fetch;
  openStream: (url: string) => EventStream;
  isOnline: () => boolean;
  isVisible: () => boolean;
  subscribeEnvironment: (callback: () => void) => () => void;
  setTimer: (callback: () => void, delay: number) => number;
  clearTimer: (id: number) => void;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function parseSignal(event: StreamEvent): Record<string, unknown> | null {
  if (typeof event.data !== "string" || event.data.length > 256) return null;
  try {
    const data: unknown = JSON.parse(event.data);
    return data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : null;
  } catch { return null; }
}
export function parseSchoolRealtimeInvalidation(event: StreamEvent): SchoolRealtimeUpdate | null {
  const data = parseSignal(event);
  if (!data) return null;
  if ((data.scope === "notifications" || data.scope === "communication" || data.scope === "all") && Object.keys(data).length === 1) {
    return { type: "invalidate", scope: data.scope };
  }
  if (data.scope === "messages" && Object.keys(data).length === 2 && typeof data.conversationId === "string" && UUID.test(data.conversationId)) {
    return { type: "invalidate", scope: "messages", conversationId: data.conversationId };
  }
  return null;
}

/** Ref-counted, injectable transport. Reconnects only GET requests; write
 * operations always remain explicit actions in their existing controllers. */
export function createSchoolRealtimeClient(runtime: SchoolRealtimeRuntime) {
  const listeners = new Set<Listener>();
  let status: SchoolRealtimeStatus = "connecting";
  let generation = 0;
  let stoppedByServer = false;
  let failures = 0;
  let request: AbortController | null = null;
  let stream: EventStream | null = null;
  let deadline: number | null = null;
  let retry: number | null = null;
  let unsubscribeEnvironment: (() => void) | null = null;
  const available = () => listeners.size > 0 && runtime.isOnline() && runtime.isVisible();
  function emit(update: SchoolRealtimeUpdate) {
    for (const listener of [...listeners]) {
      // A consumer error must not disconnect another section's transport.
      try { listener(update); } catch { /* No private error logging. */ }
    }
  }
  function change(next: SchoolRealtimeStatus) {
    if (status === next) return;
    status = next; emit({ type: "status", status });
  }
  function clearDeadline() { if (deadline !== null) runtime.clearTimer(deadline); deadline = null; }
  function clearRetry() { if (retry !== null) runtime.clearTimer(retry); retry = null; }
  function disconnect() {
    generation++;
    clearDeadline(); clearRetry();
    request?.abort(); request = null;
    stream?.close(); stream = null;
  }
  function reconnect(rotate = false) {
    disconnect();
    if (!available() || stoppedByServer) return;
    change("reconnecting");
    const delay = rotate ? 1_000 : Math.min(2_000 * 2 ** Math.min(failures++, 4), 30_000);
    retry = runtime.setTimer(() => { retry = null; void connect(); }, delay);
  }
  function terminal(next: "disabled" | "unauthorized") {
    disconnect(); stoppedByServer = true; change(next);
  }
  async function connect() {
    if (!available() || stoppedByServer) return;
    disconnect();
    const current = generation;
    const controller = new AbortController(); request = controller;
    deadline = runtime.setTimer(() => {
      if (current === generation) reconnect();
    }, 20_000);
    try {
      const response = await runtime.fetcher("/api/realtime/config", {
        method: "GET", credentials: "same-origin", cache: "no-store", signal: controller.signal,
      });
      if (current !== generation || !available()) return;
      if (response.status === 401 || response.status === 403) { terminal("unauthorized"); return; }
      if (!response.ok) { reconnect(); return; }
      const body = await response.text();
      if (current !== generation || !available()) return;
      if (body.length > 128) { reconnect(); return; }
      const config: unknown = JSON.parse(body);
      if (!config || typeof config !== "object" || Array.isArray(config) ||
          Object.keys(config).length !== 1 || typeof (config as { enabled?: unknown }).enabled !== "boolean") { reconnect(); return; }
      if (!(config as { enabled: boolean }).enabled) { terminal("disabled"); return; }
      clearDeadline(); request = null;
      const connection = runtime.openStream("/api/realtime/events"); stream = connection;
      const currentConnection = () => current === generation && stream === connection && available();
      // The server waits up to 25s for CDC confirmation or a terminal error.
      deadline = runtime.setTimer(() => { if (currentConnection()) reconnect(); }, 30_000);
      connection.addEventListener("ready", event => {
        if (!currentConnection()) return;
        const data = parseSignal(event);
        if (!data || Object.keys(data).length) return;
        clearDeadline(); failures = 0; change("connected");
        // Close before the hosting deadline even if a proxy loses the end event.
        deadline = runtime.setTimer(() => { if (currentConnection()) reconnect(true); }, 250_000);
      });
      connection.addEventListener("invalidate", event => {
        if (!currentConnection() || status !== "connected") return;
        const update = parseSchoolRealtimeInvalidation(event);
        if (update) emit(update);
      });
      connection.addEventListener("end", event => {
        if (!currentConnection()) return;
        const data = parseSignal(event);
        if (!data || Object.keys(data).length !== 1) return;
        if (data.reason === "unauthorized") terminal("unauthorized");
        else if (data.reason === "rotate") reconnect(true);
        else if (data.reason === "unavailable") reconnect();
      });
      // Close native EventSource immediately: this controller owns the backoff,
      // avoiding an additional native reconnect loop and duplicate requests.
      connection.addEventListener("error", () => { if (currentConnection()) reconnect(); });
    } catch {
      if (current === generation && available() && !stoppedByServer) reconnect();
    }
  }
  function environmentChanged() {
    if (!available()) { disconnect(); if (!stoppedByServer) change("reconnecting"); return; }
    if (!stoppedByServer && !request && !stream && retry === null) void connect();
  }
  return {
    subscribe(listener: Listener) {
      const subscription: Listener = update => listener(update);
      listeners.add(subscription);
      try { listener({ type: "status", status }); } catch { /* Isolate consumers. */ }
      if (listeners.size === 1) {
        unsubscribeEnvironment = runtime.subscribeEnvironment(environmentChanged);
        void connect();
      }
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false; listeners.delete(subscription);
        if (listeners.size) return;
        disconnect(); unsubscribeEnvironment?.(); unsubscribeEnvironment = null;
        status = "connecting"; stoppedByServer = false; failures = 0;
      };
    },
  };
}
let browserClient: ReturnType<typeof createSchoolRealtimeClient> | null = null;
export function subscribeSchoolRealtime(listener: Listener): () => void {
  if (typeof window === "undefined" || typeof EventSource === "undefined") {
    listener({ type: "status", status: "disabled" }); return () => {};
  }
  browserClient ??= createSchoolRealtimeClient({
    fetcher: (...args) => fetch(...args), openStream: url => new EventSource(url),
    isOnline: () => navigator.onLine, isVisible: () => document.visibilityState !== "hidden",
    subscribeEnvironment: callback => {
      window.addEventListener("online", callback); window.addEventListener("offline", callback);
      document.addEventListener("visibilitychange", callback);
      return () => {
        window.removeEventListener("online", callback); window.removeEventListener("offline", callback);
        document.removeEventListener("visibilitychange", callback);
      };
    },
    setTimer: (callback, delay) => window.setTimeout(callback, delay), clearTimer: id => window.clearTimeout(id),
  });
  return browserClient.subscribe(listener);
}
