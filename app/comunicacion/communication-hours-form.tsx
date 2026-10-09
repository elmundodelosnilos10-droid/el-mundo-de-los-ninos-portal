"use client";

import { useState, type FormEvent } from "react";
import type { CommunicationHours } from "@/lib/communication-hours";

const days = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

export function CommunicationHoursForm({ initialSettings }: { initialSettings: CommunicationHours }) {
  const [enabled, setEnabled] = useState(initialSettings.enabled);
  const [weekdays, setWeekdays] = useState(initialSettings.weekdays);
  const [startTime, setStartTime] = useState(initialSettings.startTime);
  const [endTime, setEndTime] = useState(initialSettings.endTime);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/communication-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, weekdays, startTime, endTime }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw Error(data.error || "No se pudo guardar el horario.");
      setNotice("Horario guardado.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar el horario.");
    } finally {
      setBusy(false);
    }
  }

  function toggleDay(day: number, checked: boolean) {
    setWeekdays(current => checked ? [...new Set([...current, day])].sort() : current.filter(value => value !== day));
  }

  return <section className="portal-panel">
    <h2>Horario de comunicación</h2>
    <p>Si activas esta regla, el portal solo permitirá enviar mensajes dentro de los días y horas seleccionados, en hora de Ciudad de México. Consultar el historial seguirá disponible.</p>
    <form className="school-form" onSubmit={save}>
      <label className="inline-check"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} disabled={busy} /> Limitar el envío al horario escolar</label>
      <fieldset className="weekday-options" disabled={!enabled || busy}>
        <legend>Días disponibles</legend>
        {days.map((day, index) => <label className="inline-check" key={day}><input type="checkbox" checked={weekdays.includes(index)} onChange={event => toggleDay(index, event.target.checked)} /> {day}</label>)}
      </fieldset>
      <div className="time-range-fields">
        <label htmlFor="communication-start">Desde <input id="communication-start" type="time" value={startTime} onChange={event => setStartTime(event.target.value)} disabled={!enabled || busy} required={enabled} /></label>
        <label htmlFor="communication-end">Hasta <input id="communication-end" type="time" value={endTime} onChange={event => setEndTime(event.target.value)} disabled={!enabled || busy} required={enabled} /></label>
      </div>
      <button disabled={busy}>{busy ? "Guardando…" : "Guardar horario"}</button>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="form-success" role="status">{notice}</p>}
    </form>
  </section>;
}
