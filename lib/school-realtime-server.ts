/** Server-side SSE bridge. Credentials and database rows never cross this boundary. */
import { actorFromRequest, type Actor } from "@/lib/access";
import { env } from "@/lib/runtime/env";
import { subscribeSchoolDatabaseChanges, type SchoolRealtimeSubscriptionOptions, type SchoolRealtimeSubscription } from "@/lib/supabase/realtime";

type RealtimeEnvironment = {
  SCHOOL_REALTIME_PROVIDER?: string;
  SCHOOL_AUTH_PROVIDER?: string;
  SCHOOL_DATA_PROVIDER?: string;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
};
type EndReason = "rotate" | "unavailable" | "unauthorized";
type Dependencies = {
  environment: RealtimeEnvironment;
  actor: (request: Request) => Promise<Actor | null>;
  subscribe: (options: SchoolRealtimeSubscriptionOptions) => SchoolRealtimeSubscription;
  every: typeof setInterval;
  after: typeof setTimeout;
  clearEvery: typeof clearInterval;
  clearAfter: typeof clearTimeout;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const QUEUE_BYTES = 4096;
const LIFETIME_BYTES = 65_536;
const encoder = new TextEncoder();
const privateHeaders = { "Cache-Control": "private, no-store, no-cache, must-revalidate, no-transform", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };

/** Native EventSource GET may omit Origin. Explicit foreign origins are refused. */
export function isSchoolRealtimeOrigin(request: Request) {
  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  try { return origin === new URL(origin).origin && origin === new URL(request.url).origin; }
  catch { return false; }
}

function configured(environment: RealtimeEnvironment) {
  return environment.SCHOOL_REALTIME_PROVIDER === "supabase" && environment.SCHOOL_AUTH_PROVIDER === "supabase" && environment.SCHOOL_DATA_PROVIDER === "supabase";
}
function identity(actor: Actor | null) {
  return actor?.supabaseAuth && UUID.test(actor.id) && actor.supabaseAuth.userId === actor.id && actor.supabaseAuth.accessToken ? actor : null;
}
function canMessage(actor: Actor) { return actor.roles.some(role => role === "docente" || role === "tutor"); }
function jsonError(status: number, error: string) { return Response.json({ error }, { status, headers: privateHeaders }); }

/** Injection only replaces transport/session/timers in executable unit tests. */
export function createSchoolRealtimeHandlers(overrides: Partial<Dependencies> = {}) {
  const dependencies: Dependencies = {
    environment: env as RealtimeEnvironment, actor: actorFromRequest, subscribe: subscribeSchoolDatabaseChanges,
    every: setInterval, after: setTimeout, clearEvery: clearInterval, clearAfter: clearTimeout, ...overrides,
  };
  async function authorize(request: Request) {
    if (!isSchoolRealtimeOrigin(request)) return { response: jsonError(403, "Solicitud no válida.") };
    try {
      const actor = await dependencies.actor(request);
      if (!actor) return { response: jsonError(401, "Inicia sesión.") };
      return { actor };
    } catch { return { response: jsonError(503, "La sesión no está disponible.") }; }
  }
  async function configGET(request: Request) {
    const authorization = await authorize(request);
    if (authorization.response) return authorization.response;
    return Response.json({ enabled: configured(dependencies.environment) && Boolean(identity(authorization.actor)) }, { headers: privateHeaders });
  }
  async function eventsGET(request: Request) {
    const authorization = await authorize(request);
    if (authorization.response) return authorization.response;
    const actor = identity(authorization.actor);
    if (!configured(dependencies.environment)) return jsonError(503, "Los avisos en tiempo real no están disponibles.");
    if (!actor) return jsonError(401, "Vuelve a iniciar sesión.");
    if (request.signal.aborted) return jsonError(401, "La conexión se cerró.");
    const roles = [...actor.roles].sort().join(",");
    let subscription: SchoolRealtimeSubscription | undefined;
    let controller: ReadableStreamDefaultController<Uint8Array>;
    let closed = false;
    let ready = false;
    let checking = false;
    let pendingResync = false;
    let totalBytes = 0;
    const intervals: ReturnType<typeof setInterval>[] = [];
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    function cleanup() {
      for (const timer of intervals) dependencies.clearEvery(timer);
      for (const timer of timeouts) dependencies.clearAfter(timer);
      request.signal.removeEventListener("abort", abort);
      try { void subscription?.stop().catch(() => {}); } catch { /* No transport diagnostics. */ }
    }
    function finish(reason?: EndReason, cancelled = false) {
      if (closed) return;
      closed = true;
      cleanup();
      if (!cancelled) {
        try {
          if (reason) {
            const bytes = encoder.encode(`event: end\ndata: ${JSON.stringify({ reason })}\n\n`);
            if ((controller.desiredSize ?? 0) >= bytes.byteLength && totalBytes + bytes.byteLength <= LIFETIME_BYTES) controller.enqueue(bytes);
          }
          controller.close();
        } catch { /* Reader has already cancelled. */ }
      }
    }
    function abort() { finish(undefined); }
    function write(frame: string) {
      if (closed) return;
      const bytes = encoder.encode(frame);
      if (bytes.byteLength > 256 || totalBytes + bytes.byteLength > LIFETIME_BYTES || (controller.desiredSize ?? 0) < bytes.byteLength) { finish("unavailable"); return; }
      try { controller.enqueue(bytes); totalBytes += bytes.byteLength; }
      catch { finish(undefined, true); }
    }
    function event(name: "ready" | "invalidate", data: object) { write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`); }
    const stream = new ReadableStream<Uint8Array>({
      start(streamController) {
        controller = streamController;
        request.signal.addEventListener("abort", abort, { once: true });
        if (request.signal.aborted) { abort(); return; }
        intervals.push(dependencies.every(() => write(": heartbeat\n\n"), 15_000));
        intervals.push(dependencies.every(() => {
          if (closed || checking) return;
          checking = true;
          const verificationDeadline = dependencies.after(() => finish("unavailable"), 20_000);
          timeouts.push(verificationDeadline);
          void Promise.resolve().then(() => dependencies.actor(request)).then(current => {
            if (closed) return;
            const account = identity(current);
            if (!account || account.id !== actor.id || [...account.roles].sort().join(",") !== roles) finish("unauthorized");
            else {
              checking = false;
              // Buffer only a content-free resync flag across an authorization
              // check; recover missed changes without retaining private IDs.
              if (pendingResync && ready) { pendingResync = false; event("invalidate", { scope: "all" }); }
            }
          }, () => finish("unavailable")).finally(() => { dependencies.clearAfter(verificationDeadline); checking = false; });
        }, 30_000));
        timeouts.push(dependencies.after(() => finish("rotate"), 240_000));
        timeouts.push(dependencies.after(() => { if (!ready) finish("unavailable"); }, 15_000));
        try {
          subscription = dependencies.subscribe({
            url: dependencies.environment.SUPABASE_URL ?? "", publishableKey: dependencies.environment.SUPABASE_PUBLISHABLE_KEY ?? "",
            accessToken: actor.supabaseAuth!.accessToken, userId: actor.id, canMessage: canMessage(actor),
            onReady() { if (closed || ready) return; ready = true; event("ready", {}); },
            onInvalidate(invalidation) {
              if (closed || !ready) return;
              if (checking) { pendingResync = true; return; }
              // Reconstruct the envelope, even if an upstream adapter supplies extra fields.
              if (invalidation.scope === "notifications") event("invalidate", { scope: "notifications" });
              else if (canMessage(actor) && invalidation.scope === "communication") event("invalidate", { scope: "communication" });
              else if (canMessage(actor) && invalidation.scope === "messages" && typeof invalidation.conversationId === "string" && UUID.test(invalidation.conversationId)) event("invalidate", { scope: "messages", conversationId: invalidation.conversationId });
            },
            onFailure() { finish("unavailable"); },
          });
          // A synchronous adapter callback can close before its handle is returned.
          if (closed) cleanup();
        } catch { finish("unavailable"); }
      },
      cancel() { finish(undefined, true); },
    }, { highWaterMark: QUEUE_BYTES, size: chunk => chunk.byteLength });
    return new Response(stream, { headers: { ...privateHeaders, "Content-Type": "text/event-stream; charset=utf-8", "X-Accel-Buffering": "no" } });
  }
  return { configGET, eventsGET };
}

export const schoolRealtimeHandlers = createSchoolRealtimeHandlers();
