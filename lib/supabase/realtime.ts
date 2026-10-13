/** Server-only, caller-JWT subscription. Never import this module in client UI. */
import { RealtimeClient } from "@supabase/realtime-js";
import { schoolRealtimeTransport } from "@/lib/runtime/realtime-transport";

export type SchoolRealtimeInvalidation =
  | { scope: "notifications" }
  | { scope: "messages"; conversationId: string }
  | { scope: "communication" };
export type SchoolRealtimeFailure = "configuration" | "connection";
export type SchoolRealtimeSubscriptionOptions = {
  url: string;
  publishableKey: string;
  /** Already verified by the server's Supabase Auth/session layer. */
  accessToken: string;
  userId: string;
  canMessage: boolean;
  onReady: () => void;
  onInvalidate: (event: SchoolRealtimeInvalidation) => void;
  onFailure: (reason: SchoolRealtimeFailure) => void;
};
export type SchoolRealtimeSubscription = { stop: () => Promise<void> };
export type SchoolRealtimeFilter = {
  event: "INSERT" | "UPDATE";
  schema: "public";
  table: "notifications" | "messages" | "communication_settings";
  filter?: string;
};
/** Minimal transport seam: mocks exercise callbacks, not database authorization. */
export type SchoolRealtimeChannel = {
  on: (filter: SchoolRealtimeFilter, callback: (payload: unknown) => void) => void;
  subscribe: (callback: (status: string) => void) => void;
  unsubscribe: () => Promise<unknown>;
};
export type SchoolRealtimeClient = {
  setAuth: (token: string) => Promise<void>;
  channel: (name: string) => SchoolRealtimeChannel;
  disconnect: () => void | Promise<unknown>;
};
export type SchoolRealtimeClientFactory = (
  endpoint: string,
  credentials: { publishableKey: string; accessToken: string },
) => SchoolRealtimeClient;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FAILURE_STATUSES = new Set(["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"]);

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function claims(token: string) {
  if (typeof token !== "string" || token.length > 16_384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  try {
    const segment = token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/");
    return object(JSON.parse(atob(segment.padEnd(Math.ceil(segment.length / 4) * 4, "="))));
  } catch { return null; }
}

function validConfiguration(options: SchoolRealtimeSubscriptionOptions) {
  if (typeof window !== "undefined" || typeof options.userId !== "string" || !UUID.test(options.userId) || typeof options.canMessage !== "boolean") return null;
  const jwt = claims(options.accessToken);
  // Shape checks do not verify a signature: caller Auth and Supabase verify it.
  if (!jwt || jwt.role !== "authenticated" || jwt.sub !== options.userId || typeof jwt.exp !== "number" || !Number.isFinite(jwt.exp) || jwt.exp * 1000 <= Date.now()) return null;
  if (typeof options.publishableKey !== "string" || options.publishableKey.length > 16_384) return null;
  const publishable = /^sb_publishable_[A-Za-z0-9_-]{20,200}$/.test(options.publishableKey);
  const legacyAnon = claims(options.publishableKey)?.role === "anon";
  if (!publishable && !legacyAnon) return null;
  try {
    const url = new URL(options.url);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && local)) || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) return null;
    return `${url.origin}/realtime/v1`;
  } catch { return null; }
}

const sdkClientFactory: SchoolRealtimeClientFactory = (endpoint, credentials) => {
  const client = new RealtimeClient(endpoint, {
    transport: schoolRealtimeTransport,
    params: { apikey: credentials.publishableKey },
    accessToken: async () => credentials.accessToken,
    timeout: 10_000,
    heartbeatIntervalMs: 25_000,
    // SDK diagnostics may contain payloads or credentials. They stay disabled.
    logger: () => {},
  });
  return {
    setAuth: token => client.setAuth(token),
    channel: name => {
      // Join alone can precede the CDC subscription. The SDK adds its 10s
      // error-reply grace to this 10s server wait, giving a bounded 20s join.
      const channel = client.channel(name, {
        config: { postgres_changes_options: { wait: true, timeout: 10_000 } },
      });
      return {
        on: (filter, callback) => { channel.on("postgres_changes", filter, payload => callback(payload)); },
        subscribe: callback => { channel.subscribe(status => callback(status)); },
        unsubscribe: async () => {
          try { return await channel.unsubscribe(1_000); }
          finally { channel.teardown(); }
        },
      };
    },
    disconnect: () => client.disconnect(),
  };
};

