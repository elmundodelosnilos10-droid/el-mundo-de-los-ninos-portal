import { encodeObservationCursor, isObservationUuid, makeObservationPage, OBSERVATION_PAGE_SIZE, parseObservationCursor, type ObservationPage, type Observation } from "./supabase/observation-page.ts";

export type ObservationState = {
  studentId: string; items: Observation[]; nextCursor: string | null; hasMore: boolean;
  loadingFirst: boolean; loadingMore: boolean; saving: boolean; accessDenied: boolean;
  readError: string; saveError: string; note: string; failedRead: "first" | "more" | null;
};
export const EMPTY_OBSERVATION_STATE: ObservationState = {
  studentId: "", items: [], nextCursor: null, hasMore: false, loadingFirst: false, loadingMore: false,
  saving: false, accessDenied: false, readError: "", saveError: "", note: "", failedRead: null,
};
type Runtime = { fetcher?: typeof fetch; onChange: (state: ObservationState) => void; onSaveConfirmed?: (studentId: string) => void };
class ObservationReadError extends Error {
  readonly lostAccess: boolean;
  constructor(lostAccess = false) { super(lostAccess ? "Este alumno ya no está disponible para tu cuenta. Actualiza la página o inicia sesión de nuevo." : "No se pudieron cargar los avances. Puedes volver a consultar."); this.lostAccess = lostAccess; }
}

export function validateObservationPage(value: unknown, studentId: string, requestedCursor: string | null): ObservationPage {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ObservationReadError();
  const page = value as Partial<ObservationPage>;
  if (!Array.isArray(page.items) || page.items.length > OBSERVATION_PAGE_SIZE || typeof page.hasMore !== "boolean" ||
      !(page.nextCursor === null || typeof page.nextCursor === "string")) throw new ObservationReadError();
  // The page builder checks row shapes, uniqueness, order and microseconds.
  const items = makeObservationPage(studentId, page.items).items;
  const last = items.at(-1);
  if (page.hasMore) {
    if (items.length !== OBSERVATION_PAGE_SIZE || !last || page.nextCursor !== encodeObservationCursor({ studentId, recordedAt: last.recordedAt, id: last.id })) throw new ObservationReadError();
    parseObservationCursor(page.nextCursor, studentId);
  } else if (page.nextCursor !== null) throw new ObservationReadError();
  const before = parseObservationCursor(requestedCursor, studentId);
  if (before && items.some(row => row.recordedAt > before.recordedAt || (row.recordedAt === before.recordedAt && row.id >= before.id))) throw new ObservationReadError();
  return { items, hasMore: page.hasMore, nextCursor: page.nextCursor };
}

