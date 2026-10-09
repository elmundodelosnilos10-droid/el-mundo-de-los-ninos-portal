/** Browser-only access through the authenticated, private school API.
 * This is polling, not push delivery. No public URL or bearer token is used. */
export type SchoolNotice = { id: string; kind: string; title: string; href: string | null; createdAt: string; readAt: string | null };
export type NotificationState = {
  items: SchoolNotice[]; loaded: boolean; loading: boolean; error: string;
  markError: string; markingId: string; confirmedReadIds: string[]; online: boolean; paused: boolean;
};
export const NOTIFICATION_POLL_MS = 30_000;
export const NOTIFICATION_MAX_BACKOFF_MS = 120_000;
export const INITIAL_NOTIFICATION_STATE: NotificationState = {
  items: [], loaded: false, loading: true, error: "", markError: "", markingId: "", confirmedReadIds: [], online: true, paused: false,
};
export function notificationPollDelay(failures: number) {
  const count = Number.isFinite(failures) ? Math.max(0, Math.floor(failures)) : 0;
  return Math.min(NOTIFICATION_POLL_MS * 2 ** count, NOTIFICATION_MAX_BACKOFF_MS);
}
export class NotificationRequestError extends Error {
  readonly lostAccess: boolean;
  constructor(message: string, lostAccess = false) { super(message); this.lostAccess = lostAccess; }
}
function localHref(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !/[\\\u0000-\u001f\u007f]/.test(value));
}
function errorForStatus(status: number, marking: boolean) {
  if (status === 401) return new NotificationRequestError("Tu sesión terminó. Vuelve a iniciar sesión para consultar tus avisos.", true);
  if (status === 403) return new NotificationRequestError("No tienes acceso a estos avisos. Vuelve a iniciar sesión.", true);
  if (marking && status === 404) return new NotificationRequestError("Este aviso ya no está disponible. Actualiza la lista.");
  return new NotificationRequestError(marking ? "No se pudo confirmar que el aviso quedó leído. Inténtalo de nuevo." : "No se pudieron actualizar los avisos. Inténtalo de nuevo.");
}
async function privateRequest(init: RequestInit, signal: AbortSignal, fetcher: typeof fetch) {
  try {
    const response = await fetcher("/api/notifications", { ...init, credentials: "same-origin", cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) });
    if (!response.ok) throw errorForStatus(response.status, init.method === "PATCH");
    const data: unknown = await response.json();
    if (signal.aborted) throw new DOMException("Notification request cancelled", "AbortError");
    return data;
  } catch (cause) {
    if (signal.aborted || cause instanceof NotificationRequestError) throw cause;
    throw errorForStatus(503, init.method === "PATCH");
  }
}
export async function loadSchoolNotices(signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<SchoolNotice[]> {
  const data = await privateRequest({}, signal, fetcher);
  if (!data || typeof data !== "object" || !Array.isArray((data as { items?: unknown }).items)) throw errorForStatus(503, false);
  const rows = (data as { items: unknown[] }).items;
  const ids = new Set<string>();
  if (rows.length > 100) throw errorForStatus(503, false);
  return rows.map(value => {
    if (!value || typeof value !== "object") throw errorForStatus(503, false);
    const row = value as Record<string, unknown>;
    if (typeof row.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.id) || ids.has(row.id) ||
      typeof row.kind !== "string" || typeof row.title !== "string" || !row.title.trim() || !localHref(row.href) ||
      typeof row.createdAt !== "string" || !Number.isFinite(Date.parse(row.createdAt)) ||
      !(row.readAt === null || (typeof row.readAt === "string" && Number.isFinite(Date.parse(row.readAt))))) throw errorForStatus(503, false);
    ids.add(row.id);
    return { id: row.id, kind: row.kind, title: row.title, href: row.href, createdAt: row.createdAt, readAt: row.readAt } as SchoolNotice;
  });
}
export async function confirmNoticeRead(id: string, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  const data = await privateRequest({ method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }, signal, fetcher);
  if (!data || typeof data !== "object" || (data as { read?: unknown }).read !== true) throw errorForStatus(503, true);
}

type NotificationRuntime = {
  fetcher?: typeof fetch;
  isOnline: () => boolean; isVisible: () => boolean;
  subscribe: (listener: () => void) => () => void;
  setTimer: (callback: () => void, delay: number) => number;
  clearTimer: (timer: number) => void;
  onChange: (state: NotificationState) => void;
  onNavigate: (href: string) => void;
};
/** Serialize reads and explicit marks; cancellation never retries a PATCH.
 * The runtime is injectable so effects, cleanup and timing can be tested. */
