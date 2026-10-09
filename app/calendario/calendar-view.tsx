"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { schoolDateKey, schoolDateTime, schoolDateTimeInput, schoolLocalInputToISO } from "@/lib/datetime";
import { CALENDAR_KIND_LABELS, CALENDAR_KIND_VALUES, calendarFeedUrl, type CalendarKind } from "@/lib/calendar-filters";

type EventItem = { id: string; groupId: string | null; groupName: string | null; kind: string; title: string; description: string | null; startsAt: string; endsAt: string | null; source: "evento" | "tarea" };
type Group = { id: string; name: string };
type View = "mes" | "semana" | "agenda";

function keyFor(day: Date) { return `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, "0")}-${String(day.getUTCDate()).padStart(2, "0")}`; }
function shiftDate(day: Date, amount: number) { const copy = new Date(day); copy.setUTCDate(copy.getUTCDate() + amount); return copy; }

export function CalendarView({ groups, canCreate, canCreateGeneral }: { groups: Group[]; canCreate: boolean; canCreateGeneral: boolean }) {
  const [feed, setFeed] = useState<{ range: string; items: EventItem[]; limited: boolean; error?: string } | null>(null);
  const [view, setView] = useState<View>("mes");
  const [groupFilter, setGroupFilter] = useState("");
  const [kindFilter, setKindFilter] = useState<CalendarKind | "">("");
  const [anchor, setAnchor] = useState(() => { const nowKey = schoolDateKey(new Date()); return new Date(`${nowKey}T12:00:00Z`); });
  const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [eventBusy, setEventBusy] = useState(false);
  const firstOfMonth = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1, 12));
  const offset = (firstOfMonth.getUTCDay() + 6) % 7;
  const gridStart = shiftDate(firstOfMonth, -offset);
  const weekStart = shiftDate(anchor, -((anchor.getUTCDay() + 6) % 7));
  const rangeStart = view === "mes" ? gridStart : view === "semana" ? weekStart : anchor;
  const rangeEnd = view === "mes" ? shiftDate(gridStart, 41) : view === "semana" ? shiftDate(weekStart, 6) : shiftDate(anchor, 29);
  const from = keyFor(rangeStart); const to = keyFor(rangeEnd);
  const feedUrl = calendarFeedUrl(from, to, { groupId: groupFilter || undefined, kind: kindFilter || undefined });
  const rangeKey = feedUrl;
  const activeFeedUrl = useRef(feedUrl);
  const loading = feed?.range !== rangeKey;
  const loadError = feed?.range === rangeKey ? feed.error : undefined;
  const events = feed?.range === rangeKey ? feed.items : [];
  const limited = feed?.range === rangeKey && feed.limited;
  const days = Array.from({ length: 42 }, (_, i) => shiftDate(gridStart, i));
  const monthLabel = new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric", timeZone: "UTC" }).format(anchor);

  useEffect(() => {
    activeFeedUrl.current = feedUrl;
    const controller = new AbortController();
    fetch(feedUrl, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const result = await response.json() as { items?: EventItem[]; limited?: boolean; error?: string };
        if (!response.ok) throw new Error(result.error ?? "No se pudo cargar el calendario.");
        if (!Array.isArray(result.items) || typeof result.limited !== "boolean") throw new Error("No se pudo comprobar el calendario. Vuelve a intentarlo.");
        if (!controller.signal.aborted) setFeed({ range: rangeKey, items: result.items, limited: result.limited });
      })
      .catch(cause => { if (!controller.signal.aborted) setFeed({ range: rangeKey, items: [], limited: false, error: cause instanceof Error ? cause.message : "Error de conexión al cargar el calendario." }); });
    return () => controller.abort();
  }, [feedUrl, rangeKey]);

  async function refreshFeed(failureMessage: string) {
    const requestedUrl = feedUrl;
    const latest = await fetch(requestedUrl, { cache: "no-store" });
    if (!latest.ok) throw new Error(failureMessage);
    const loaded = await latest.json() as { items: EventItem[]; limited: boolean };
    if (!Array.isArray(loaded.items) || typeof loaded.limited !== "boolean") throw new Error(failureMessage);
    if (activeFeedUrl.current === requestedUrl) setFeed({ range: requestedUrl, items: loaded.items, limited: loaded.limited });
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage(""); const form = event.currentTarget; const data = new FormData(form);
    try {
      const body = { groupId: String(data.get("groupId") || "") || undefined, kind: String(data.get("kind")), title: String(data.get("title")), description: String(data.get("description")) || undefined, startsAt: schoolLocalInputToISO(String(data.get("startsAt"))), endsAt: data.get("endsAt") ? schoolLocalInputToISO(String(data.get("endsAt"))) : undefined };
      const response = await fetch("/api/calendar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "No se pudo guardar el evento.");
      await refreshFeed("El evento se guardó, pero no pudimos actualizar la agenda.");
      setMessage("Evento agregado al calendario."); form.reset();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Error de conexión."); }
    finally { setBusy(false); }
  }

  async function updateEvent(id: string, form: HTMLFormElement) {
    setEventBusy(true); setError(""); setMessage("");
    const data = new FormData(form);
    try {
      const response = await fetch(`/api/calendar/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: data.get("kind"), title: data.get("title"), description: String(data.get("description") || "") || undefined, startsAt: schoolLocalInputToISO(String(data.get("startsAt"))), endsAt: data.get("endsAt") ? schoolLocalInputToISO(String(data.get("endsAt"))) : undefined }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "No se pudo actualizar el evento.");
      await refreshFeed("El evento se guardó, pero no se pudo actualizar la agenda."); setMessage("Evento actualizado.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Error de conexión."); }
    finally { setEventBusy(false); }
  }

  async function deleteEvent(item: EventItem) {
    if (!window.confirm(`¿Cancelar “${item.title}” del calendario? Se avisará al grupo.`)) return;
    setEventBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/calendar/${item.id}`, { method: "DELETE" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "No se pudo cancelar el evento.");
      await refreshFeed("El evento se canceló, pero no se pudo actualizar la agenda."); setMessage("Evento cancelado. Se notificó a las familias autorizadas.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Error de conexión."); }
    finally { setEventBusy(false); }
  }

  const visibleEvents: EventItem[] = [];
  const eventsByDay = new Map<string, EventItem[]>();
  for (const event of events) {
    const key = schoolDateKey(event.startsAt);
    if (key < from || key > to) continue;
    visibleEvents.push(event);
    const bucket = eventsByDay.get(key) ?? [];
    bucket.push(event);
    eventsByDay.set(key, bucket);
  }
  const agendaLabel = `${new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "UTC" }).format(rangeStart)} – ${new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(rangeEnd)}`;

  return <><section className="calendar-panel portal-panel"><div className="calendar-controls"><div className="calendar-switch" role="group" aria-label="Vista de calendario">{(["mes", "semana", "agenda"] as const).map(item => <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}</div><div className="calendar-title"><button aria-label="Periodo anterior" onClick={() => setAnchor(view === "mes" ? new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - 1, 1, 12)) : shiftDate(anchor, view === "semana" ? -7 : -30))}>‹</button><strong>{view === "mes" ? monthLabel : view === "semana" ? `Semana del ${schoolDateTime(`${keyFor(weekStart)}T12:00:00Z`)}` : agendaLabel}</strong><button aria-label="Periodo siguiente" onClick={() => setAnchor(view === "mes" ? new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1, 12)) : shiftDate(anchor, view === "semana" ? 7 : 30))}>›</button></div></div>
    <div className="list-filters"><label htmlFor="calendar-group-filter">Grupo</label><select id="calendar-group-filter" value={groupFilter} onChange={event => setGroupFilter(event.target.value)}><option value="">Todos mis grupos</option><option value="general">Eventos generales</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select><label htmlFor="calendar-kind-filter">Tipo de actividad</label><select id="calendar-kind-filter" value={kindFilter} onChange={event => setKindFilter(event.target.value as CalendarKind | "")}><option value="">Todos los tipos</option>{CALENDAR_KIND_VALUES.map(kind => <option key={kind} value={kind}>{CALENDAR_KIND_LABELS[kind]}</option>)}</select></div>
    {(groupFilter || kindFilter) && <button type="button" className="secondary-button" onClick={() => { setGroupFilter(""); setKindFilter(""); }}>Limpiar filtros</button>}
    {loading && <p className="empty-state" role="status">Cargando actividades…</p>}{loadError && <p className="form-error" role="alert">{loadError}</p>}
    {!loading && !loadError && limited && <p className="form-error" role="status">Se muestran las primeras 500 actividades que coinciden. Hay más resultados: elige un grupo o tipo, o cambia a la vista Semana para consultar un periodo más corto.</p>}
    {!loading && !loadError && view === "mes" && <div className="month-grid"><div className="weekday-row">{["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map(day => <span key={day}>{day}</span>)}</div>{days.map(day => { const dateKey = keyFor(day); const inMonth = day.getUTCMonth() === anchor.getUTCMonth(); const dayEvents = eventsByDay.get(dateKey) ?? []; return <div key={dateKey} className={`month-cell ${inMonth ? "" : "outside-month"}`}><span>{day.getUTCDate()}</span>{dayEvents.slice(0, 2).map(item => <small key={item.id} title={item.title}>{item.title}</small>)}{dayEvents.length > 2 && <small>+{dayEvents.length - 2} más</small>}</div>; })}</div>}
    {!loading && !loadError && view === "semana" && <div className="week-grid">{Array.from({ length: 7 }, (_, i) => shiftDate(weekStart, i)).map(day => { const dateKey = keyFor(day); const dayEvents = eventsByDay.get(dateKey) ?? []; return <section key={dateKey}><h3>{new Intl.DateTimeFormat("es-MX", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(day)}</h3>{dayEvents.map(item => <small key={item.id}>{schoolDateTime(item.startsAt)} · {item.title}</small>)}</section>; })}</div>}
    {!loading && !loadError && view === "agenda" && <EventList events={visibleEvents} canManage={canCreate} canManageGeneral={canCreateGeneral} groups={groups} busy={eventBusy} onUpdate={updateEvent} onDelete={deleteEvent} />}
    {!loading && !loadError && view !== "agenda" && visibleEvents.length === 0 && <p className="empty-state">No hay eventos para este periodo.</p>}
  </section>{canCreate && <section className="portal-panel"><h2>Agregar evento</h2><form className="school-form event-form" onSubmit={create}><label htmlFor="event-title">Nombre de la actividad</label><input id="event-title" name="title" required minLength={2} maxLength={120} disabled={busy} /><label htmlFor="event-group">Grupo</label><select id="event-group" name="groupId" required={!canCreateGeneral} disabled={busy}>{canCreateGeneral && <option value="">Toda la escuela</option>}{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select><label htmlFor="event-kind">Tipo</label><select id="event-kind" name="kind" disabled={busy}><option value="evento">Evento escolar</option><option value="reunion">Reunión de familias</option><option value="festival">Festival</option><option value="entrega">Fecha de entrega</option><option value="suspension">Suspensión de clases</option><option value="otro">Otro</option></select><label htmlFor="event-start">Fecha y hora de inicio · Ciudad de México</label><input id="event-start" name="startsAt" type="datetime-local" required disabled={busy} /><label htmlFor="event-end">Termina (opcional)</label><input id="event-end" name="endsAt" type="datetime-local" disabled={busy} /><label htmlFor="event-description">Detalles (opcional)</label><textarea id="event-description" name="description" maxLength={1000} disabled={busy} /><button disabled={busy}>{busy ? "Guardando…" : "Guardar evento"}</button></form>{error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success" role="status">{message}</p>}</section>}</>;
}

function EventList({ events, canManage, canManageGeneral, groups, busy, onUpdate, onDelete }: { events: EventItem[]; canManage: boolean; canManageGeneral: boolean; groups: Group[]; busy: boolean; onUpdate: (id: string, form: HTMLFormElement) => void; onDelete: (item: EventItem) => void }) {
  return events.length ? <ul className="event-list">{events.map(event => {
    const editable = canManage && event.source === "evento" && event.kind !== "clase" && (event.groupId ? canManageGeneral || groups.some(group => group.id === event.groupId) : canManageGeneral);
    return <li key={event.id}><span className="event-date">{schoolDateTime(event.startsAt)}</span><div><strong>{event.title}</strong><small>{event.kind} {event.groupName ? `· ${event.groupName}` : "· Toda la escuela"}</small>{event.description && <p>{event.description}</p>}
      {editable && <details className="event-manage"><summary>Administrar evento</summary><form className="school-form event-form" onSubmit={formEvent => { formEvent.preventDefault(); void onUpdate(event.id, formEvent.currentTarget); }}><label htmlFor={`edit-event-title-${event.id}`}>Nombre</label><input id={`edit-event-title-${event.id}`} name="title" defaultValue={event.title} required minLength={2} maxLength={120} disabled={busy} /><label htmlFor={`edit-event-kind-${event.id}`}>Tipo</label><select id={`edit-event-kind-${event.id}`} name="kind" defaultValue={event.kind} disabled={busy}><option value="evento">Evento escolar</option><option value="reunion">Reunión de familias</option><option value="festival">Festival</option><option value="entrega">Fecha de entrega</option><option value="suspension">Suspensión de clases</option><option value="otro">Otro</option></select><label htmlFor={`edit-event-start-${event.id}`}>Fecha y hora · Ciudad de México</label><input id={`edit-event-start-${event.id}`} name="startsAt" type="datetime-local" defaultValue={schoolDateTimeInput(event.startsAt)} required disabled={busy} /><label htmlFor={`edit-event-end-${event.id}`}>Termina (opcional)</label><input id={`edit-event-end-${event.id}`} name="endsAt" type="datetime-local" defaultValue={event.endsAt ? schoolDateTimeInput(event.endsAt) : ""} disabled={busy} /><label htmlFor={`edit-event-description-${event.id}`}>Detalles</label><textarea id={`edit-event-description-${event.id}`} name="description" defaultValue={event.description ?? ""} maxLength={1000} disabled={busy} /><button disabled={busy}>{busy ? "Guardando…" : "Guardar cambios"}</button></form><button className="secondary-button" type="button" disabled={busy} onClick={() => void onDelete(event)}>Cancelar evento</button></details>}
    </div></li>;
  })}</ul> : <p className="empty-state">No hay eventos programados.</p>;
}