/** One mounted view owns this controller. No identity, row or JWT is cached globally. */
export function createObservationController(runtime: Runtime) {
  const fetcher = runtime.fetcher ?? fetch;
  let state: ObservationState = { ...EMPTY_OBSERVATION_STATE }, revision = 0, readSerial = 0, disposed = false, writeLocked = false;
  let readController: AbortController | null = null;
  const publish = (patch: Partial<ObservationState>) => { if (!disposed) { state = { ...state, ...patch }; runtime.onChange(state); } };
  const current = (studentId: string, version: number) => !disposed && state.studentId === studentId && version === revision;

  async function read(mode: "first" | "more") {
    if (disposed || !state.studentId || state.accessDenied || (mode === "more" && (!state.hasMore || !state.nextCursor || state.loadingFirst || state.loadingMore || writeLocked))) return;
    const studentId = state.studentId, version = revision, cursor = mode === "more" ? state.nextCursor : null, serial = ++readSerial;
    readController?.abort(); const controller = new AbortController(); readController = controller;
    publish({ readError: "", failedRead: null, loadingFirst: mode === "first", loadingMore: mode === "more",
      ...(mode === "first" ? { items: [], hasMore: false, nextCursor: null } : {}) });
    try {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const response = await fetcher(`/api/students/${encodeURIComponent(studentId)}/observations${query}`, {
        method: "GET", cache: "no-store", credentials: "same-origin", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
      });
      if (!response.ok) throw new ObservationReadError([401, 403, 404].includes(response.status));
      const page = validateObservationPage(await response.json(), studentId, cursor);
      if (!current(studentId, version) || controller.signal.aborted || serial !== readSerial) return;
      const priorIds = new Set(state.items.map(item => item.id));
      if (mode === "more" && page.items.some(item => priorIds.has(item.id))) throw new ObservationReadError();
      publish({ items: mode === "more" ? [...state.items, ...page.items] : page.items, nextCursor: page.nextCursor, hasMore: page.hasMore });
    } catch (error) {
      if (!current(studentId, version) || controller.signal.aborted || serial !== readSerial) return;
      const lostAccess = error instanceof ObservationReadError && error.lostAccess;
      publish({ readError: error instanceof ObservationReadError ? error.message : "No se pudieron cargar los avances. Puedes volver a consultar.", failedRead: lostAccess ? null : mode,
        ...(lostAccess ? { items: [], hasMore: false, nextCursor: null, accessDenied: true } : {}) });
    } finally {
      if (current(studentId, version) && serial === readSerial) publish({ loadingFirst: false, loadingMore: false });
      if (readController === controller) readController = null;
    }
  }

  function selectStudent(studentId: string) {
    if (disposed || writeLocked || (!isObservationUuid(studentId) && studentId !== "")) return false;
    revision++; readSerial++; readController?.abort(); readController = null;
    state = { ...EMPTY_OBSERVATION_STATE, studentId }; runtime.onChange(state);
    if (studentId) void read("first");
    return true;
  }

  async function save(input: { category: string; body: string; visibleToFamily: boolean }) {
    if (disposed || writeLocked || !state.studentId || state.accessDenied) return;
    const studentId = state.studentId, version = revision;
    writeLocked = true; readSerial++; readController?.abort(); readController = null;
    publish({ saving: true, saveError: "", note: "", loadingFirst: false, loadingMore: false });
    let confirmed = false;
    try {
      // The write is submitted once. A timeout may still mean the server committed.
      const response = await fetcher(`/api/students/${encodeURIComponent(studentId)}/observations`, {
        method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(20_000),
      });
      if (!current(studentId, version)) return;
      if ([401, 403, 404].includes(response.status)) { publish({ accessDenied: true, items: [], hasMore: false, nextCursor: null }); throw new Error("access_lost"); }
      const data: unknown = await response.json();
      if (!current(studentId, version)) return;
      if (response.status !== 201 || !data || typeof data !== "object" || !isObservationUuid((data as { id?: unknown }).id)) throw new Error("save_not_confirmed");
      confirmed = true; publish({ note: "Observación guardada." });
      runtime.onSaveConfirmed?.(studentId);
      await read("first");
    } catch {
      if (current(studentId, version)) publish({ saveError: confirmed ? "La observación se guardó, pero no pudimos actualizar la vista. Vuelve a consultar los avances." : state.accessDenied ? "Tu cuenta ya no puede registrar avances para este alumno." : "No pudimos confirmar que se guardó. Consulta los avances antes de intentar enviarla otra vez; el envío no se repetirá automáticamente." });
    } finally {
      writeLocked = false;
      if (current(studentId, version)) publish({ saving: false });
    }
  }

  return {
    selectStudent, save,
    loadMore: () => read("more"),
    refresh: () => writeLocked ? Promise.resolve() : read("first"),
    retryRead: () => writeLocked || !state.failedRead ? Promise.resolve() : read(state.failedRead),
    getState: () => state,
    dispose() { disposed = true; revision++; readSerial++; readController?.abort(); readController = null; state = { ...EMPTY_OBSERVATION_STATE }; },
  };
}
