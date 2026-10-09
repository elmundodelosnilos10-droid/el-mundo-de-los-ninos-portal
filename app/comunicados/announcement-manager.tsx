"use client";

import { useEffect, useState, type FormEvent } from "react";

type Group = { id: string; name: string };
type Item = { id: string; groupId: string | null; title: string; body: string; important: boolean; publishedAt: string; readAt: string | null };
type AnnouncementResponse = { error?: string; items?: Item[] };
type ActionResponse = { error?: string };

export function AnnouncementManager({ groups, canCreate, canCreateGeneral }: { groups: Group[]; canCreate: boolean; canCreateGeneral: boolean }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const response = await fetch("/api/announcements", { cache: "no-store" });
    const data = await response.json() as AnnouncementResponse;
    if (!response.ok) throw Error(data.error || "No se cargaron los avisos.");
    setItems([...(data.items ?? [])].reverse());
  }

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/announcements", { cache: "no-store" })
      .then(async response => ({ response, data: await response.json() as AnnouncementResponse }))
      .then(({ response, data }) => {
        if (!response.ok) throw Error(data.error || "No se cargaron los avisos.");
        if (!cancelled) { setItems([...(data.items ?? [])].reverse()); setLoading(false); }
      })
      .catch(cause => { if (!cancelled) { setError(cause instanceof Error ? cause.message : "No se cargaron los avisos."); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = event.currentTarget;
    const formData = new FormData(form);
    try {
      const response = await fetch("/api/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: String(formData.get("groupId") || "") || undefined, title: formData.get("title"), body: formData.get("body"), important: formData.get("important") === "on" }),
      });
      const result = await response.json() as ActionResponse;
      if (!response.ok) throw Error(result.error || "No se publicó el aviso.");
      await refresh();
      form.reset();
      setNote("Comunicado enviado. El aviso aparece en las cuentas destinatarias.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error de conexión.");
    } finally {
      setBusy(false);
    }
  }

  async function markRead(id: string) {
    const response = await fetch(`/api/announcements/${id}/read`, { method: "POST" });
    const result = await response.json() as ActionResponse;
    if (!response.ok) { setError(result.error || "No se pudo confirmar la lectura."); return; }
    await refresh();
  }

  return <>
    {canCreate && <section className="portal-panel"><h2>Publicar comunicado</h2><form className="school-form event-form" onSubmit={send}>
      <label htmlFor="announcement-group">Destinatarios</label><select id="announcement-group" name="groupId" required={!canCreateGeneral}>{canCreateGeneral && <option value="">Toda la escuela</option>}{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select>
      <label htmlFor="announcement-title">Título</label><input id="announcement-title" name="title" required minLength={2} maxLength={120} />
      <label htmlFor="announcement-body">Mensaje</label><textarea id="announcement-body" name="body" required minLength={2} maxLength={3000} />
      <label className="check-label"><input type="checkbox" name="important" /> Marcar como importante</label>
      <button disabled={busy}>{busy ? "Publicando…" : "Enviar aviso"}</button>
    </form>{note && <p className="form-success" role="status">{note}</p>}</section>}
    <section className="portal-panel"><h2>Avisos recientes</h2>{loading ? <p role="status">Cargando comunicados…</p> : items.length ? <ul className="record-list">{items.map(item => <li key={item.id}><div><strong>{item.important && "📌 "}{item.title}</strong><span>{new Date(item.publishedAt).toLocaleString("es-MX")} · {item.readAt ? "Visto" : "Pendiente de lectura"}</span><p>{item.body}</p></div>{!item.readAt && <button className="secondary-button" onClick={() => markRead(item.id)}>Marcar como visto</button>}</li>)}</ul> : <div className="empty-state"><p>{error ? "No pudimos cargar los comunicados." : canCreate ? "Aún no hay comunicados. Comparte el primer aviso desde el formulario de arriba." : "Aún no hay comunicados para ti."}</p>{error && <button className="secondary-button" type="button" onClick={() => { setLoading(true); setError(""); refresh().catch(cause => setError(cause instanceof Error ? cause.message : "No se cargaron los avisos.")).finally(() => setLoading(false)); }}>Intentar de nuevo</button>}</div>}</section>
    {error && <p className="form-error" role="alert">{error}</p>}
  </>;
}