export function createNotificationController(runtime: NotificationRuntime) {
  let active = false;
  let state: NotificationState = { ...INITIAL_NOTIFICATION_STATE, items: [], confirmedReadIds: [] };
  let timer: number | null = null;
  let request: AbortController | null = null;
  let busy = false;
  let pendingRead = false;
  let queuedMark: SchoolNotice | null = null;
  let failures = 0;
  let unsubscribe: (() => void) | null = null;
  const available = () => runtime.isOnline() && runtime.isVisible();
  function change(patch: Partial<NotificationState>) { if (!active) return; state = { ...state, ...patch }; runtime.onChange(state); }
  function clearTimer() { if (timer !== null) runtime.clearTimer(timer); timer = null; }
  function accessLost() { queuedMark = null; pendingRead = false; change({ items: [], loaded: false, markingId: "", confirmedReadIds: [] }); }
  function finish() {
    busy = false; request = null;
    if (!active || !available()) return;
    if (queuedMark) {
      const notice = state.items.find(item => item.id === queuedMark?.id); queuedMark = null;
      if (!notice) change({ markingId: "", markError: "Este aviso ya no está disponible. Actualiza la lista." });
      else if (notice.readAt || state.confirmedReadIds.includes(notice.id)) { change({ markingId: "" }); if (notice.href) runtime.onNavigate(notice.href); }
      else { void runMark(notice); return; }
    }
    if (pendingRead) { pendingRead = false; void runRead(); return; }
    timer = runtime.setTimer(() => { timer = null; refresh(); }, notificationPollDelay(failures));
  }
  async function runRead() {
    if (!active || !available()) return;
    busy = true; const controller = new AbortController(); request = controller;
    change({ loading: true });
    try {
      const items = await loadSchoolNotices(controller.signal, runtime.fetcher);
      if (!active || controller.signal.aborted) return;
      failures = 0;
      change({ items, loaded: true, loading: false, error: "", markError: "", confirmedReadIds: state.confirmedReadIds.filter(id => items.some(item => item.id === id && !item.readAt)) });
    } catch (cause) {
      if (!active || controller.signal.aborted) return;
      failures++;
      if (cause instanceof NotificationRequestError && cause.lostAccess) accessLost();
      change({ loading: false, error: cause instanceof NotificationRequestError ? cause.message : "No se pudieron actualizar los avisos. Inténtalo de nuevo." });
    } finally { finish(); }
  }
  async function runMark(notice: SchoolNotice) {
    if (!active || !available()) return;
    busy = true; const controller = new AbortController(); request = controller;
    change({ markingId: notice.id, markError: "" });
    try {
      await confirmNoticeRead(notice.id, controller.signal, runtime.fetcher);
      if (!active || controller.signal.aborted) return;
      change({ markingId: "", confirmedReadIds: [...new Set([...state.confirmedReadIds, notice.id])] });
      pendingRead = true;
      if (notice.href) runtime.onNavigate(notice.href);
    } catch (cause) {
      if (!active) return;
      if (cause instanceof NotificationRequestError && cause.lostAccess) accessLost();
      change({ markingId: "", markError: cause instanceof NotificationRequestError ? cause.message : "No se pudo confirmar que el aviso quedó leído. Actualiza la lista antes de intentarlo de nuevo." });
    } finally { finish(); }
  }
  function refresh() {
    if (!active) return;
    clearTimer();
    if (!available()) { change({ online: runtime.isOnline(), paused: !runtime.isVisible() }); return; }
    if (busy) { pendingRead = true; return; }
    void runRead();
  }
  function environmentChanged() {
    if (!active) return;
    const online = runtime.isOnline(); const visible = runtime.isVisible();
    change({ online, paused: !visible });
    if (online && visible) { refresh(); return; }
    clearTimer(); pendingRead = false;
    if (queuedMark) { queuedMark = null; change({ markingId: "", markError: "No se pudo confirmar que el aviso quedó leído. Actualiza la lista antes de intentarlo de nuevo." }); }
    request?.abort(); change({ loading: false });
  }
  return {
    start() { if (active) return; active = true; unsubscribe = runtime.subscribe(environmentChanged); change({ online: runtime.isOnline(), paused: !runtime.isVisible(), loading: available() }); refresh(); },
    refresh,
    mark(notice: SchoolNotice) {
      if (!active) return;
      const current = state.items.find(item => item.id === notice.id);
      if (!current) return;
      notice = current;
      if (!available()) { change({ markError: "Conéctate a internet para abrir y marcar este aviso." }); return; }
      if (state.markingId) return;
      if (notice.readAt || state.confirmedReadIds.includes(notice.id)) { if (notice.href) runtime.onNavigate(notice.href); return; }
      clearTimer(); change({ markingId: notice.id, markError: "" });
      if (busy) queuedMark = notice; else void runMark(notice);
    },
    dispose() { active = false; clearTimer(); unsubscribe?.(); unsubscribe = null; queuedMark = null; pendingRead = false; request?.abort(); },
  };
}
