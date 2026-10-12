"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

type Group = { id: string; name: string };
type Item = { id: string; groupId: string | null; title: string; body: string; important: boolean; publishedAt: string; readAt: string | null };
type AnnouncementResponse = { items?: Item[] };
type ActionResponse = { id?: string; read?: boolean };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const accessMessage = "Tu sesión o tus permisos han cambiado. Vuelve a iniciar sesión para consultar los comunicados.";
const uncertainMessage = "No pudimos confirmar la publicación. Puede haberse guardado. Comprueba los avisos antes de intentar enviarlo otra vez.";

export function AnnouncementManager({ groups, canCreate, canCreateGeneral }: { groups: Group[]; canCreate: boolean; canCreateGeneral: boolean }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [listError, setListError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [checkBeforeSending, setCheckBeforeSending] = useState(false);
  const [confirmedReads, setConfirmedReads] = useState<string[]>([]);
  const mounted = useRef(false);
  const lifecycle = useRef(0);
  const denied = useRef(false);
  const writing = useRef(false);
  const needsCheck = useRef(false);
  const readSequence = useRef(0);
  const reader = useRef<AbortController | null>(null);
  const pendingReads = useRef(new Set<string>());
  const readConfirmed = useRef(new Set<string>());
  const [readingIds, setReadingIds] = useState<string[]>([]);

  const loseAccess = useCallback(() => {
    denied.current = true; readSequence.current++; reader.current?.abort();
    readConfirmed.current.clear(); setItems([]); setConfirmedReads([]); setNote(""); setError(""); setListError(""); setLoading(false); setAccessDenied(true);
  }, []);

  const refresh = useCallback(async () => {
    if (!mounted.current || denied.current) return;
    const sequence = ++readSequence.current;
    reader.current?.abort(); const controller = new AbortController(); reader.current = controller;
    const current = () => mounted.current && !denied.current && sequence === readSequence.current && !controller.signal.aborted;
    setLoading(true); setListError("");
    try {
      const response = await fetch("/api/announcements", { cache: "no-store", credentials: "same-origin", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
      if (!current()) return;
      if ([401, 403].includes(response.status)) { loseAccess(); return; }
      const data = await response.json() as AnnouncementResponse;
      if (!current()) return;
      if (!response.ok || !Array.isArray(data?.items) || !data.items.every(item => item && typeof item.id === "string" && uuid.test(item.id) && (item.groupId === null || typeof item.groupId === "string" && uuid.test(item.groupId)) && typeof item.title === "string" && typeof item.body === "string" && typeof item.important === "boolean" && typeof item.publishedAt === "string" && Number.isFinite(Date.parse(item.publishedAt)) && (item.readAt === null || typeof item.readAt === "string" && Number.isFinite(Date.parse(item.readAt))))) throw Error("Unavailable");
      setItems([...data.items].reverse());
      needsCheck.current = false; setCheckBeforeSending(false);
    } catch {
      if (current()) setListError("No se pudo actualizar el listado de comunicados. Puedes volver a consultarlo sin enviarlos otra vez.");
    } finally {
      if (current()) setLoading(false);
    }
  }, [loseAccess]);

  useEffect(() => {
    const lifetime = lifecycle; const sequence = readSequence; const activeReader = reader;
    mounted.current = true; const generation = ++lifetime.current;
    void Promise.resolve().then(() => { if (mounted.current && generation === lifetime.current) void refresh(); });
    return () => { mounted.current = false; lifetime.current++; sequence.current++; activeReader.current?.abort(); };
  }, [refresh]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mounted.current || denied.current || writing.current || needsCheck.current || !canCreate) return;
    writing.current = true; setBusy(true); setError(""); setNote("");
    const generation = lifecycle.current;
    const current = () => mounted.current && !denied.current && generation === lifecycle.current;
    const unconfirmed = () => {
      needsCheck.current = true; setCheckBeforeSending(true); setError(uncertainMessage);
      readSequence.current++; reader.current?.abort(); setLoading(false);
    };
    const form = event.currentTarget;
    try {
      const formData = new FormData(form);
      const response = await fetch("/api/announcements", {
        method: "POST", credentials: "same-origin", signal: AbortSignal.timeout(20_000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: String(formData.get("groupId") || "") || undefined, title: formData.get("title"), body: formData.get("body"), important: formData.get("important") === "on" }),
      });
      if (!current()) return;
      if ([401, 403].includes(response.status)) { loseAccess(); return; }
      const result = await response.json() as ActionResponse;
      if (!current()) return;
      if (response.status !== 201 || typeof result.id !== "string" || !uuid.test(result.id)) {
        if ([400, 404].includes(response.status)) setError("Revisa el título, el mensaje y el grupo destinatario antes de enviarlo.");
        else unconfirmed();
        return;
      }
      form.reset();
      setNote("Comunicado enviado. El aviso aparece en las cuentas destinatarias.");
      await refresh();
    } catch {
      if (current()) unconfirmed();
    } finally {
      writing.current = false;
      if (current()) setBusy(false);
    }
  }

  async function markRead(id: string) {
    if (!mounted.current || denied.current || pendingReads.current.has(id) || readConfirmed.current.has(id)) return;
    pendingReads.current.add(id); setReadingIds([...pendingReads.current]); setError("");
    const generation = lifecycle.current;
    const current = () => mounted.current && !denied.current && generation === lifecycle.current;
    try {
      const response = await fetch(`/api/announcements/${id}/read`, { method: "POST", credentials: "same-origin", signal: AbortSignal.timeout(20_000) });
      if (!current()) return;
      if ([401, 403].includes(response.status)) { loseAccess(); return; }
      const result = await response.json() as ActionResponse;
      if (!current()) return;
      if (response.status !== 200 || result.read !== true) throw Error("Unconfirmed");
      readConfirmed.current.add(id);
      setConfirmedReads(previous => previous.includes(id) ? previous : [...previous, id]);
      await refresh();
    } catch {
      if (current()) setError("No pudimos confirmar la lectura. Actualiza el listado antes de volver a intentarlo.");
    } finally {
      pendingReads.current.delete(id);
      if (current()) setReadingIds([...pendingReads.current]);
    }
  }

  if (accessDenied) return <section className="portal-panel"><h2>Verifica tu acceso</h2><p className="form-error" role="alert">{accessMessage}</p><a href="/ingresar">Iniciar sesión</a></section>;
  return <>
    {canCreate && <section className="portal-panel"><h2>Publicar comunicado</h2><form className="school-form event-form" onSubmit={send}>
      <label htmlFor="announcement-group">Destinatarios</label><select id="announcement-group" name="groupId" disabled={busy} required={!canCreateGeneral}>{canCreateGeneral && <option value="">Toda la escuela</option>}{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select>
      <label htmlFor="announcement-title">Título</label><input id="announcement-title" name="title" disabled={busy} required minLength={2} maxLength={120} />
      <label htmlFor="announcement-body">Mensaje</label><textarea id="announcement-body" name="body" disabled={busy} required minLength={2} maxLength={3000} />
      <label className="check-label"><input type="checkbox" name="important" disabled={busy} /> Marcar como importante</label>
      <button disabled={busy || checkBeforeSending}>{busy ? "Publicando…" : "Enviar aviso"}</button>
    </form>{note && <p className="form-success" role="status">{note}</p>}</section>}
    <section className="portal-panel"><h2>Avisos recientes</h2>{loading && <p role="status">Cargando comunicados…</p>}{items.length ? <ul className="record-list">{items.map(item => <li key={item.id}><div><strong>{item.important && "📌 "}{item.title}</strong><span>{new Date(item.publishedAt).toLocaleString("es-MX")} · {item.readAt || confirmedReads.includes(item.id) ? "Visto" : "Pendiente de lectura"}</span><p>{item.body}</p></div>{!item.readAt && !confirmedReads.includes(item.id) && <button disabled={readingIds.includes(item.id)} className="secondary-button" onClick={() => markRead(item.id)}>{readingIds.includes(item.id) ? "Confirmando…" : "Marcar como visto"}</button>}</li>)}</ul> : !loading && !listError && <div className="empty-state"><p>{canCreate ? "Aún no hay comunicados. Comparte el primer aviso desde el formulario de arriba." : "Aún no hay comunicados para ti."}</p></div>}
      {listError && <p className="form-error" role="alert">{listError}</p>}
      <button className="secondary-button" type="button" disabled={loading || busy} onClick={() => void refresh()}>Actualizar avisos</button>
    </section>
    {error && <p className="form-error" role="alert">{error}</p>}
  </>;
}