/**
 * Returns immediately; JWT setup/subscription happens asynchronously. stop() is
 * idempotent, suppresses callbacks immediately and closes the transport even if
 * authorization is still pending. The caller must stop on abort/session expiry.
 */
export function subscribeSchoolDatabaseChanges(
  options: SchoolRealtimeSubscriptionOptions,
  clientFactory: SchoolRealtimeClientFactory = sdkClientFactory,
): SchoolRealtimeSubscription {
  let client: SchoolRealtimeClient | null = null;
  let channel: SchoolRealtimeChannel | null = null;
  let stopped = false;
  let failed = false;
  let ready = false;
  let stopping: Promise<void> | null = null;
  const stop = () => {
    if (stopping) return stopping;
    stopped = true;
    let pending: Promise<unknown> | undefined;
    let disconnecting: void | Promise<unknown> = undefined;
    try { pending = channel?.unsubscribe(); } catch { /* Still disconnect. */ }
    try { disconnecting = client?.disconnect(); } catch { /* No diagnostics or reconnect. */ }
    stopping = Promise.allSettled([pending, disconnecting]).then(() => {});
    return stopping;
  };
  const fail = (reason: SchoolRealtimeFailure) => {
    if (stopped || failed) return;
    failed = true;
    void stop();
    try { options.onFailure(reason); } catch { /* Consumer cannot leak SDK errors. */ }
  };
  const invalidate = (event: SchoolRealtimeInvalidation) => {
    if (stopped || failed || !ready) return;
    try { options.onInvalidate(event); } catch { fail("connection"); }
  };
  const listen = (filter: SchoolRealtimeFilter) => {
    channel?.on(filter, payload => {
      if (stopped || failed || !ready) return;
      const change = object(payload);
      if (!change || change.schema !== "public" || change.table !== filter.table || change.eventType !== filter.event) return;
      const row = object(change.new);
      if (!row) return;
      if (filter.table === "notifications") {
        if (row.user_id === options.userId) invalidate({ scope: "notifications" });
      } else if (filter.table === "messages") {
        if (typeof row.conversation_id === "string" && UUID.test(row.conversation_id)) invalidate({ scope: "messages", conversationId: row.conversation_id });
      } else if (row.id === "school") invalidate({ scope: "communication" });
    });
  };
  void Promise.resolve().then(async () => {
    if (stopped) return;
    const endpoint = validConfiguration(options);
    if (!endpoint) { fail("configuration"); return; }
    try {
      client = clientFactory(endpoint, { publishableKey: options.publishableKey, accessToken: options.accessToken });
      await client.setAuth(options.accessToken);
      if (stopped) return;
      channel = client.channel(`school-changes:${options.userId}`);
      for (const event of ["INSERT", "UPDATE"] as const) {
        listen({ event, schema: "public", table: "notifications", filter: `user_id=eq.${options.userId}` });
        if (options.canMessage) listen({ event, schema: "public", table: "messages" });
      }
      if (options.canMessage) listen({ event: "UPDATE", schema: "public", table: "communication_settings", filter: "id=eq.school" });
      channel.subscribe(status => {
        if (stopped || failed) return;
        if (FAILURE_STATUSES.has(status)) { fail("connection"); return; }
        if (status === "SUBSCRIBED" && !ready) {
          ready = true;
          try { options.onReady(); } catch { fail("connection"); }
        }
      });
    } catch { fail("connection"); }
  });
  return { stop };
}
