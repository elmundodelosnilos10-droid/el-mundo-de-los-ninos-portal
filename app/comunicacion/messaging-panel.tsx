"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { subscribeSchoolRealtime, type SchoolRealtimeUpdate } from "@/lib/school-realtime-client";
import { SCHOOL_UPLOAD_MAX_FILE_BYTES, SCHOOL_UPLOAD_LIMIT_LABEL, SCHOOL_UPLOAD_SIZE_MESSAGE, SCHOOL_UPLOAD_UNAVAILABLE_MESSAGE, readSchoolUploadResponse } from "@/lib/school-upload-limits";
import type { CommunicationHours } from "@/lib/communication-hours";
import { CHAT_POLL_BASE_DELAY_MS, chatPollDelayForFailures } from "@/lib/polling-policy";

export type Contact = { studentId: string; studentName: string; teacherId: string; teacherName: string; guardianId?: string; guardianName?: string };
type Conversation = { id: string; studentId: string; studentName: string; studentFamilyName: string; teacherName?: string; guardianName?: string; unreadCount?: number };
type Message = { id: string; body: string; sentAt: string; order: number | string; authorName: string; isMine: boolean; readAt: string | null; file: { id: string; name: string; url: string } | null };
type MessagePage = { error?: string; items?: Message[]; hasOlder?: boolean };
type ChatConnectionState = "idle" | "connecting" | "connected" | "reconnecting" | "error";

class ChatPollError extends Error {
  constructor(message: string, readonly terminal: boolean) { super(message); }
}

const validReceiptId = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
const CHAT_ACCESS_MESSAGE = "No se pudo verificar tu acceso al chat. Vuelve a cargar la página o inicia sesión de nuevo.";
function chatRequestSignal(signal?: AbortSignal) {
  const deadline = AbortSignal.timeout(20_000);
  return signal ? AbortSignal.any([signal, deadline]) : deadline;
}

function mergeMessages(current: Message[], incoming: Message[]) {
  const byId = new Map(current.map(message => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => compareMessageOrder(a.order, b.order));
}

function compareMessageOrder(a: number | string, b: number | string) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const left = String(a);
  const right = String(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

export function MessagingPanel({ contacts, canMessage, communicationHours, uploadsReady = false }: { contacts: Contact[]; canMessage: boolean; communicationHours: CommunicationHours; uploadsReady?: boolean }) {
  const router = useRouter();
  const [realtimeStatus, setRealtimeStatus] = useState<Extract<SchoolRealtimeUpdate, { type: "status" }>["status"]>("disabled");
  const [list, setList] = useState<Conversation[]>([]);
  const [active, setActive] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sending, setSending] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [connectionState, setConnectionState] = useState<ChatConnectionState>("idle");
  const [accessDenied, setAccessDenied] = useState(false);
  const mounted = useRef(false);
  const mutationPending = useRef(false);
  const [starting, setStarting] = useState(false);
  const accessBlocked = useRef(false);
  const accessRevision = useRef(0);
  const latestActive = useRef("");
  const olderRequest = useRef<AbortController | null>(null);
  const cancelListRequest = useRef<(() => void) | null>(null);
  const cancelActiveRequest = useRef<(() => void) | null>(null);
  const loadedOlderPages = useRef(false);
  const listLoader = useRef<(() => Promise<void>) | null>(null);
  const requestListRefresh = useRef<(() => void) | null>(null);
  const requestActiveRefresh = useRef<{ conversationId: string; refresh: () => void } | null>(null);

  const cancelLifecycle = useCallback(() => { mounted.current = false; accessRevision.current++; }, []);
  useEffect(() => { mounted.current = true; return cancelLifecycle; }, [cancelLifecycle]);
  useEffect(() => {
    if (canMessage) return;
    accessRevision.current++; latestActive.current = "";
    olderRequest.current?.abort(); olderRequest.current = null;
    cancelListRequest.current?.(); cancelActiveRequest.current?.();
    loadedOlderPages.current = false;
    // Permission withdrawal must erase cached private data before it can be shown again.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setList([]); setMessages([]); setActive(""); setHasOlder(false); setLoadingOlder(false);
    setNotice(""); setError(""); setConnectionState("idle");
  }, [canMessage]);

  const clearChatAccess = useCallback(() => {
    accessBlocked.current = true; accessRevision.current++;
    latestActive.current = ""; olderRequest.current?.abort(); olderRequest.current = null;
    cancelListRequest.current?.(); cancelActiveRequest.current?.();
    loadedOlderPages.current = false;
    setList([]); setMessages([]); setActive(""); setHasOlder(false); setLoadingOlder(false); setSending(false);
    setNotice(""); setError(CHAT_ACCESS_MESSAGE); setConnectionState("error"); setAccessDenied(true);
  }, []);

  const clearConversation = useCallback((id: string) => {
    if (latestActive.current !== id) return;
    latestActive.current = ""; olderRequest.current?.abort(); olderRequest.current = null;
    cancelActiveRequest.current?.(); loadedOlderPages.current = false;
    setMessages([]); setActive(""); setHasOlder(false); setLoadingOlder(false);
    setList(current => current.filter(conversation => conversation.id !== id));
    setNotice(""); setError("La conversación ya no está disponible. Actualiza las conversaciones o consulta con la escuela."); setConnectionState("error");
  }, []);

  const refreshList = useCallback(async () => {
    if (!canMessage || accessBlocked.current) return;
    await listLoader.current?.();
  }, [canMessage]);

  async function refreshMessages(id: string) {
    if (!canMessage || accessBlocked.current) return;
    // Use the same active poller as SSE invalidations and the fallback timer.
    // A response for a previously selected chat must not merge into this one.
    if (requestActiveRefresh.current?.conversationId === id) requestActiveRefresh.current.refresh();
    else await refreshList();
  }

  const markPageRead = useCallback(async (id: string, page: MessagePage, signal?: AbortSignal): Promise<MessagePage> => {
    if (!canMessage || accessBlocked.current || latestActive.current !== id || signal?.aborted) throw new DOMException("Chat changed", "AbortError");
    const revision = accessRevision.current;
    const unread = (page.items ?? []).filter(message => !message.isMine && !message.readAt);
    if (!unread.length) return page;
    const throughOrder = unread.reduce((latest, message) => compareMessageOrder(message.order, latest) > 0 ? message.order : latest, unread[0].order);
    const response = await fetch(`/api/conversations/${id}/messages/read`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ throughOrder }), signal: chatRequestSignal(signal),
    });
    if (signal?.aborted || latestActive.current !== id || accessRevision.current !== revision) throw new DOMException("Chat changed", "AbortError");
    if ([401, 403].includes(response.status)) { clearChatAccess(); throw new ChatPollError(CHAT_ACCESS_MESSAGE, true); }
    if (response.status === 404) { clearConversation(id); throw new ChatPollError("Conversación no disponible.", true); }
    const result = await response.json() as { error?: string; readAt?: string };
    if (signal?.aborted || latestActive.current !== id || accessRevision.current !== revision) throw new DOMException("Chat changed", "AbortError");
    if (response.status !== 200 || typeof result.readAt !== "string" || !Number.isFinite(Date.parse(result.readAt))) throw Error("No se pudo registrar la lectura del chat.");
    return { ...page, items: (page.items ?? []).map(message => !message.isMine && !message.readAt && compareMessageOrder(message.order, throughOrder) <= 0 ? { ...message, readAt: result.readAt! } : message) };
  }, [canMessage, clearChatAccess, clearConversation]);

  useEffect(() => {
    if (!canMessage) return;
    let cancelled = false;
    let pendingRefresh = false;
    let pending: Promise<void> | null = null;
    let controller: AbortController | null = null;
    const available = () => document.visibilityState !== "hidden" && navigator.onLine;
    const load = (): Promise<void> => {
      if (cancelled || accessBlocked.current) return Promise.resolve();
      if (!available()) { pendingRefresh = true; return Promise.resolve(); }
      if (pending) return pending;
      controller = new AbortController();
      const currentController = controller;
      const revision = accessRevision.current;
      pending = fetch("/api/conversations", { cache: "no-store", signal: chatRequestSignal(currentController.signal) })
        .then(async response => {
          if (!cancelled && !currentController.signal.aborted && accessRevision.current === revision && [401, 403].includes(response.status)) { clearChatAccess(); throw new ChatPollError(CHAT_ACCESS_MESSAGE, true); }
          return { response, data: await response.json() as { error?: string; items?: Conversation[] } };
        })
        .then(({ response, data }) => {
          if (cancelled || currentController.signal.aborted || accessRevision.current !== revision) return;
          if (!response.ok) throw new ChatPollError(data.error || "No se cargaron las conversaciones.", false);
          setList(data.items ?? []);
        }).finally(() => {
          pending = null;
          if (controller === currentController) controller = null;
          if (!cancelled && pendingRefresh && available()) { pendingRefresh = false; requestRefresh(); }
        });
      return pending;
    };
    const requestRefresh = () => {
      if (cancelled || accessBlocked.current) return;
      if (pending || !available()) { pendingRefresh = true; return; }
      void load().catch(cause => { if (!cancelled && !(cause instanceof Error && cause.name === "AbortError")) setError(cause instanceof ChatPollError ? cause.message : "No se cargaron las conversaciones. Revisa la conexión e inténtalo de nuevo."); });
    };
    const onEnvironmentChange = () => {
      if (!available()) { controller?.abort(); pendingRefresh = true; }
      else if (pendingRefresh) requestRefresh();
    };
    const cancelRequest = () => { pendingRefresh = false; controller?.abort(); };
    cancelListRequest.current = cancelRequest;
    listLoader.current = load; requestListRefresh.current = requestRefresh;
    document.addEventListener("visibilitychange", onEnvironmentChange); window.addEventListener("online", onEnvironmentChange); window.addEventListener("offline", onEnvironmentChange);
    requestRefresh();
    return () => {
      cancelled = true; controller?.abort();
      if (cancelListRequest.current === cancelRequest) cancelListRequest.current = null;
      if (listLoader.current === load) listLoader.current = null;
      if (requestListRefresh.current === requestRefresh) requestListRefresh.current = null;
      document.removeEventListener("visibilitychange", onEnvironmentChange); window.removeEventListener("online", onEnvironmentChange); window.removeEventListener("offline", onEnvironmentChange);
    };
  }, [canMessage, clearChatAccess]);
  useEffect(() => {
    if (!canMessage || !active || accessBlocked.current) return;
    let cancelled = false;
    let stopPolling = false;
    let inFlight = false;
    let pollWhenFinished = false;
    let failures = 0;
    let hasConnected = false;
    let currentRetryDelay = CHAT_POLL_BASE_DELAY_MS;
    let timer: number | undefined;
    let controller: AbortController | undefined;

    const schedule = (delay: number) => {
      if (cancelled || stopPolling || document.visibilityState === "hidden") return;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => { timer = undefined; void poll(); }, delay);
    };

    const requestJson = async <T,>(url: string, signal: AbortSignal): Promise<T> => {
      const response = await fetch(url, { cache: "no-store", signal: chatRequestSignal(signal) });
      if (signal.aborted || accessBlocked.current || latestActive.current !== active) throw new DOMException("Chat changed", "AbortError");
      if ([401, 403].includes(response.status)) { clearChatAccess(); throw new ChatPollError(CHAT_ACCESS_MESSAGE, true); }
      if (response.status === 404) { clearConversation(active); throw new ChatPollError("Conversación no disponible.", true); }
      const data = await response.json() as T & { error?: string };
      if (!response.ok) throw new ChatPollError(data.error || "No se pudo actualizar el chat.", [401, 403, 404].includes(response.status));
      return data;
    };

    const poll = async () => {
      if (cancelled || stopPolling || accessBlocked.current || inFlight || document.visibilityState === "hidden") return;
      if (!navigator.onLine) {
        setConnectionState("reconnecting");
        schedule(chatPollDelayForFailures(failures));
        failures += 1;
        return;
      }
      inFlight = true;
      controller = new AbortController();
      const currentController = controller;
      if (!hasConnected) setConnectionState("connecting");
      try {
        let data = await requestJson<MessagePage>(`/api/conversations/${active}/messages`, currentController.signal);
        if (cancelled || currentController.signal.aborted || accessBlocked.current || latestActive.current !== active) return;
        data = await markPageRead(active, data, currentController.signal);
        if (cancelled || currentController.signal.aborted || accessBlocked.current || latestActive.current !== active) return;
        setMessages(current => mergeMessages(current, data.items ?? []));
        if (!loadedOlderPages.current) setHasOlder(Boolean(data.hasOlder));
        await refreshList();
        if (cancelled || currentController.signal.aborted || accessBlocked.current || latestActive.current !== active) return;
        failures = 0;
        currentRetryDelay = CHAT_POLL_BASE_DELAY_MS;
        hasConnected = true;
        setConnectionState("connected");
      } catch (cause) {
        if (cancelled || currentController.signal.aborted || latestActive.current !== active) return;
        if (cause instanceof ChatPollError && cause.terminal) {
          stopPolling = true;
          setConnectionState("error");
          setError(cause.message);
          return;
        }
        const retryDelay = chatPollDelayForFailures(failures);
        failures += 1;
        currentRetryDelay = retryDelay;
        setConnectionState("reconnecting");
      } finally {
        inFlight = false;
        if (controller === currentController) controller = undefined;
        if (cancelled || stopPolling || latestActive.current !== active) return;
        if (pollWhenFinished && document.visibilityState === "visible") {
          pollWhenFinished = false;
          failures = 0;
          void poll();
        } else schedule(currentRetryDelay);
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        if (timer !== undefined) window.clearTimeout(timer);
        timer = undefined;
        controller?.abort();
      } else if (inFlight) pollWhenFinished = true;
      else { failures = 0; currentRetryDelay = CHAT_POLL_BASE_DELAY_MS; void poll(); }
    };
    const onOnline = () => {
      failures = 0;
      currentRetryDelay = CHAT_POLL_BASE_DELAY_MS;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
      if (inFlight) pollWhenFinished = true;
      else void poll();
    };
    const onOffline = () => {
      setConnectionState("reconnecting");
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
      if (!inFlight) schedule(chatPollDelayForFailures(failures++));
    };

    const requestRefresh = () => {
      if (cancelled || stopPolling || accessBlocked.current || document.visibilityState === "hidden" || !navigator.onLine) return;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
      if (inFlight) pollWhenFinished = true;
      else void poll();
    };
    const cancelRequest = () => {
      stopPolling = true; pollWhenFinished = false; controller?.abort();
      if (timer !== undefined) window.clearTimeout(timer); timer = undefined;
    };
    cancelActiveRequest.current = cancelRequest;
    requestActiveRefresh.current = { conversationId: active, refresh: requestRefresh };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    void poll();
    return () => {
      cancelled = true;
      if (cancelActiveRequest.current === cancelRequest) cancelActiveRequest.current = null;
      if (requestActiveRefresh.current?.refresh === requestRefresh) requestActiveRefresh.current = null;
      if (timer !== undefined) window.clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [active, canMessage, markPageRead, refreshList, clearChatAccess, clearConversation]);

  useEffect(() => {
    if (!canMessage) return;
    let cancelled = false;
    let previousStatus = "disabled";
    let settingsTimer: number | undefined;
    const refreshHours = () => {
      if (settingsTimer !== undefined || document.visibilityState === "hidden" || !navigator.onLine) return;
      settingsTimer = window.setTimeout(() => { settingsTimer = undefined; if (!cancelled && document.visibilityState !== "hidden" && navigator.onLine) router.refresh(); }, 200);
    };
    const refreshChat = (conversationId?: string) => {
      const selected = requestActiveRefresh.current;
      if (selected && (!conversationId || selected.conversationId === conversationId)) selected.refresh();
      else requestListRefresh.current?.();
    };
    const unsubscribe = subscribeSchoolRealtime(update => {
      if (cancelled) return;
      if (update.type === "status") {
        setRealtimeStatus(update.status);
        if (update.status === "connected" && previousStatus !== "connected") { refreshChat(); refreshHours(); }
        if (update.status === "unauthorized") { clearChatAccess(); refreshHours(); }
        previousStatus = update.status;
      } else if (update.scope === "messages") refreshChat(update.conversationId);
      else if (update.scope === "communication") refreshHours();
      else if (update.scope === "all") { refreshChat(); refreshHours(); }
    });
    return () => { cancelled = true; unsubscribe(); if (settingsTimer !== undefined) window.clearTimeout(settingsTimer); };
  }, [canMessage, router, clearChatAccess]);

  useEffect(() => () => { olderRequest.current?.abort(); olderRequest.current = null; }, [active, canMessage]);

  async function loadOlderMessages() {
    if (!canMessage || accessBlocked.current || !active || latestActive.current !== active || !messages.length || loadingOlder || olderRequest.current) return;
    const conversationId = active;
    const revision = accessRevision.current;
    const controller = new AbortController(); olderRequest.current = controller;
    const current = () => !controller.signal.aborted && latestActive.current === conversationId && accessRevision.current === revision && !accessBlocked.current;
    const oldest = messages[0];
    setLoadingOlder(true); setError("");
    try {
      const params = new URLSearchParams({ beforeOrder: String(oldest.order) });
      const response = await fetch(`/api/conversations/${conversationId}/messages?${params}`, { cache: "no-store", signal: chatRequestSignal(controller.signal) });
      if (!current()) return;
      if ([401, 403].includes(response.status)) { clearChatAccess(); return; }
      if (response.status === 404) { clearConversation(conversationId); return; }
      let data = await response.json() as MessagePage;
      if (!current()) return;
      if (!response.ok) throw Error(data.error || "No se cargó el historial anterior.");
      data = await markPageRead(conversationId, data, controller.signal);
      if (!current()) return;
      setMessages(previous => mergeMessages(previous, data.items ?? []));
      setHasOlder(Boolean(data.hasOlder)); loadedOlderPages.current = true;
    } catch (cause) {
      if (current()) setError(cause instanceof ChatPollError ? cause.message : "No se cargó el historial anterior. Revisa la conexión e inténtalo de nuevo.");
    } finally {
      if (olderRequest.current === controller) olderRequest.current = null;
      if (current()) setLoadingOlder(false);
    }
  }

  function openConversation(id: string) {
    if (!canMessage || accessBlocked.current || mutationPending.current || id === active) return;
    latestActive.current = id; olderRequest.current?.abort(); olderRequest.current = null; setLoadingOlder(false);
    setMessages([]);
    setHasOlder(false);
    setError("");
    setNotice("");
    setConnectionState("connecting");
    loadedOlderPages.current = false;
    setActive(id);
  }

  async function start(contact: Contact) {
    if (!canMessage || !mounted.current || accessBlocked.current || mutationPending.current) return;
    mutationPending.current = true;
    const revision = accessRevision.current;
    const current = () => mounted.current && !accessBlocked.current && revision === accessRevision.current;
    setStarting(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/conversations", { method: "POST", credentials: "same-origin", signal: chatRequestSignal(), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studentId: contact.studentId, teacherId: contact.teacherId, guardianId: contact.guardianId }) });
      if (!current()) return;
      if ([401, 403].includes(response.status)) { clearChatAccess(); return; }
      const data = await response.json() as { id?: string; error?: string };
      if (!current()) return;
      if (![200, 201].includes(response.status) || !validReceiptId(data.id)) throw Error("No pudimos confirmar el chat. Actualiza las conversaciones antes de volver a intentarlo.");
      latestActive.current = data.id; olderRequest.current?.abort(); olderRequest.current = null; setLoadingOlder(false);
      setMessages([]); setHasOlder(false); loadedOlderPages.current = false; setConnectionState("connecting"); setActive(data.id);
      setNotice("Conversación lista.");
      try { await refreshList(); }
      catch { if (current()) setError("El chat está confirmado, pero no se pudo actualizar la lista. Pulsa Actualizar conversaciones."); }
    } catch {
      if (current()) setError("No pudimos confirmar el chat. Actualiza las conversaciones antes de volver a intentarlo.");
    } finally {
      mutationPending.current = false;
      if (mounted.current) setStarting(false);
    }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!canMessage || !mounted.current || accessBlocked.current || mutationPending.current || !active || latestActive.current !== active) return;
    const revision = accessRevision.current;
    const conversationId = active;
    const current = () => mounted.current && !accessBlocked.current && revision === accessRevision.current && latestActive.current === conversationId;
    const form = event.currentTarget;
    const payload = new FormData(form);
    const file = payload.get("file");
    const fileSelected = file instanceof File && file.size > 0;
    if (fileSelected && file.size > SCHOOL_UPLOAD_MAX_FILE_BYTES) { setError(SCHOOL_UPLOAD_SIZE_MESSAGE); setNotice(""); return; }
    if (fileSelected && !uploadsReady) { setError(SCHOOL_UPLOAD_UNAVAILABLE_MESSAGE); setNotice(""); return; }
    if (!String(payload.get("body") ?? "").trim() && !fileSelected) { setError("Escribe un mensaje o selecciona un archivo."); return; }
    mutationPending.current = true;
    setError(""); setNotice(""); setSending(true);
    try {
      const response = await fetch(`/api/conversations/${conversationId}/messages`, { method: "POST", credentials: "same-origin", signal: chatRequestSignal(), body: payload });
      if (!current()) return;
      if ([401, 403].includes(response.status)) { clearChatAccess(); return; }
      if (response.status === 404) { clearConversation(conversationId); return; }
      if (response.status === 413) { setError(SCHOOL_UPLOAD_SIZE_MESSAGE); return; }
      const result = await readSchoolUploadResponse(response) as { id?: unknown; error?: unknown } | null;
      if (!current()) return;
      if (response.status !== 201 || !validReceiptId(result?.id)) {
        const rejected = !response.ok && typeof result?.error === "string" ? result.error : "";
        setError(rejected ? `${rejected} No se confirmó el envío; consulta el chat antes de volver a enviarlo.` : "No pudimos confirmar el envío. Puede haberse guardado. Consulta el chat antes de volver a enviarlo."); return;
      }
      form.reset(); setNotice("Mensaje enviado.");
      try { await refreshMessages(conversationId); }
      catch { if (current()) setError("El mensaje está enviado, pero no se pudo actualizar el chat. Actualiza las conversaciones para consultarlo."); }
    } catch {
      if (current()) setError("No pudimos confirmar el envío. Puede haberse guardado. Consulta el chat antes de volver a enviarlo.");
    } finally {
      mutationPending.current = false;
      if (mounted.current) setSending(false);
    }
  }

  const chosen = list.find(conversation => conversation.id === active);
  const dayLabels = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const hoursNotice = communicationHours.enabled
    ? `El envío de mensajes está disponible ${communicationHours.weekdays.map(day => dayLabels[day]).join(", ")} de ${communicationHours.startTime} a ${communicationHours.endTime}, hora de Ciudad de México.`
    : "Por el momento, el envío de mensajes no tiene un horario restringido.";
  if (!canMessage) return <section className="portal-panel">
    <h2>Chat privado de docentes y familias</h2>
    <p>Las conversaciones privadas están disponibles para cuentas docentes y tutores vinculados a los alumnos. Tu cuenta no tiene habilitado este chat.</p>
    <p>Para los avisos generales de la escuela, consulta <a href="/comunicados">Comunicados</a>.</p>
  </section>;
  if (accessDenied) return <section className="portal-panel"><h2>Verifica tu acceso al chat</h2><p className="form-error" role="alert">{CHAT_ACCESS_MESSAGE}</p><button type="button" className="secondary-button" onClick={() => window.location.reload()}>Volver a cargar</button> <a href="/ingresar">Iniciar sesión</a></section>;
  return <>
    <p className="auth-help" role="status">{hoursNotice}</p>
    <p className="auth-help" role="status">{realtimeStatus === "connected" ? "Conexión del chat en vivo activa; los cambios se verifican con la escuela. También se revisa el chat abierto cada 10 segundos." : realtimeStatus === "connecting" ? "Conectando las actualizaciones del chat en vivo. Las consultas periódicas siguen activas." : realtimeStatus === "reconnecting" ? "Reconectando las actualizaciones en vivo. El chat abierto sigue usando consultas periódicas." : realtimeStatus === "unauthorized" ? "La conexión en vivo no tiene acceso a la sesión. Revisa tu inicio de sesión." : "El chat abierto se actualiza por consultas periódicas cada 10 segundos."}</p>
    <section className="portal-panel"><h2>Conversaciones</h2>
      <button type="button" className="secondary-button" disabled={starting || sending} onClick={() => { setError(""); void refreshList().catch(() => { if (mounted.current && !accessBlocked.current) setError("No se cargaron las conversaciones. Revisa la conexión e inténtalo de nuevo."); }); }}>Actualizar conversaciones</button>
      {canMessage && contacts.length > 0 && <div className="contact-list"><strong>Iniciar conversación</strong>{contacts.map((contact, index) => <button className="secondary-button" key={`${contact.studentId}-${contact.guardianId || "self"}-${index}`} disabled={starting || sending} onClick={() => start(contact)}>{contact.studentName} · {contact.teacherName}{contact.guardianName ? ` · Familia: ${contact.guardianName}` : ""}</button>)}</div>}
      {list.length ? <ul className="record-list">{list.map(conversation => <li key={conversation.id}><div><strong>{conversation.studentName} {conversation.studentFamilyName}</strong><span>{conversation.teacherName || conversation.guardianName}{conversation.unreadCount ? ` · ${conversation.unreadCount} sin leer` : ""}</span></div><button className="secondary-button" disabled={starting || sending} onClick={() => openConversation(conversation.id)}>Abrir chat{conversation.unreadCount ? ` · ${conversation.unreadCount}` : ""}</button></li>)}</ul> : <p>{contacts.length ? "Aún no hay conversaciones. Elige un contacto autorizado para iniciar una." : "Aún no tienes contactos disponibles para el chat. Pide a la escuela que revise la vinculación de tu cuenta con los alumnos y sus docentes o familias."}</p>}
    </section>
    {chosen && <section className="portal-panel"><h2>Chat · {chosen.studentName} {chosen.studentFamilyName}</h2>
      <p className="auth-help" role="status" aria-live="polite">{connectionState === "connecting" ? "Conectando al chat…" : connectionState === "connected" ? "Chat sincronizado. Se revisan mensajes nuevos cada 10 segundos." : connectionState === "reconnecting" ? "No se pudo actualizar el chat. Reintentaremos automáticamente cuando vuelva la conexión." : connectionState === "error" ? "La conversación ya no está disponible. Actualiza la página o inicia sesión de nuevo." : ""}</p>
      {hasOlder && <button className="secondary-button" type="button" onClick={loadOlderMessages} disabled={loadingOlder}>{loadingOlder ? "Cargando historial…" : "Cargar mensajes anteriores"}</button>}
      <div className="message-history" aria-live="polite">{messages.length ? messages.map(message => <article key={message.id}><strong>{message.authorName}</strong><small>{new Date(message.sentAt).toLocaleString("es-MX")}{message.isMine ? (message.readAt ? " · Leído" : " · Enviado") : ""}</small>{message.body && <p>{message.body}</p>}{message.file && <p><a href={message.file.url}>{message.file.name} · Descargar</a></p>}</article>) : <p>Escribe el primer mensaje.</p>}</div>
      <form key={active} className="school-form" onSubmit={send}><label htmlFor="chat-body">Mensaje (opcional si adjuntas un archivo)</label><textarea id="chat-body" name="body" disabled={starting || sending} maxLength={3000} /><label htmlFor="chat-file">Adjuntar PDF o imagen · máximo {SCHOOL_UPLOAD_LIMIT_LABEL}</label><input id="chat-file" name="file" type="file" disabled={!uploadsReady || starting || sending} accept="application/pdf,image/jpeg,image/png,image/webp" />{!uploadsReady && <p className="auth-help" role="status">{SCHOOL_UPLOAD_UNAVAILABLE_MESSAGE} Puedes enviar mensajes de texto.</p>}<button disabled={starting || sending}>{sending ? "Enviando…" : "Enviar mensaje"}</button></form>
    </section>}
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="form-success" role="status">{notice}</p>}
  </>;
}
